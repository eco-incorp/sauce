# Sauce dev-tools

To build an application with Sauce, install the SDK — you do not need this workspace:

```sh
pnpm add @eco-incorp/sauce
```

Follow the [quick start](../docs/guides/quick-start.md) and the
[examples](../docs/examples/README.md). After installing, the same manual is on disk at
`node_modules/@eco-incorp/sauce/docs/README.md`.

## The testing kit

`src/testing` is `@eco-incorp/sauce/testing`, which ships in the package: run programs on a forked
chain, EVM or Solana, from `node:test`, recorded once and replayed with no RPC. Its guide is
[Testing programs](../docs/guides/testing.md). Its own suites are `test/testing/`; the Base one
replays `test/testing/state/base.json.gz`, which `RECAPTURE_ANVIL_STATE=1` records again, reading
the RPC from the gitignored `sdk/rpc.config.json`. The Solana examples suite replays
`test/testing/state/solana-examples.json.gz`, which `RECAPTURE_SOLANA_STATE=1` records again from
the SDK's pinned mainnet dumps, served on loopback: no RPC at all.

## The dev harness

The rest of this workspace is used while developing the SDK itself and does not ship: compilation
and argument helpers, a Solana local-execution runner, and a local EVM node to cook programs on.

### A local node or a fork

Needs [Foundry](https://getfoundry.sh)'s `anvil` and a built SDK (`pnpm build` at the root, which
syncs the release's contract artifacts).

```sh
pnpm --filter './dev-tools' start:fork <rpc-url>   # fork the chain that RPC serves
pnpm --filter './dev-tools' start:local            # an empty chain, as Base (--chain-id <id>)
pnpm --filter './dev-tools' stop
```

Either starts anvil on port 8545 (`--port <port>`) and runs `scripts/deploy.ts`, which leaves the
node ready to cook:

- **The v12 stack.** On a fork of a chain that already runs the release (Ethereum, Base), the
  engine, Router and Kitchen there are used as they are, the Kitchen's owner and execution fee
  included. Anywhere else they are deployed from the release's creation code at the release
  addresses (the SDK's `deployReleaseStack`, which the testing kit and the SDK's own suites use),
  with no fee. `--zero-fee`
  makes cooks free on a live Kitchen too.
- **A Pot** for anvil's first account under the default salt, the one the `sauce` command uses.
- **A plain first account.** A fork can carry an EIP-7702 delegation on anvil's well-known first
  account (Base does), and tokens and Permit2 would then refuse its signatures; it is cleared.

What it set up is in `dev-tools/.deployment.json`. A node without a fork takes Base's chain id by
default, because the `sauce` command refuses an endpoint whose chain id it does not know. Then run
a program with the package's command, anvil's first key signing:

```sh
sauce run <file.sauce.ts> --chain <chain id> --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

The fork's tokens are the forked chain's: give the first account some by impersonating a holder
(`cast rpc anvil_impersonateAccount <holder>`, then `cast send … --unlocked`), or rehearse with
`sauce simulate --assume-balance`. `pnpm --filter './dev-tools' sync-price <pool>` copies a Uniswap V3
pool's current price and balances from the forked chain onto the fork.
