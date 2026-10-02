# Nested intents

[Documentation](../README.md) · [Create an intent](intents.md) · [Routes API](../api/routes.md)

A nested intent is an intent opened inside another intent's body. You write it in SauceScript, in
the body of the outer one:
`Base.Portal.send(…).receive(…).then(() => { …; Ethereum.Portal.send(…).receive(…).then(() => { … }); })`.
When a
solver fills the outer intent, its body runs on Base, and in that same fulfilment it pays the inner
intent's reward into a vault on Base and publishes it. A solver fills the inner intent later, on
Ethereum. Each level is an intent of its own, filled, proven and claimed on its own: a failure on a
later level does not undo an earlier one.

The examples use Ethereum and Base, two of the chains the release supports. The `sauce` command and
the MCP server check the chains of the first level only, so keep every level on a supported chain
([Chains](../reference/chains.md)).

## Write the next intent inside the body

In TypeScript, the outer intent is a closure, and the inner one is written inside it:

```ts
import { Base, Ethereum, routes } from "@eco-incorp/sauce";
import { toHex } from "viem";

const usdc = (chain: typeof Base.chain) =>
  toHex(routes.registryTokenAddress(chain, "USDC")!, { size: 20 });
const executionFee = 1_000n; // Base's Kitchen fee: read it with destinationExecutionFee().

const built = Base.Portal.send({ token: usdc(Ethereum.chain), amount: 1_010_000n })
  .source("ethereum")
  .creator("0x4444444444444444444444444444444444444444") // every level's
  // What the solver brings to Base. It arrives at the Executor; the body measures the Pot.
  .receive({ token: usdc(Base.chain), amount: 1_000_000n })
  .fee(executionFee)
  .then(() => {
    // Runs on Base, in the fill of this intent: what the solver delivered, measured there.
    const amount = USDC.balanceOf(ctx.self());
    const payout = amount - amount / 1000n;
    // Opened, funded in Base's USDC and published on Base, in that same fill.
    Ethereum.Portal.send({ token: USDC, amount })
      .receive({ token: USDC, amount: payout })
      .then(() => {
        USDC.transfer(0x6666666666666666666666666666666666666666n, payout);
      });
  });
```

The chain names inside the closure come from the same imports as the host calls:
`import { Base, Ethereum }` serves both. Each chain export's `Portal` carries, besides its host
steps, the SauceScript ones that open an intent, so `Ethereum.Portal.send(…)` inside the closure
typechecks beside the token symbols and builtins a closure already has, and gives a SauceScript
intent, not a host one. Nothing is declared globally: a chain the closure names without importing
it is an error. The closure is never run: its text is compiled. So it names only what SauceScript
knows, a value of your script is written into it as a literal, and a bundler that renames imports
breaks it ([callbacks are compiled source](intents.md#callbacks-are-compiled-source)).
`built.sourceTxs()` is the wallet's funding and publication on Ethereum.

The same intent can be a file, all of it SauceScript, and the CLI opens it on the chain that pays
the outer reward. Its inputs are `main`'s parameters, and `sauce intent publish --args` fixes them
into the intents it publishes. The delivery is `.receive(...)`, and the lowering adds the transfer
into the Pot itself:

```js
// An intent from Ethereum to Base whose body opens an intent of its own, from Base back to
// Ethereum. All of it is SauceScript, opened on Ethereum and published from a wallet:
//   sauce intent publish nested-intent.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <recipient> <delivered> <reward>
//
//   recipient: Address  who is paid on Ethereum, at the end
//   delivered: Uint256  the USDC a solver delivers to Base, in base units (6 decimals)
//   reward: Uint256     the USDC on Ethereum that pays that solver
//
// The outer body runs on Base, in the fulfilment of the outer intent, so `amount` is measured there:
// what the solver delivered to the Pot. The inner intent carries it on to Ethereum, less a tenth of
// a percent the next solver keeps. Its reward is paid into its vault on Base's Portal, and it is
// published, in that same fulfilment.
//
// Every `USDC` is the USDC of the chain where its part runs: the outer reward's is Ethereum's; the
// outer body's, its delivery's and the inner reward's are Base's; the inner body's is Ethereum's.
function main(recipient: Address, delivered: Uint256, reward: Uint256) {
  Base.Portal.send({ token: USDC, amount: reward })
    .receive({ token: USDC, amount: delivered })
    .then(() => {
      const amount = USDC.balanceOf(ctx.self());
      const payout = amount - amount / 1000;
      Ethereum.Portal.send({ token: USDC, amount })
        .receive({ token: USDC, amount: payout })
        .then(() => {
          USDC.transfer(recipient, payout);
        });
    });
}
```

```sh
sauce intent publish nested-intent.sauce.ts --chain ethereum --keystore <keystore> \
  --args <recipient> 1000000 1010000
```

The command reads the fee from Base's Kitchen, since the outer body is a program and its cook pays
it, makes the wallet every level's creator, and counts the first level's deadlines from when it
builds the intent. Built with the same values, the two are the same intent, byte for byte:
[nested-intent.ts](../examples/nested-intent.ts) builds both and checks it. From TypeScript,
`routes.compileSauceProgram("ethereum", source, { args, intents }).intents` holds the intent the
file opens, `main`'s arguments fixed into it as the command fixes them, and
`routes.intentSourceTxs(intent, { portal })` publishes it from a wallet.

Nothing names a Portal, a prover, a Pot or an encoding: each level's are looked up for its own
chains. What you supply is what only you know: the amounts, and, where its default does not suit
you, a level's deadline, creator or fee.

## Where each name resolves

Each part of the file runs on one chain, and a token symbol, `chainId` or protocol address in it is
that chain's:

| Part                                                     | Runs on                         | `USDC` is  |
| -------------------------------------------------------- | ------------------------------- | ---------- |
| The outer `.send(...)`                                   | Ethereum, which escrows it      | Ethereum's |
| The outer body, and what its solver delivers, `.receive` | Base, the outer destination     | Base's     |
| The inner `.send(...)`                                   | Base: the outer body funds it   | Base's     |
| The inner body and its `.receive(...)`                   | Ethereum, the inner destination | Ethereum's |

A body and its delivery resolve on their destination; a reward resolves on the chain whose program
offers it, because that program pays it into the vault there. The rule repeats at every depth.
[Names resolve per chain](intents.md#names-resolve-per-chain) says what goes wrong when a name is
taken from the other chain.

## How the inner intent is funded

The outer body is more than token writes, so it is a program, run on Base's shared Pot. Its route
first moves the delivered USDC from the Portal's Executor into the Pot (the lowering adds that
transfer, from `.receive(...)`), then cooks the program, with Base's Kitchen fee as the call's
value; the route's native amount is that fee, which the solver sends.

When the program reaches the inner intent, it asks Base's Portal for its
vault, transfers each reward token there with `SafeERC20` semantics, sends any native amount from
the Pot, and calls `Portal.publish`. The inner intent is then on Base's Portal like any other:
`IntentPublished` names it, `isIntentFunded` counts it funded, and any solver can fill it.
`--intent-fund-via publishAndFund` (`fundVia` in `compile.intents`) approves the Portal and calls
`publishAndFund` instead; [how the reward is funded](intents.md#how-the-reward-is-funded) compares
the two.

All of that is one fulfilment. A short balance, a transfer that fails or a `require` that does not
hold reverts the whole of it ([a throw reverts everything](intents.md#a-throw-reverts-everything)):
the outer intent stays unfilled, and no inner intent exists. Once it lands, the inner intent stands
on its own.

Its hash exists only once the outer body has run, because its amounts are measured there. Read it
from the `IntentPublished` event of the outer fill: `sauce intent import <fill tx hash> --chain base`
stores the inner intent, after which `sauce intent status`, `fill`, `prove` and `claim` take it like
any other.

## Amounts measured as it runs

Any value the outer body computes can be an amount of the inner intent: a balance, as above, or a
swap's output, or arithmetic on either. The inner intent is encoded with a placeholder for each such
value, and the program splices the value in before it publishes. Here the inner reward is what a
swap on Base bought:

```js
import { uniswapV3 } from "@sauce/router";

// The nested intent with a swap in the middle: buy WETH on Base with the USDC delivered there, and
// send the WETH bought on to Ethereum. `bought` is the swap's output, known only when the outer body
// runs, and it is the inner intent's reward as it is. Opened on Ethereum and published from a
// wallet:
//   sauce intent publish nested-swap.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <recipient> <delivered> <reward> <minOut>
//
//   recipient: Address  who is paid the WETH on Ethereum, at the end
//   delivered: Uint256  the USDC a solver delivers to Base, in base units (6 decimals)
//   reward: Uint256     the USDC on Ethereum that pays that solver
//   minOut: Uint256     the least WETH the swap may buy on Base, in base units (18 decimals)
//
// The swap is on Base's Uniswap V3 WETH/USDC pool at the 0.05% tier, looked up where the body runs.
function main(recipient: Address, delivered: Uint256, reward: Uint256, minOut: Uint256) {
  Base.Portal.send({ token: USDC, amount: reward })
    .receive({ token: USDC, amount: delivered })
    .then(() => {
      const amount = USDC.balanceOf(ctx.self());
      const pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
      const bought = uniswapV3(pool, USDC, WETH, amount, 0, minOut, ctx.self());
      const payout = bought - bought / 1000;
      Ethereum.Portal.send({ token: WETH, amount: bought })
        .receive({ token: WETH, amount: payout })
        .then(() => {
          WETH.transfer(recipient, payout);
        });
    });
}
```

`bought` is known only when the body runs, and no one has to know it before. A floor is a
`require(...)` in the body, a margin is arithmetic, and a token's decimals are yours to convert, as
in any program. The [`@sauce/router` reference](../api/router.md) lists the swaps and what each
returns.

## Deadlines, creator and fee: each level its own

Every level takes the modifiers any intent takes, written on its own steps, and each one it leaves
out takes its default for that level ([Intent defaults](../reference/intent-defaults.md)):

- **Deadlines count from when the level opens.** The first level opens when it is built — the
  `sauce` command builds it, or the program opening it runs — and every level below it when the
  body above runs, in that fill. So each level has its own five minutes to be filled, and its
  reward its own seven days after that. A level that needs longer says so:
  `.receive(...).deadline(ctx.timestamp() + 3600)` is an hour from when that level opens.
- **The creator is the one above.** A level that names none takes the creator of the intent it is
  the body of, so one address reclaims an unearned reward of every level, each on the chain that
  escrowed it, and it must be an address its owner controls on each of them. `.creator(...)` on a
  level names another.
- **Each program body pays its own chain's Kitchen fee.** The `sauce` command reads the Kitchen of
  every chain a level's program runs on; `.fee(wei)` on a level gives that level's, and
  `compile.intents.executionFee` may be a function from the destination chain to its fee. In the
  two-level file only the outer body is a program, so only Base's fee is paid.
- **The Portal and the prover are per level.** Each is looked up for that level's own chains: the
  inner intent above is published on Base's Portal, its route names Ethereum's, and its reward names
  the prover for Base to Ethereum. An override in `compile.intents` applies to every level alike.

A command-line flag (`--intent-deadline`, `--intent-reward-deadline`, `--intent-creator`,
`--intent-fund-via`, `--intent-execution-fee`) or a field of `compile.intents` sets its value for
every level that does not set its own. A deadline given that way is one moment for all of them, so
a later level has whatever time the earlier ones leave.

## Three levels

The braces nest as deep as you write them. This file opens an intent to Base whose body opens the
next level on Ethereum, whose body opens the last, back on Base, each with the amount it measured
on arrival. It is published like the file above, from a wallet on Ethereum, `main`'s arguments
fixed into it ([cross-chain-cascade.ts](../examples/cross-chain-cascade.ts) compiles it):

```js
// Three hops, written as three intents opening one another: Base, then Ethereum, then Base again.
// All of it is SauceScript, opened on Ethereum and published from a wallet:
//   sauce intent publish cross-chain-cascade.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <recipient> <delivered> <reward>
//
//   recipient: Address  who is paid on Base, at the end
//   delivered: Uint256  the USDC a solver delivers to Base for the first hop, in base units
//   reward: Uint256     the USDC on Ethereum that pays that solver
//
// Only the first hop's amounts exist when this is signed. `amount` is measured on Base, while the
// first hop is being fulfilled. `arrived` is measured on Ethereum while the second is, by the
// program the middle body compiled to, and it is the reward of the third. Each level's numbers
// are filled in by the level above it, at that level's own execution time.
//
// The first two bodies are more than token writes, so each compiles to a program and runs on its
// chain's Pot, paying that chain's Kitchen fee, read for it; the `.receive(...)` of each names what
// a solver must deliver for it to have something to measure. Each level's deadlines count from when
// it opens, and every level's creator is the wallet that publishes the first.
//
// Every `USDC` is the USDC of the chain where that part runs. Each body's is its destination's. Each
// reward is escrowed by the program offering it: the first hop's in Ethereum's USDC, the second's in
// Base's and the third's in Ethereum's.
function main(recipient: Address, delivered: Uint256, reward: Uint256) {
  Base.Portal.send({ token: USDC, amount: reward })
    .receive({ token: USDC, amount: delivered })
    .then(() => {
      const amount = USDC.balanceOf(ctx.self());
      Ethereum.Portal.send({ token: USDC, amount })
        .receive({ token: USDC, amount })
        .then(() => {
          const arrived = USDC.balanceOf(ctx.self());
          Base.Portal.send({ token: USDC, amount: arrived })
            .receive({ token: USDC, amount: arrived })
            .then(() => {
              USDC.transfer(recipient, arrived);
            });
        });
    });
}
```

No amount below the first exists when this is signed. `amount` is measured on Base. `arrived` is
measured on Ethereum, while that level is being fulfilled, by the program the middle body compiled
to, and it is the reward of the third. Each level's numbers are filled in by the level above it, at
that level's own execution time.

The first two bodies measure and open an intent, so each is a program, cooked on its chain's Pot.
The `.receive(...)` of each names what the solver of that level delivers, so the program has
something to measure, and that level's route moves it into the Pot first. Each level is funded on
the chain whose program offers it: the second level's reward in Base's USDC, the third's in
Ethereum's, out of what the second level's solver delivered there.

Each cook pays its own chain's Kitchen fee, Base's and Ethereum's, which the command reads from
each; `.fee(wei)` on a level gives that level's instead.

Nesting is recursive rather than special-cased: the middle body is compiled by re-entering the same
pipeline, so the same lowering runs inside it at any depth. [Create an intent from inside a
program](intents.md#create-an-intent-from-inside-a-program) covers what may be captured, which bodies
are programs and which are plain token calls, and the functions and imports a body may use. The
hashes follow one level at a time: each level's is in the `IntentPublished` event of the fill above
it.

## The TypeScript builder: `.nest()`

The program form above is the way to write nested intents. `.nest(child, options)` is the lower
level underneath it: it attaches an intent you built in TypeScript to a route you built in
TypeScript, before either runs.

```ts
import { Base, Ethereum } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

export function attachChild(
  creator: routes.PortalAddress,
  parentReward: routes.PortalReward,
  childReward: routes.PortalReward,
  fees: { readonly base: bigint; readonly ethereum: bigint },
) {
  return Base.Portal.send(parentReward)
    .source("ethereum")
    .creator(creator)
    .receive([])
    .fee(fees.base)
    .nest(
      (on) =>
        Ethereum.Portal.send(childReward)
          .source(on)
          .creator(creator)
          .receive([])
          .fee(fees.ethereum)
          .then("function main() { return 1; }"),
      { requireCap: true, executionFee: fees.ethereum },
    )
    .then("function main() { return 1; }");
}
```

Reach for it where the program form does not reach:

- **A child built in TypeScript.** Each child is a host intent of its own, with its own reward,
  modifiers and body, attached to the parent before either runs.
- **Action programs.** A JSON action program has no action that opens an intent, so `.nest()` is how
  one is chained to another ([actions](actions.md#fund-a-child-from-a-measured-amount)).
- **A child that is never published.** The default `via: "transfer"` pays the child's vault from the
  parent's Pot and publishes nothing: share the child with your solver yourself.

`via: "publishAndFund"` publishes the child from the parent route, and `via: "dynamic"` builds it
with placeholders for amounts the parent measures — what the program form does by capturing a
variable. [Nesting in TypeScript](../api/routes.md#nesting-in-typescript) is the reference for the
three modes, their options and their ordering.
