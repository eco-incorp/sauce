---
name: sauce-intents
description: Cross-chain intents written in Sauce — a file that is the intent, Base(() => { ... }).reward({ ... }) as top-level statements with no main and its values as defines; how an intent is published, funded, discovered, filled, proven, claimed, cancelled and refunded (a sauce intent command each) (the intent hash, the per-intent vault, IntentPublished and IntentFunded, isIntentFunded); every way to publish and fund it (sauce intent publish from a wallet, sauce run from a Pot, a transfer into the vault then publish, cascade children, quoted intents); amounts measured on chain; token-only bodies versus program bodies; the delivery; on which chain each name resolves; the shared destination Pot and the Kitchen fee the solver pays; rehearsing both sides; and the deadline and creator every intent needs. Use when a program should continue on another chain, forward a swap or bridge output, build a cascade, pay a solver, or when the user mentions intents, rewards, vaults, solvers, Portals, provers, Executors or Pots.
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

## The lifecycle

An intent is three values: the **destination** chain, the **route** (what runs there: a salt, the
route's deadline, the destination Portal, `nativeAmount`, the tokens the solver delivers, and the
calls) and the **reward** (its deadline, the creator, the prover, a native amount and tokens). Its
hash is `keccak256(abi.encodePacked(uint64 destination, keccak256(route bytes), keccak256(abi.encode(reward))))`,
so every field is in it: the deadlines and the destination Kitchen's fee (the route's
`nativeAmount`) too. **Changing any of them is a different intent**: rebuild every transaction,
including any unsigned one printed earlier.

1. **Fund.** The reward sits in the intent's own **vault** on the source chain. Its address follows
   from the intent hash, so it exists before anything is published or deployed:
   `Portal.intentVaultAddress(destination, route, reward)` returns it, and tokens sent there count.
2. **Publish.** `Portal.publish` records the intent and emits `IntentPublished`, which solvers
   watch. It needs no funding and anyone may send it; sending it again re-emits the event.
3. **Discover and check.** A solver picks the intent up from `IntentPublished` (or, for an intent
   it quoted, from `IntentFunded`) and calls `Portal.isIntentFunded(destination, route, reward)`:
   true when the intent's status is Funded **or** the vault already holds the whole reward. A
   solver that finds it unfunded may retry for a while, then drop it: fund before or with the
   publication.
4. **Fill.** On the destination the solver calls the destination Portal's `fulfill`, sending the
   route's `nativeAmount` as value and delivering the route's tokens; the Portal's Executor runs the
   calls. Before the route's deadline, once. `fulfillAndProve` does the same and sends the proof in
   the same transaction, its value the `nativeAmount` plus the prover's fee.
5. **Prove.** The destination Portal's `prove(prover, sourceDomain, intentHashes, data)` hands what
   it recorded (the claimant, or a cancellation) to the destination's prover, which sends it to the
   reward's prover on the source chain for a fee it quotes (`fetchFee`). With Hyperlane, a relayer
   delivers the message; the source prover then records the claimant, which
   `provenIntents(intentHash)` returns.
6. **Claim.** Once the source has the proof, `withdraw(destination, routeHash, reward)`, sent by
   anyone, pays the vault's reward to the claimant the proof names (`batchWithdraw` claims several).
7. **Refund.** After the reward's deadline, with no proven fill, `refund(destination, routeHash,
reward)`, sent by anyone, returns everything the vault holds of the reward to the creator (the
   creator alone may send `refundTo` to choose another recipient). Before the deadline it reverts
   `InvalidStatusForRefund`. A vault that was funded but never published refunds the same way.
8. **Cancel, for an earlier refund.** Where the destination Portal has `cancel`, anyone may cancel
   an unfilled intent strictly after the route's deadline: no fill can land after it. Proving the
   cancellation (5) lets the creator refund at once, before the reward's deadline. A cancellation is
   recorded as a claimant no key controls, so the source Portal must refuse to pay it
   (`withdraw` reverting `CancelledIntent`); prove one only to a source Portal that does. Prove it
   once the cancel is final on the destination: a reorg that let a fill in first would leave that
   solver unpaid.

## Every step from the command line

`sauce intent` drives the whole lifecycle. Each verb takes the intent file (with `--chain`, the
source, and the flags it was built with) or the intent's hash, and `--config sauce.config.json`
with both chains' endpoints. Every intent the commands publish, fill or import goes into a local
store in your home directory (`--store <dir>` names another), so later steps name it by hash; where it
stands is read from the chains each time.

```sh
npx sauce intent publish --config sauce.config.json --keystore <keystore>
npx sauce intent status <intent-hash> --config sauce.config.json
npx sauce intent fill <intent-hash> --config sauce.config.json --send --keystore <keystore>
npx sauce intent prove <intent-hash> --config sauce.config.json --keystore <keystore>
npx sauce intent claim <intent-hash> --chain <source> --config sauce.config.json --keystore <keystore>
npx sauce intent refund <intent-hash> --chain <source> --config sauce.config.json --keystore <keystore>
npx sauce intent cancel <intent-hash> --config sauce.config.json --keystore <keystore>
npx sauce intent import <tx-hash> --chain <source> --config sauce.config.json
```

- `publish` with no file asks, at a terminal, for the chains, the token and amount delivered and
  to whom, the reward (suggested: what is delivered plus a margin over the solver's destination
  costs), the deadlines and the prover, writes the intent as a `.sauce.ts` file, rehearses
  publishing and filling it, and publishes it once approved. Each question has a flag
  (`--source`, `--destination`, `--token`, `--amount`, `--recipient`, `--reward-token`,
  `--reward`, `--prover`, `--fill-deadline`, `--reward-deadline`), so it runs without a terminal.
- `status` prints the intent's state on both chains (unfunded, funded, filled, cancelled, proven,
  cancelProven, claimed, refunded), its deadlines, and whether each next step can be taken now,
  with why not and from when.
- `fill --send` fills it as a solver, from the signer: rehearsed first on the signer's real
  balances and not sent if it reverts, and what it spends (each delivered token, and the value)
  shown for approval (`--auto-approve` approves). It sends the approvals (zero first where a smaller one
  stands), then `fulfillAndProve` with the prover's fee, or `fulfill` with `--no-prove`. It prints
  the Hyperlane message the proof travels as.
- `prove` sends the proof of a filled or cancelled intent, paying the prover's fee; `claim` pays the
  reward once the source has the proof, and says so, with the message's id, while it has not;
  `refund` returns the reward when the Portal allows it, and says from when otherwise; `cancel`
  cancels after the route's deadline, refusing where either Portal lacks the cancellation support
  described above.
- Without a signer, each prints its transactions unsigned, for a wallet to send in order.
- `sauce intent` alone, at a terminal, lists the stored intents with where each stands, and runs
  these on the one picked.

The Portal's functions, events and errors, with selectors and topics, are in
[references/portal.md](references/portal.md).

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
  [../sauce-globals/references/tokens.md](../sauce-globals/references/tokens.md), with their
  addresses in the destination's file in `sauce-chains`
  ([../sauce-chains/references/arbitrum.md](../sauce-chains/references/arbitrum.md) for Arbitrum).
- **The rule repeats at every depth.** An intent opened inside a body is funded on that body's
  chain, so its reward resolves there and its own body on its own destination.
- **Name a token by a symbol, a literal or a define, never by a top-level `const`.** A top-level
  `const` holding a token's address, used in the reward or the delivery, counts as a value the file
  computes, so the compile refuses the intent, saying the token's address must be known when the
  intent is built, and so does `sauce intent publish`. A `const` inside the braces is fine.
- A literal address means that address everywhere, and so does a define whose name no chain uses
  (`RECIPIENT`). A define under a chain-scoped name (`USDC`, `chainId`, a protocol address) is a
  name on the source chain: it applies to the file's own statements and the reward, and a body on
  another chain keeps that chain's value.

## Publishing and funding

| Way                                       | What is sent                                                               | Emits                             | Choose it when                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| (a) From a wallet, `sauce intent publish` | `approve(Portal, reward)` per token, then `publishAndFund`                 | `IntentPublished`, `IntentFunded` | every amount is known when you build it, and a wallet pays                          |
| (b) From a Pot, `sauce run`               | the same, by the Pot, inside the cook                                      | `IntentPublished`, `IntentFunded` | an amount is measured on chain, or the intent must open atomically with other steps |
| (c) Transfer into the vault, then publish | a token transfer to `intentVaultAddress(...)`, then `publish`: no approval | `IntentPublished`                 | an intent solvers discover from its publication; no allowance, USDT needs nothing   |

**(a) From a wallet.** `sauce intent publish` builds each intent before anything runs, so every amount
must be a literal or a define, and the file may do nothing but open intents (a file with a measured
amount is refused, with `sauce run` named instead). The wallet approves each reward token to the
**Portal** for exactly the reward (with an endpoint, a smaller allowance already standing is reset
to zero first, as USDT requires) and calls `publishAndFund(destination, route, reward, false)`,
which pulls the reward into the vault and marks the intent Funded.

```sh
npx sauce intent publish pay-on-arbitrum.sauce.ts --chain base --config sauce.config.json \
  --from <address> --dry-run --assume-balance USDC:1 --define RECIPIENT=<address> \
  --define AMOUNT=1000000 --intent-deadline <unix seconds> --intent-creator <address>
npx sauce intent publish pay-on-arbitrum.sauce.ts --chain base --from <address> --format json \
  --define RECIPIENT=<address> --define AMOUNT=1000000 \
  --intent-deadline <unix seconds> --intent-creator <address>
```

- `--dry-run` rehearses the approve and `publishAndFund` together from the wallet and sends
  nothing; `--assume-balance USDC:1` (whole tokens) gives the wallet the reward for the rehearsal
  only, so a wallet that does not hold it yet can rehearse. Without `--dry-run`,
  `--keystore <keystore>` in place of `--from` signs and sends them.
- `--format json` (or `cast`) with `--from` and no signer prints the transactions, unsigned, for that
  wallet to send in order. With no endpoint each approve is planned without reading the standing
  allowance; with one, it reads it.

**(b) From a Pot.** `sauce run` cooks the file on your Pot, and opening the intent is one of its
steps: the Pot approves the Portal (zero first when an allowance stands) and calls `publishAndFund`
in the same transaction as everything else, so nothing is published unless the whole cook
succeeds. Values measured while it runs can flow into the intent: in
`const amount = USDC.balanceOf(ctx.self())`, `amount` does not exist until the program runs, and
using it inside the braces, in the delivery or in the reward is enough. The package encodes the
intent with a slot for it, and the program writes the measured value in before it publishes. Any
one-word value can be carried this way.

```sh
npx sauce run cross-chain.sauce.ts --chain base --config sauce.config.json --keystore <keystore> \
  --define BENEFICIARY=<address> --intent-deadline <unix seconds> --intent-creator <address> \
  --intent-execution-fee <wei>
```

**(c) Transfer into the vault, then publish.** The vault counts whatever it holds, so the reward can
be sent straight to it and the intent published after: no approval, so no allowance left standing
and nothing special for USDT, and `isIntentFunded` is true from the moment the transfer lands. The
intent's status stays Initial (only `publishAndFund` or `fund` set Funded), and `isIntentFunded`,
the check solvers make, accepts either. From a Pot, do both in one cook, with the program reading the vault from the Portal
itself so it cannot be wrong:
[examples/fund-by-transfer.sauce.ts](examples/fund-by-transfer.sauce.ts) takes the intent as
`publish`'s three arguments, transfers each reward token to
`intentVaultAddress(destination, route, reward)` and calls `publish(destination, route, reward)`,
which returns the intent hash and the vault. Those three arguments are the first three of the
`publishAndFund` that `sauce intent publish … --from <address> --format json` prints for the file; decode
them with its signature (in [references/portal.md](references/portal.md)).

```sh
npx sauce run fund-by-transfer.sauce.ts --chain base --config sauce.config.json \
  --keystore <keystore> --args <portal> <destination> <route> <reward>
```

- **From a wallet**, it is two transactions: **transfer first, then publish**, so a solver that sees
  `IntentPublished` finds the intent funded. If the publish fails or is never sent, nothing is lost:
  publish later (the vault still holds the reward), or `refund` after the deadline.
- **What the CLI emits today**: `sauce intent publish` and `sauce run` fund every intent with the approve
  and `publishAndFund` of (a) and (b); (c) is written by hand, as in the example.
- A native reward (`reward.nativeAmount`) is native coin sent to the vault the same way; the example
  funds tokens only and refuses a native reward.

**Quoted intents.** A solver that quoted an intent marks its quote funded when it sees
`IntentFunded`, which only `publishAndFund` and `fund` emit. For an intent built from a solver's
quote, fund it with `publishAndFund`, (a) or (b), not by transfer.

`sauce inspect <file> --chain <chain>` with the same defines and intent flags prints each intent
the file opens: its destination, hashes, the route's calls and the reward, with every measured value
named.

## Two kinds of body

| The body is…                                                                                                | Lowers to                                                    | Needs                                                                  | Token writes                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| only `transfer`/`approve` calls on a symbol or `Token(address)`, with literal, define or captured arguments | plain calls the destination Portal's Executor makes          | nothing more: no Pot, no Kitchen fee                                   | USDT works and `approve` is reset to zero first, but a `false` return is **not** detected |
| anything else: a local, a balance read, a condition, a protocol call, `transferFrom`, a nested intent       | a program compiled for the destination and cooked on its Pot | the destination's Kitchen fee, and the delivery as the second argument | SafeERC20: a `false` return reverts the fulfilment                                        |

The Executor checks only that each call did not revert, so a token-only body's transfer that
returns `false` fills the intent with nothing moved; a call with data to an address with no code
reverts `CallToEOA`. A program body must say what the solver delivers, because a balance read
inside it reads what is there, not what must be brought:

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

The body can be any program for the destination. It is written inside the braces and uses the
file's defines as values. It may also use what the file declares: its imports (an ABI, a library)
and its helper functions, each compiled into the body's program for the destination. It calls
contracts by namespace (`UniswapV3.Factory.getPool(...)`), through an imported binding, or by
selector, with `evm.static(address, data)` for a read and `evm.call(address, value, data)` for a
write, `data` being the selector bytes `.concat(abi.encode(...))`. A swap is a `@sauce/router`
call (`sauce-swaps`), imported at the top of the file. Every unsold input and every output leaves the destination Pot
before the body ends, and a refund the body makes lands on the destination chain. The body runs on
the shared intent Pot, which holds nothing of anyone's between intents, so it may return a token's
whole balance there, as the refunds below do; a program on an owner's Pot returns only what is left
of its own amount instead (`sauce-distributed-swap`).

A one-pool swap, with the guard every swap needs (`sauce-swaps`): WETH a solver delivers on Base is
sold on the Uniswap V3 0.05% pool down to `SQRT_PRICE_LIMIT_X96`, at least `MIN_OUT` USDC goes to
`RECIPIENT`, and any unsold WETH to `REFUND_TO`, on Base. A fill below `MIN_OUT` reverts the whole
fulfilment, so set it from the limit (`sauce-distributed-swap` has the recipe), never above what the
pool can pay.

```sauce chain=arbitrum define=AMOUNT_IN,REWARD,SQRT_PRICE_LIMIT_X96,MIN_OUT,RECIPIENT,REFUND_TO
import { uniswapV3 } from "@sauce/router";

Base(
  () => {
    const pool = UniswapV3.Factory.getPool(WETH, USDC, 500n); // Base's 0.05% tier
    require(pool != 0n, "no WETH/USDC pool at 0.05%");
    // Pays RECIPIENT the USDC, and reverts the whole fulfilment below MIN_OUT.
    uniswapV3(pool, WETH, USDC, AMOUNT_IN, SQRT_PRICE_LIMIT_X96, MIN_OUT, RECIPIENT);
    const unsold = WETH.balanceOf(ctx.self()); // the shared Pot: return all of it
    if (unsold > 0n) {
      WETH.transfer(REFUND_TO, unsold);
    }
  },
  { tokens: [{ token: WETH, amount: AMOUNT_IN }] }, // Base's WETH, which the solver delivers
).reward({ tokens: [{ token: WETH, amount: REWARD }] }); // the source chain's WETH
```

`REWARD` must exceed what the solver delivers, `AMOUNT_IN`, by what filling costs it (below). To buy
WETH instead, swap `USDC` for `WETH` and deliver USDC: USDC is token1 on Base, so the limit is then
a ceiling, the `buy` block of `sauce price`.
[examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) is the same with the distributed
swap (`sauce-distributed-swap`) as the body: every Uniswap V3 and V4 pool with liquidity, best taker
price first, each up to its own fee-adjusted limit. It swaps through `@sauce/router` and reads each
pool's own state by selector, which needs no import:

| Call                                                                                | Selector                                 |
| ----------------------------------------------------------------------------------- | ---------------------------------------- |
| a V3-style factory's `getPool(address,address,uint24)` (Uniswap V3, PancakeSwap V3) | `0x1698ee82`                             |
| a Slipstream factory's `getPool(address,address,int24)`                             | `0x28af8d0b`                             |
| a pool's `slot0()`, `liquidity()`, `fee()`                                          | `0x3850c7bd`, `0x1a686502`, `0xddca3f43` |

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
does not undo an earlier one. The child is published and funded **by the parent's body**, as (b)
above: when the Arbitrum level runs, the shared Pot there approves Arbitrum's Portal and calls
`publishAndFund`, paying the Optimism level's reward from what it holds, in Arbitrum's USDC, so the
child is published like any other intent and any solver can discover it. Each level's deadline must
be no earlier than its parent's. (The TypeScript cascade builder, `.nest()` in `sauce-typescript`,
instead funds a child by a transfer into its vault by default, with no publication of its own, and
takes `publishAndFund` as an option.)

## What the compile supplies, and what you pass

The Portal, the prover, the destination Pot and the encoding are looked up from the eco-routes
registry, which records each chain's Portal and a prover deployed on both sides. Each chain's file in
`sauce-chains` says whether it takes intents and gives its Portal, Executor and shared intent Pot
([../sauce-chains/references/index.md](../sauce-chains/references/index.md)). Three values are the
developer's:

- **`--intent-deadline <unix seconds>`**: when the intent must be filled by.
- **`--intent-creator <address>`**: who may reclaim an unearned reward. Never a Pot.
- **`--intent-execution-fee <wei>`** for a program body: the destination Kitchen's fee. It is
  mutable on chain and lives on the destination, so read it there just before sending: an
  `eth_call` of `executionFee()` on the destination's Kitchen (its address is in the chain's file in
  `sauce-chains`), or pass `--intent-execution-fee auto`, which reads it through `--config`. An
  increase before the fill makes the cook, and the fulfilment, revert.

**Units and defines.** Amounts are base units (`AMOUNT=1000000` is 1 USDC); only `--assume-balance`
and `--fund` take whole tokens. In a `--defines` file, write an address or any value past 2^53 as a
JSON string (`"AMOUNT_IN": "1000000000000000000"`): a JSON number loses precision. The intent file
stays top-level statements with no `main`, so every input is a define.

Refused at compile time, never silently changed: a name that is neither a define nor a program
variable, a missing deadline, creator or fee, a chain with no eco-routes deployment, a pair with no
prover deployed on both sides.

## The destination side

- **The shared Pot.** A program body cooks on the destination Portal Executor's **shared Pot** (its
  owner is the Executor, its salt zero); the destination's file in `sauce-chains` gives the Pot and
  the Executor. **The Pot must exist before any fill**: until it does, every fulfilment of a program
  body reverts (`CallToEOA`). `npx sauce pot --chain <destination> --owner <Executor>` prints its
  address and deploy transaction; with `--deploy --config sauce.config.json --keystore <keystore>`
  any signer deploys it (the Pot is the Executor's either way), and an existing one is reported, not
  redeployed; `sauce intent fill` says whether it is deployed on the destination, and deploys it in its
  rehearsal when it is not. Anything left in the Pot after the program, token or allowance, belongs
  to the next intent through that Portal: approve exactly what is spent and move every remainder
  out.
- **What the solver pays.** The Kitchen fee becomes the route's `nativeAmount`: the solver sends it,
  in the destination's native coin, as the value of `fulfill`, and pays the destination gas too.
  Nothing in the reward pays either back, so the margin (the reward minus what the solver delivers)
  must cover both; a body that reads and swaps on many pools costs a lot of gas, so measure it in a
  rehearsal (below). Solvers apply checks of their own, such as the reward covering the route's
  tokens plus their fee, and decide which routes they fill.
- **Refunds of unsold input land on the destination**, where the body runs.

## Rehearse both sides before a solver does

- **The source side**: `sauce intent publish --dry-run --assume-balance …` (above) rehearses the approve and
  `publishAndFund`; `sauce simulate` rehearses a file run from a Pot.
- **The fill, on the destination**: the body runs there, when a solver fills the intent, and that is
  where a swap misses its minimum or a refund fails. Rehearse it with `sauce intent fill`, the same file
  and flags, before publishing; it signs nothing and sends nothing:

```sh
npx sauce intent fill swap-on-base.sauce.ts --chain <chain> --config sauce.config.json \
  --defines <defines.json> --intent-deadline <unix seconds> --intent-creator <address> \
  --intent-execution-fee <Base Kitchen fee in wei>
```

On each intent's destination it runs, in one simulated block, what a solver sends: the shared
Pot's deployment when the body cooks on it and nobody has deployed it yet, the solver's approval
of the destination Portal for the delivered tokens, then `Portal.fulfillAndProve` with the
Kitchen's fee and the prover's fee as its value (or `Portal.fulfill` with the Kitchen's fee alone,
with `--no-prove` or a prover it does not drive). The solver is given the delivered tokens for the rehearsal only. It prints each
transfer, each address's net change (an address a define holds is named by the define) and what
the shared Pot and the Executor were left holding, which must be nothing; or why the fill
reverts, down to the body's own `require` message. It warns when the shared Pot is not deployed,
and when `--intent-execution-fee` is below the destination Kitchen's fee, naming the fee to pass.
`--config` must name the destination chain's endpoint (`--rpc-url` works when every intent goes
to one chain, and is then that chain's endpoint). An intent that uses a value measured on chain
cannot be rehearsed this way: its route exists only once the program runs. Fix what it reports
and rehearse again before `sauce intent publish` or `sauce run`. With `--send` and a signer,
`sauce intent fill` then fills it for real (above).

- **The body alone, as a program**: copy the body (what is inside the braces) into a file of its own,
  top-level statements with the same defines, and rehearse it as a program for the destination,
  with the delivered tokens assumed in the Pot. It runs on your Pot instead of the shared one, but
  executes the same calls, shows what moves, and gives the gas:

```sh
npx sauce simulate one-pool-body.sauce.ts --chain base --owner <address> \
  --config sauce.config.json --assume-balance WETH:0.001 --define AMOUNT_IN=1000000000000000 \
  --define SQRT_PRICE_LIMIT_X96=<sqrtPriceX96> --define MIN_OUT=<amount> \
  --define RECIPIENT=<address> --define REFUND_TO=<address>
```

- **The fill by hand**, as a solver sends it, on a fork of the destination
  (`anvil --fork-url <destination endpoint>`), with any client:
  1. Get the intent: `sauce inspect <file> --chain <source> --json`, with the same defines and
     intent flags, prints each intent's `intentHash`, `routeHash`, `rewardHash`, route and reward;
     the raw route bytes are the `route` argument of the `publishAndFund` that
     `sauce intent publish <file> … --from <address> --format json` prints (their keccak-256 is
     `routeHash`).
  2. Make sure the shared Pot exists (above).
  3. Hold the route's `tokens` in an account and approve the **destination** Portal for each;
     `fulfill` pulls them from the sender.
  4. From that account, call the destination Portal's
     `fulfill(bytes32 intentHash, Route route, bytes32 rewardHash, bytes32 claimant)` with **value =
     the route's `nativeAmount`**, the route decoded from its bytes and the claimant the solver's
     address as 32 bytes. Less value reverts `InsufficientNativeAmount(sent, required)`, a missing
     Pot `CallToEOA(<Pot>)`, and a body that reverts surfaces as the Executor's `CallFailed`, with
     the body's own reason inside.
  5. Read the outcome: what the recipient got, what was refunded, the gas, and that the Pot holds
     nothing.

Solana destinations are not built this way (see `sauce-solana`). An application can also build an
intent from TypeScript around a program it compiles itself (`sauce-typescript`).

## Examples

- [examples/cross-chain.sauce.ts](examples/cross-chain.sauce.ts) forwards the Pot's USDC to Aave on
  Arbitrum. It measures its amount, so it runs from a Pot.
- [examples/swap-on-base.sauce.ts](examples/swap-on-base.sauce.ts) is the distributed swap as the
  body of an intent to Base. Its amounts are defines, so it can be run from a Pot or published from a
  wallet.
- [examples/fund-by-transfer.sauce.ts](examples/fund-by-transfer.sauce.ts) funds an intent by a
  transfer into its vault and publishes it, in one cook on a Pot.
- [examples/intents.mts](examples/intents.mts) compiles the intent files, with the deadline, the
  creator, Base's and Arbitrum's fees and the recipient as developer inputs, and pins on which chain
  each name resolves, the fee requirement, the token-only case, the selectors above, and the
  rehearsal's transactions: the Pot's deploy and `fulfill` with the fee as its value.
