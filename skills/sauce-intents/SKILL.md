---
name: sauce-intents
description: Cross-chain intents written in Sauce — a file that is the intent, Base(() => { ... }).reward({ ... }) as top-level statements with no main and its values as defines, run from your Pot with sauce run or published from your wallet with sauce publish, carrying amounts measured on chain into it, nesting intents into multi-hop cascades, token-only bodies versus program bodies (Executor calls versus a Pot cook), the delivery argument, reward tokens, on which chain each name resolves, the shared destination Pot, Kitchen fees, and the deadline and creator every intent needs. Use when a program should continue on another chain, forward a swap or bridge output, build a cascade or multi-hop route, pay a solver, or when the user mentions intents, rewards, solvers, Portals, provers, Executors or Pots.
---

# Cross-chain intents in Sauce

An intent is an **offer**: run this on the destination chain, and the reward escrowed on this chain
is yours. An intent file is written as **top-level statements, with no `main`**: the chain name
called as a function opens the intent, and every value the file does not compute is a define, left
undeclared in the file and set with `--define NAME=VALUE` (`sauce-script`).

```sauce chain=base define=RECIPIENT,AMOUNT
Arbitrum(() => {
  USDC.transfer(RECIPIENT, AMOUNT); // Arbitrum's USDC: the body runs there
}).reward({ tokens: [{ token: USDC, amount: AMOUNT }] }); // the source chain's USDC
```

Nothing about the fill is guaranteed: a solver decides whether the reward is worth it, and the
package prices nothing. Say an intent is _offered_, never that it _will execute_.

## Names resolve per chain

The file is compiled for the **source** chain, the one that pays the reward (`--chain`).

- **In `.reward(...)`**, names are the source chain's, which funds and escrows the reward: `USDC`
  there is the source chain's USDC. A reward token must be known when the file is compiled: a
  symbol, or a token's address on the source chain as a literal or a define. Its amount may be a
  measured value.
- **Inside the braces, and in the delivery argument**, the code runs on the destination, and every
  name a chain supplies resolves there: in an `Arbitrum(...)` body, `USDC` is Arbitrum's USDC,
  `AaveV3.Pool` is Arbitrum's pool, and `chainId` and a `Namespace_Contract` define are Arbitrum's.
  The tokens a destination has are listed in
  [../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md).
- **The rule repeats at every depth.** An intent opened inside a body is funded on that body's
  chain, so its reward resolves there and its own body on its own destination.
- A literal address means that address everywhere, and so does a define whose name no chain uses
  (`RECIPIENT`). A define under a chain-scoped name (`USDC`, `chainId`, a protocol address) is a
  name on the source chain: it applies to the file's own statements and the reward, and a body on
  another chain keeps that chain's value.

## Two ways to run the file

With [examples/cross-chain.sauce.ts](examples/cross-chain.sauce.ts), which measures its amount, and
the first file above saved as `pay-on-arbitrum.sauce.ts`, which does not:

```sh
npx sauce run cross-chain.sauce.ts --chain base --config sauce.config.json --keystore <keystore> \
  --define BENEFICIARY=<address> --intent-deadline <unix seconds> --intent-creator <address> \
  --intent-execution-fee <wei>
npx sauce publish pay-on-arbitrum.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --define RECIPIENT=<address> --define AMOUNT=1000000 \
  --intent-deadline <unix seconds> --intent-creator <address> --dry-run
```

- **Run it from your Pot** (`sauce run`): the file is a program cooked on your Pot on the source
  chain, and opening the intent is one of its steps; the Pot approves the source chain's Portal for
  the reward and publishes and funds the intent. Values measured while it runs can flow into the
  intent: in `const amount = USDC.balanceOf(ctx.self())`, `amount` does not exist until the program
  runs, and using it inside the braces, in the delivery or in the reward is enough. The package
  encodes the intent with a slot for it, and the program writes the measured value in before it
  publishes. Any one-word value can be carried this way.
- **Publish it from your wallet** (`sauce publish`): the intent is built before anything runs, and
  your wallet approves the reward to the Portal and calls `publishAndFund`. There is no Pot and
  nothing is measured, so every amount must be a literal or a define, and the file may do nothing
  but open intents. `--dry-run` rehearses both transactions and sends nothing.

`sauce inspect <file> --chain <chain>` with the same defines and intent flags prints each intent
the file opens: its destination, the route's calls and the reward, with every measured value named.

## Two kinds of body

| The body is…                                                                                                | Lowers to                                                    | Needs                                                                  | Token writes                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| only `transfer`/`approve` calls on a symbol or `Token(address)`, with literal, define or captured arguments | plain calls the destination Portal's Executor makes          | nothing more: no Pot, no Kitchen fee                                   | USDT works and `approve` is reset to zero first, but a `false` return is **not** detected |
| anything else: a local, a balance read, a condition, a protocol call, `transferFrom`, a nested intent       | a program compiled for the destination and cooked on its Pot | the destination's Kitchen fee, and the delivery as the second argument | SafeERC20: a `false` return reverts the fulfilment                                        |

A program body must say what the solver delivers, because a balance read inside it reads what is
there, not what must be brought:

```sauce chain=base define=BENEFICIARY
const amount = USDC.balanceOf(ctx.self());
const delivered = amount - (amount * 10n) / 10000n;
Arbitrum(
  () => {
    USDC.approve(AaveV3.Pool, delivered);
    AaveV3.Pool.supply(USDC, delivered, BENEFICIARY, 0n);
  },
  { tokens: [{ token: USDC, amount: delivered }] },
).reward({ tokens: [{ token: USDC, amount }] });
```

The gap between `delivered` (brought on Arbitrum) and `amount` (paid on Base) is the solver's
margin. Make it worth filling.

## A whole program as the body

The body can be any program for the destination, such as a complete swap:
[examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) runs the distributed swap
(`sauce-distributed-swap`) on Base for WETH a solver delivers there, and pays the solver in WETH on
the source chain. The body is written inside the braces and uses the file's defines as values. It
may also use what the file declares: its imports (an ABI, a library) and its helper functions, each
compiled into the body's program for the destination. It calls contracts by namespace
(`UniswapV3.Factory.getPool(...)`), through an imported binding, or by selector, with
`evm.static(address, data)` for a read and `evm.call(address, value, data)` for a write, `data` being
the selector bytes `.concat(abi.encode(...))`. The swap Router is reached through the Pot itself,
`ctx.self()`. Every unsold input and every output leaves the destination Pot before the body ends.

## Cascades

An intent's body can open the next one. Each level's amounts are measured at that level's own
execution and carried into the level below; no amount past the first exists when the user signs.

```sauce chain=base define=RECIPIENT
const amount = USDC.balanceOf(ctx.self());
Arbitrum(
  () => {
    const arrived = USDC.balanceOf(ctx.self()); // Arbitrum's USDC
    Optimism(() => {
      USDC.transfer(RECIPIENT, arrived); // Optimism's USDC
    }).reward({ tokens: [{ token: USDC, amount: arrived }] }); // Arbitrum's: it funds this level
  },
  { tokens: [{ token: USDC, amount }] },
).reward({ tokens: [{ token: USDC, amount }] });
```

Each level is a separate fulfilment by a solver, later, on its own chain: a failure on a later hop
does not undo an earlier one. The Arbitrum level pays the Optimism level's reward from Arbitrum, in
Arbitrum's USDC. Each level's deadline must be no earlier than its parent's.

## What the compile supplies, and what you pass

The Portal, the prover, the destination Pot and the encoding are looked up: the eco-routes registry
(`ecoRoutesPortal(chain)`, `ecoRoutesProver(source, destination)` from
`@eco-incorp/sauce/protocols/eco-routes`) records where each chain's Portal is and a prover deployed
on both sides. [../sauce-globals/references/chains.md](../sauce-globals/references/chains.md) lists
which chains take intents. Three values are the developer's:

- **`--intent-deadline <unix seconds>`**: when the intent must be filled by.
- **`--intent-creator <address>`**: who may reclaim an unearned reward. Never a Pot.
- **`--intent-execution-fee <wei>`** for a program body: the destination Kitchen's fee. It is
  mutable on chain and lives on the destination, so read it there just before sending
  (`destinationExecutionFee()` builds the read, and `--intent-execution-fee auto` reads it through
  `--config`); an increase before the fill makes the cook, and the fulfilment, revert.

Refused at compile time, never silently changed: a name that is neither a define nor a program
variable, a missing deadline, creator or fee, a chain with no eco-routes deployment, a pair with no
prover deployed on both sides.

## The destination Pot

A program body cooks on the destination Portal Executor's **shared Pot** (one per Executor, salt
zero). The package derives its address and deploys nothing: **the Pot must exist before
fulfilment**, and the solver deploys it. Anything left in it after the program, token or allowance,
belongs to the next intent through that Portal: approve exactly what is spent and move every
remainder out.

Solana destinations are not built this way (see `sauce-solana`). An application can also build an
intent from TypeScript around a program it compiles itself:
`node_modules/@eco-incorp/sauce/docs/guides/intents.md`.

## Examples

- [examples/cross-chain.sauce.ts](examples/cross-chain.sauce.ts) forwards the Pot's USDC to Aave on
  Arbitrum. It measures its amount, so it runs from a Pot.
- [examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) is the distributed swap as the
  body of an intent to Base. Its amounts are defines, so it can be run from a Pot or published from a
  wallet.
- [examples/intents.mts](examples/intents.mts) compiles both, with the deadline, the creator, Base's
  and Arbitrum's fees and the recipient as developer inputs, and pins on which chain each name
  resolves, the fee requirement and the token-only case.
