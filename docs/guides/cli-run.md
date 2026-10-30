# Run a program

**How-to guide** · [Documentation](../README.md) · [The sauce command](cli.md) · [Programs and arguments](cli-programs.md)

> Running a program is like baking from a recipe. First you check the recipe makes sense
> (`sauce compile`). Then you try it in a play kitchen, where nothing real gets used up
> (`sauce simulate`). Then you bake for real (`sauce run`). Your **Pot** is your counter on the
> chain: it holds the ingredients, the tokens, that the program uses.

This page is the [quick start](quick-start.md) with everything explained: each step, how to read
what comes back, how to get tokens into your Pot, and how to manage more than one Pot. It is for
someone who has the command installed and wants to run programs with confidence.

You will need:

- the `sauce` command, installed ([Install](cli.md#install));
- a wallet named `me`, made with `sauce wallet new me`. It asks for a password twice and prints
  the wallet's address ([Wallets and signing](cli-wallets.md) says more);
- `pay.sauce.ts`, the quick start's program, which pays a recipient USDC from your Pot.

Simulation itself spends no money, but EVM execution requires a deployed, authenticated Pot
binding first. Creating your Pot (step 3) and a real run need ETH for gas; the cook also pays
the Kitchen's fee and needs the USDC it pays. Use a trusted qualified descriptor supplied by
your release/operator, not a descriptor guessed from a prediction. This guide is not release
qualification or deployment authorization. [Costs](../concepts/costs.md) explains the charges.

## The steps

```sh
# 1. The names a program on Base can use: tokens, protocol contracts, functions.
sauce globals --chain base

# 2. Check that the program compiles.
sauce compile pay.sauce.ts --chain base

# 3. Explicitly deploy, authenticate and persist your Pot before simulation or funding.
sauce pot --chain base --wallet me --deploy --pot-binding pot-binding.json

# 4. Try it on that verified Pot: no password or funds spent by the simulation.
sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:5 \
  --args <recipient> 1000000

# 5. Run it, with the USDC it pays in your Pot: sent there after step 3, or add --fund USDC:1
#    (the first --fund asks you to approve Permit2 for USDC, a transaction of its own).
sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
```

`--args` gives `main` its inputs in order: the recipient, then the amount in USDC's smallest unit
(1000000 is 1 USDC). Every step works the same with `--chain ethereum`, and on Solana with a few
differences ([Solana](cli-solana.md)).

## Try it: `sauce simulate`

`sauce simulate` runs the program on a copy of the chain as it is right now. It signs nothing,
sends nothing and changes nothing. On EVM it requires the Pot to be deployed and its authenticated
binding persisted, but it needs no signing key or actual token balance:

- **Whose Pot.** `--wallet me` names the owner without a password, and so does `--owner <address>`.
  That owner's selected Pot must already have a verified binding.
- **Missing code or provenance.** Simulation refuses it; it does not create counterfactual code
  or authorize a deployment. Keep existing services on their original authenticated binding.
- **Tokens the Pot does not hold.** `--assume-balance USDC:5` gives the Pot 5 USDC, in the copy
  only. Repeat it for more tokens. `ETH:0.1` gives it ETH.
- **The fee.** Every cook pays the **Kitchen**, the contract that makes Pots, a small flat fee in
  the chain's coin. An owner short of it is given it, in the copy, and told.

It prints what would happen on the deployed Pot:

```text
The cook succeeds from 0xYou: gas used 128999 for the cook, returns 0x
Left in the Pot, not in the owner's wallet:
  4 USDC (it held 5 USDC before)
  Only another cook moves it out. To end in a wallet, the program must send it there, or name the wallet as the recipient of the call that produces it.
Simulated with eth_simulateV1 on the state of block 36120411; nothing was signed or sent:
  1. the cook, from the owner 0xYou, gas used 128999
Assumed for this simulation only, by state override:
  the Pot holds 5 USDC: --assume-balance (its balance word 0x1d39…: Solidity mapping at slot 9)
  the owner holds 0.00000374478538635 ETH: the cook's value; it holds 0, and a real cook needs the value and gas
What moved, in order:
  [1] wallet 0xYou -> Pot 0x8a…     0.00000374478538635 ETH  the cook's value
  [2] Pot          -> Kitchen 0x…   0.00000374478538635 ETH  the Kitchen's fee
  [3] Pot          -> 0x66…         1 USDC
Net balance changes:
  0x8a… (the Pot): -1 USDC
  0x66…: +1 USDC
  0xYou (owner): -0.00000374478538635 ETH
  0x… (Kitchen): +0.00000374478538635 ETH
```

### Read what it prints

Read it top down:

1. **The headline**: the cook succeeds, with its gas, and what `main` returned. A program that
   declares a return type gets it decoded: `main returns Address: 0xd0b5…`.
2. **What stays in your Pot**, before and after. It is yours, but it is not in your wallet: only
   another program moves it out.
3. **What was simulated**: the cook on the authenticated Pot.
   `eth_simulateV1` is the node method that runs transactions in a simulated block and returns
   their logs.
4. **What was assumed**: the balances you gave with `--assume-balance`.
5. **What moved**, in order, each party by its role: `wallet` (you), `Pot`, `Kitchen`, a registry
   name, a token's symbol, and `mint` or `burn` for the zero address.
6. **Net balance changes**: what each address ends up with, more or less.

What moved is read from the cook's logs: ERC-20 transfers and approvals, in whole units, and native
transfers the node traces. It counts tokens only: a position a protocol keeps in its own books, with
no token for it, shows in no balance.

### Simulate on the block a quote saw

Everything the simulation reads (the Pot, the Kitchen's fee, the balances it assumes) and the
simulation itself run on one block: the latest when the command starts, or the one `--block`
names (a number, `latest`, `safe` or `finalized`). So a price limit computed from
`sauce pools` at one block can be simulated on that same state. The `Simulated with …` line says
which block.

### Give the Pot tokens it does not hold

`--assume-balance <TOKEN|address>:<amount>` takes the amount in whole tokens, as `--fund` does. The
command finds where the token keeps balances by asking it, then confirms the result with
`balanceOf`. A token whose balance is computed rather than stored (rebasing tokens, shares) is
refused. On Arc, `USDC:<amount>` sets the Pot's native balance, since that token is the native coin
and no token storage holds it, and `ETH:<amount>` (or `native:<amount>`) is native USDC there, not
ether.

### Check that a guard fires

`--expect-revert <text>` turns the result round: the command exits 0 only if the cook reverts with
a reason containing the text. Use it to show that a `require` stops a run it should stop:

```sh
sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:0.5 \
  --args <recipient> 1000000 --expect-revert "not enough USDC"
```

### When the simulation fails

A cook revert prints `The cook reverts: <reason>` and exits 1. The reason is decoded where it can be:

- `the program threw "…"` for your own `require` or `throw` message;
- a Pot, Kitchen, Router or Permit2 error by name, and ERC-20's standard errors, such as
  `ERC20InsufficientBalance`;
- a pool's short revert string with what it checks, such as
  `"SPL" (a V3-style pool's price-limit check …)`, `STF` from a token transfer, or a V2-style
  pair's `UniswapV2: K`.

A `main` argument named like a price limit (`sqrtPriceLimitX96`) at or past the pool's bounds is
named on stderr before the simulation. [Troubleshooting](troubleshooting.md) lists the common
failures with their fixes.

### When the endpoint has no `eth_simulateV1`

Some endpoints do not offer `eth_simulateV1`. The command then falls back to `eth_call` with state
overrides for assumed balances, still against the deployed, authenticated Pot. This does not
install missing Pot code. That route reports the result and estimated gas, but no logs, so not
what moved. The `Simulated with …` line names the route and why it fell back. Give an endpoint of
your own ([Your own endpoints](cli.md#your-own-endpoints)) to get the full report.

## Run it: `sauce run`

`sauce run` compiles the program, simulates it once more, signs it, sends it, and waits for it. Then
it prints the hash, the status and gas, the transaction's explorer page and its trace, what it cost,
and what moved:

```text
cook 0x5f…: success, gas used 184211, block 21004500
  explorer: https://basescan.org/tx/0x5f…
  trace (calls and balance changes, to open in a browser): https://app.blocksec.com/phalcon/explorer/tx/base/0x5f…
cost 0.000187 ETH: gas 184211 at 1000000 wei = 0.000184 ETH, L1 data 0.0000018 ETH, value 0.000001 ETH (the Kitchen's fee and any native the program spends)
What moved, in order:
  [1] Pot 0x8a… -> 0x66…  1 USDC
Net balance changes:
  0x8a… (the Pot): -1 USDC
  0x66…: +1 USDC
```

The explorer link opens the transaction on the chain's explorer. The trace link opens it on
BlockSec's Phalcon explorer, with every call and balance change.

### Read what it cost

The cost line adds up three things: the gas at the price the receipt records, an OP-stack chain's
L1 data fee where the receipt carries one (Base has one), and the value the cook carried. The value
is the Kitchen's fee plus any native coin the program spends.

### Create and authenticate your Pot separately

For a new EVM Pot, explicitly deploy with a trusted qualified descriptor:

```sh
sauce pot --chain base --wallet me --deploy --pot-binding pot-binding.json
```

The deployment is a transaction of its own, paid by the signer. Wait for actual code/profile,
identity and exact engine/compiler/Router binding verification and persistence before funding,
approvals, simulation or signing. `run` does not deploy a missing Pot, change its salt or repin
an existing binding. Missing expected code or provenance is a failure, not a repair request.

Solana retains its separate account/instruction lifecycle; see [Solana](cli-solana.md).

### Know what it refuses

A cook that would fail is never sent: the run simulates it first, stops with the reason and exits
with code 1. On a preview chain the run is refused before it reads anything
([Supported and preview chains](cli.md#supported-and-preview-chains)).

### Approve ahead with `--yes`

Required funding approvals, including Permit2 and allowance-mode funding, can be authorized with
`-y` (`--yes`; `--auto-approve` is its older name). With no terminal, or with `--json`, a run that
needs an approval sends nothing until authorized. Read what is requested before approving it.
This flag never authorizes hidden EVM Pot deployment or replacement: deployment and binding
verification must already be complete.

### Pay native coin the program spends

The cook's value defaults to the Kitchen's fee, read from the chain. When the program also spends
native coin, pass `--value <wei>` with the fee plus what it spends. A `--value` below the fee is
refused, since the cook would revert.

## Put tokens in your Pot

A program spends what your Pot holds. There are two ways to get tokens there.

**Send them to the Pot's address** only after deployment and binding verification, from any wallet
or exchange. `sauce pot --chain base --wallet me --deploy --pot-binding pot-binding.json` explicitly creates a new Pot.
Keep the verified binding before funding: CREATE3 prediction does not prove what code was deployed,
and an SDK update must not replace a saved Pot or its release.

**Or let the run pull them in.** `--fund` moves tokens from your wallet into the Pot in the same
transaction as the cook:

```sh
sauce run pay.sauce.ts --chain base --wallet me --fund USDC:1.5 --sweep --args <recipient> 1000000
```

- `--fund USDC:1.5` pulls 1.5 USDC. Amounts are whole tokens. `USDC:1500000n`, with an `n`, is in
  the token's smallest units. Repeat it for more tokens. `ETH:0.01` sends ETH with the cook.
- `--sweep` sends back to you, at the end, the Pot's whole balance of each funded token, not only
  what this run brought.

The pull, the program and the sweep are one transaction: they succeed or fail together. Your
balance of each token is checked before anything is sent. A bare integer is whole tokens too:
`USDC:1500000` is 1.5 million USDC, which the command points out on stderr.

The first time you fund a token, Permit2, the standard contract the pull goes through, needs your
approval for that token. The run asks:

```text
Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3) may move 0 of your USDC (base units), and this run needs 1500000. Approve Permit2 for USDC now? [y/N]
```

`y` sends the approval, then the cook. After that, each run needs only your signature, which the
run makes for you. A wallet whose policy limits the token refuses that approval: approving Permit2
makes every Permit2 allowance of the token you gave before spendable again, which no policy can
measure. From such a wallet, fund with `--fund-mode permit`, `allowance` or `transfer`.

### Choose how the run pulls tokens

`--fund-mode` chooses how the Pot is allowed to pull:

| Mode                | You sign or send                                               | What stands afterwards                        |
| ------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `permit2` (default) | A Permit2 signature for exactly this amount, to this Pot, once | Nothing for the Pot; your approval of Permit2 |
| `permit`            | The token's own EIP-2612 `permit` signature, for the Pot       | Nothing: the pull spends it                   |
| `allowance`         | An `approve` of the Pot for the amount, in a transaction first | The Pot's allowance, until a cook spends it   |
| `transfer`          | A plain `transfer` to the Pot, in a transaction first          | Nothing                                       |

`permit2` is the default because it works for every ERC-20, USDT included, where `permit` needs a
token that implements EIP-2612. It gives the Pot no allowance: each signature is for one amount, to
one spender, with a fresh nonce and a deadline ten minutes out, so it cannot be replayed or used
late. And the run stays one transaction, the cook itself.

`allowance` and `transfer` send a transaction before the cook. If the cook then fails, the
allowance stands until a later cook spends it, and transferred tokens stay in the Pot.

### Know what `--fund` does to your program

The command wraps the program: a new `main`, with the same parameters, first pulls each amount from
you into the Pot, then calls the program's own `main` with the arguments as given, then, with
`--sweep`, sends what is left back to you. A script gets the pulls after its imports and the sweep
after its last statement. The pulls are the same token functions a program can call itself
([Pulling tokens in](protocols-and-tokens.md#pulling-tokens-in)), with the checks
[Safety](../concepts/safety.md) describes.

Signatures are made locally, by the signer you gave, and no key is printed. A Permit2 signature
names the Pot as its spender; cooking on a private Pot requires the owner's authorization
(including for a signed cook on new EVM Pots). A revert inside Permit2 is reported by name: `SignatureExpired(…)` for a passed deadline,
`InvalidNonce()` for a nonce already spent.

`--fund` signs and sends only for your own Pot: one the chain shows is yours (its owner you, its
address the one a known release's Kitchen gives your owner and salt), or the one the run deploys
first. Any other `--pot`, or one whose owner the endpoint cannot read, is refused before anything
is signed or sent, by `sauce run`, and by `sauce simulate` given your key. With `--owner` and no
key, `sauce simulate` signs nothing and credits the Pot it is given. A wallet with a policy holds the
funding to its `chains` and its `to` (the Pot) first ([Wallets](cli-wallets.md)).

### Simulate a funded run

`sauce simulate` takes `--fund` and `--sweep` too. Given the owner's wallet, it asks for the
password and signs the pulls the run would make, sending nothing. With `--owner` and no key, the
pulls cannot be signed, so the Pot is credited what they would bring, and a shortfall in your
wallet is reported rather than refused. Each approval the run would send first is listed with its
gas.

## Where the results end up

What a program produces lands where it sends it. A swap with no other recipient, a lending
deposit's receipt tokens, a vault's shares: all stay in the Pot. They are yours, but your wallet
app will not show them, and only another program moves them out. So decide, for each result,
whether it should end in your wallet or stay in the Pot. To deliver it, send it to your wallet, or
name your wallet as the recipient of the call that produces it.

The command tells you, before and after. A simulation leads with
`Left in the Pot, not in the owner's wallet:`, and a run with `Left in the Pot, not in your wallet:`,
when the cook leaves anything there.
[Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md#where-a-programs-results-end) says more.

## More than one Pot

An owner has one Pot per **salt** ([glossary](../concepts/glossary.md)). Name another with
`--salt <label>`, and use the same salt in every command for that Pot:

```sh
sauce pot --chain base --wallet me --salt savings
sauce run pay.sauce.ts --chain base --wallet me --salt savings --args <recipient> 1000000
```

`--salt-hex 0x…` gives the exact 32 bytes instead (`--salt <label>` is `keccak256` of the label).

## Create a Pot by hand

New EVM creation is explicit. Supply a trusted qualified descriptor; `run`, `tx` and `sign`
require the deployed verified binding in the Pot store instead of deploying a missing Pot:

```sh
sauce pot --chain base --wallet me --deploy --pot-binding pot-binding.json
```

Without `--deploy`, `sauce pot` prints the Pot's address and the unsigned deployment, and reads the
chain: whether the released engine and Kitchen are there, the Kitchen's fee, and whether the Pot is
deployed and whose it is. With `--deploy` it sends the deployment, unless the Pot is already there,
and waits until the endpoint shows the Pot's code.

For new EVM Pots, prediction must match Kitchen's CREATE3 derivation, but this agreement does not
authenticate code. After deployment, verify the actual code/profile, identity, Router policy and
exact engine/compiler pairing, then persist the binding before transfers, approvals or signatures.
An unknown profile or mismatch stops subsequent work.

For existing services, load the saved deployed Pot and its explicit release first. A missing Pot
must fail, not trigger a new deployment. Historical Pots keep ordinary new work with their original
engine/compiler and Router bindings; a newer SDK or default does not repin them.
Offline prediction cannot establish readiness. These checks use the configured RPC endpoint and
cannot protect against dishonest chain responses. See
[Kitchen compatibility](kitchen-compatibility.md) and
[Troubleshooting](troubleshooting.md#this-sdk-does-not-match-the-deployed-kitchen).

Anyone may deploy a Pot, and it is its owner's either way. So `--deploy` with `--owner <address>`
deploys another owner's Pot, which your signer sends and pays for. On Solana the owner signs the
creation, so there the signer creates its own. `--format cast` prints the deployment as a
`cast send` line for [Foundry](https://getfoundry.sh/cast/overview) users, with `<RPC_URL>` and
`<PRIVATE_KEY>` left as placeholders.

## The Pots you made: `sauce pot list`

Every Pot a command creates is recorded in `~/.sauce/pots`:

```sh
sauce pot list
sauce pot list --chain base --owner 0xYou --json
```

`sauce pot import` records a Pot this machine did not create, read from the chain:

```sh
sauce pot import --chain base --pot 0x…
sauce pot import --chain base --owner 0xYou --salt savings
sauce pot import --chain solana --owner <pubkey>
```

`sauce pot list` reads no chain: `sauce pot --chain <chain> --owner <owner>` says whether a Pot is
still there. `--pots <dir>` keeps the store somewhere else.

### What a record holds

A Pot is recorded once the chain shows it deployed: by `pot --deploy`, by a run that deploys its
Pot, and by a deployment broadcast with `sauce send`. `sauce tx` sends nothing, and records nothing.
A record holds:

- the chain, on Solana with its cluster, so a devnet Pot is never recorded as mainnet's;
- the Pot's address, its owner and salt, and its kind: `private`, `private-fixed-router` or
  `shared`;
- the Kitchen and the release the Pot was created under, with the compiler whose programs it runs;
- the transaction that deployed it, the version of `sauce` that recorded it, and when.

Each record is one file, readable only by you, written once and never changed. No key or endpoint
is written there. The MCP server, run over stdio, keeps the same store in the same directory
([What a local server keeps](mcp-local.md)).

## Read the output as JSON

Every command here takes `--json` and prints one JSON object. `simulate` gives `ok` and
`leftInPot` first, then `block`, `gas`, `returns`, the moves (`moves`, each with `fromRole` and
`toRole`) and `balanceChanges`, with amounts as base-unit strings and whole units beside them. A
revert gives `reverted: true` and `error` first. `run` gives the cost and moves under `cook.cost`
and `cook.effects`, and `explorer` and `trace` beside each hash. Every flag is in
[the command reference](../reference/cli.md).

## Next

- Sign with a wallet policy, or with a key that never touches this machine:
  [Wallets and signing](cli-wallets.md).
- Write programs of your own: [Programs and arguments](cli-programs.md).
- What a cook is and where its results go: [Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md).
- Before you run with real funds: the [production checklist](production-checklist.md).
