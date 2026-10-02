# Nested intents

[Documentation](../README.md) · [Create an intent](intents.md) · [Routes API](../api/routes.md)

A nested intent is an intent opened inside another intent's body. You write it in SauceScript, in
the braces of the outer one: `Base(() => { …; Ethereum(() => { … }).reward({ … }); })`. When a
solver fills the outer intent, its body runs on Base, and in that same fulfilment it pays the inner
intent's reward into a vault on Base and publishes it. A solver fills the inner intent later, on
Ethereum. Each level is an intent of its own, filled, proven and claimed on its own: a failure on a
later level does not undo an earlier one.

The examples use Ethereum and Base, two of the chains the release supports. The `sauce` command and
the MCP server check the chains of the first level only, so keep every level on a supported chain
([Supported chains](../README.md#supported-chains)).

## Write the next intent inside the body

In TypeScript, the outer intent is a closure, and the inner one is written inside it:

```ts
import { Base, destinationPot, Ethereum, routes, token } from "@eco-incorp/sauce";
import { toHex } from "viem";

const usdc = (chain: typeof Base.chain) =>
  toHex(routes.registryTokenAddress(chain, "USDC")!, { size: 20 });
const BASE_USDC = usdc(Base.chain);
const RECIPIENT = 0x6666666666666666666666666666666666666666n;
const AMOUNT = 1_000_000n;
const executionFee = 1_000n; // Base's Kitchen fee: read it with destinationExecutionFee().

const built = Base(
  () => {
    // Runs on Base, in the fill of this intent: what the solver delivered, measured there.
    const amount = USDC.balanceOf(ctx.self());
    const payout = amount - amount / 1000n;
    // Opened, funded in Base's USDC and published on Base, in that same fill.
    Ethereum(() => {
      USDC.transfer(RECIPIENT, payout);
    }).reward({ tokens: [{ token: USDC, amount }] });
  },
  {
    execution: { value: executionFee },
    deadline: 2_000_000_000n,
    rewardDeadline: 2_000_003_600n,
    creator: "0x4444444444444444444444444444444444444444", // every level's
    defines: { RECIPIENT },
    // What the solver brings to Base. It arrives at the Executor; the body measures the Pot.
    tokens: [{ token: BASE_USDC, amount: AMOUNT }],
    precalls: [
      token.Token.transfer({
        token: BASE_USDC,
        to: destinationPot(Base.chain),
        amount: AMOUNT,
      }).toCall(),
    ],
  },
).reward({
  source: Ethereum.chain,
  deadline: 2_000_003_600n,
  tokens: [{ token: usdc(Ethereum.chain), amount: 1_010_000n }],
});
```

The chain names inside the closure come from the same imports as the host calls:
`import { Base, Ethereum }` serves both. Each chain export carries, besides its host signature, the
SauceScript call that opens an intent, so `Ethereum(() => { … })` inside the closure typechecks
beside the token symbols and builtins a closure already has, and gives a SauceScript intent, not a
host one. Nothing is declared globally: a chain the closure names without importing it is an error.
The closure is never run: its text is compiled, so `RECIPIENT` reaches it as a
define, and a bundler that renames imports breaks it
([callbacks are compiled source](intents.md#callbacks-are-compiled-source)). `built.sourceTxs()` is
the wallet's funding and publication on Ethereum.

The same intent can be a file, all of it SauceScript, and the CLI opens it on the chain that pays
the outer reward. Here the delivery is the second argument, and the lowering adds the transfer into
the Pot itself:

```js
// An intent from Ethereum to Base whose body opens an intent of its own, from Base back to
// Ethereum. All of it is SauceScript, opened on Ethereum:
//   sauce intent publish nested-intent.sauce.ts --chain ethereum --define AMOUNT=… --define REWARD=…
//     --define RECIPIENT=… --intent-deadline … --intent-creator … --intent-execution-fee auto
//
// The outer body runs on Base, in the fulfilment of the outer intent, so `amount` is measured there:
// what the solver delivered to the Pot. The inner intent carries it on to Ethereum, less a tenth of
// a percent the next solver keeps. Its reward is paid into its vault on Base's Portal, and it is
// published, in that same fulfilment.
//
// Every `USDC` is the USDC of the chain where its part runs: the outer reward's is Ethereum's; the
// outer body's, its delivery's and the inner reward's are Base's; the inner body's is Ethereum's.
Base(
  () => {
    const amount = USDC.balanceOf(ctx.self());
    const payout = amount - amount / 1000n;
    Ethereum(() => {
      USDC.transfer(RECIPIENT, payout);
    }).reward({ tokens: [{ token: USDC, amount }] });
  },
  { tokens: [{ token: USDC, amount: AMOUNT }] },
).reward({ tokens: [{ token: USDC, amount: REWARD }] });
```

```sh
sauce intent publish nested-intent.sauce.ts --chain ethereum \
  --define AMOUNT=1000000 --define REWARD=1010000 --define RECIPIENT=<recipient> \
  --intent-deadline <unix seconds> --intent-creator <your address> \
  --intent-execution-fee auto
```

`auto` reads the fee from Base's Kitchen: the outer
body is a program, and its cook pays it. With the same values the two are the same intent, byte for
byte: [nested-intent.ts](../examples/nested-intent.ts) builds both and checks it. From TypeScript,
`routes.compileSauceProgram("ethereum", source, { defines, intents }).intents` holds the intent the
file opens, and `routes.intentSourceTxs(intent, { portal })` publishes it from a wallet.

Nothing names a Portal, a prover, a Pot or an encoding: each level's are looked up for its own
chains. What you supply is what only you know: the deadlines, the creator, the amounts, and the fee
of the Kitchen on the chain whose body is a program.

## Where each name resolves

Each part of the file runs on one chain, and a token symbol, `chainId` or protocol address in it is
that chain's:

| Part                                                        | Runs on                         | `USDC` is  |
| ----------------------------------------------------------- | ------------------------------- | ---------- |
| The outer `.reward(...)`                                    | Ethereum, which escrows it      | Ethereum's |
| The outer body, and what its solver delivers (`{ tokens }`) | Base, the outer destination     | Base's     |
| The inner `.reward(...)`                                    | Base: the outer body funds it   | Base's     |
| The inner body                                              | Ethereum, the inner destination | Ethereum's |

A body and its delivery resolve on their destination; a reward resolves on the chain whose program
offers it, because that program pays it into the vault there. The rule repeats at every depth.
[Names resolve per chain](intents.md#names-resolve-per-chain) says what goes wrong when a name is
taken from the other chain.

## How the inner intent is funded

The outer body is more than token writes, so it is a program, run on Base's shared Pot. Its route
first moves the delivered USDC from the Portal's Executor into the Pot (the lowering adds that
transfer, from the second argument), then cooks the program, with Base's Kitchen fee as the call's
value; the route's native amount is that fee, which the solver sends.

When the program reaches the inner `.reward(...)`, it asks Base's Portal for the inner intent's
vault, transfers each reward token there with `SafeERC20` semantics, sends any native amount from
the Pot, and calls `Portal.publish`. The inner intent is then on Base's Portal like any other:
`IntentPublished` names it, `isIntentFunded` counts it funded, and any solver can fill it.
`--intent-fund-via publishAndFund` (`fundVia` in the options) approves the Portal and calls
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

// The same shape with a swap in the middle: buy WETH on Base with the USDC delivered there, and send
// the WETH bought on to Ethereum. `bought` is the swap's output, known only when the outer body
// runs, and it is the inner intent's reward as it is. POOL (a Base WETH/USDC Uniswap V3 pool),
// MIN_OUT, AMOUNT, REWARD and RECIPIENT are defines.
Base(
  () => {
    const amount = USDC.balanceOf(ctx.self());
    const bought = uniswapV3(POOL, USDC, WETH, amount, 0n, MIN_OUT, ctx.self());
    const payout = bought - bought / 1000n;
    Ethereum(() => {
      WETH.transfer(RECIPIENT, payout);
    }).reward({ tokens: [{ token: WETH, amount: bought }] });
  },
  { tokens: [{ token: USDC, amount: AMOUNT }] },
).reward({ tokens: [{ token: USDC, amount: REWARD }] });
```

`bought` is known only when the body runs, and no one has to know it before. A floor is a
`require(...)` in the body, a margin is arithmetic, and a token's decimals are yours to convert, as
in any program. The [`@sauce/router` reference](../api/router.md) lists the swaps and what each
returns.

## Deadlines, creator and fee: one set for every level

Every intent a file opens, at every depth, takes the same route deadline, reward deadline, creator,
funding mode, salt and execution fee: `--intent-deadline`, `--intent-reward-deadline`,
`--intent-creator`, `--intent-fund-via` and `--intent-execution-fee`, or `deadline`, `rewardDeadline`,
`creator` and `fundVia` in `IntentOptions` and the rest in `compile.intents`. A `.reward(...)` written in a
program takes only `tokens` and `nativeAmount`.

- **One deadline.** Every level must be filled by the same moment, so a later level has whatever
  time the earlier ones leave it. Choose the deadline for the whole chain of intents, and the reward
  deadline after it with room for each level's proof.
- **One creator.** It reclaims an unearned reward of every level, each on the chain that escrowed it,
  so it must be an address its owner controls on each of them.
- **One execution fee** pays the cook of every program body the file opens, whatever its depth. Here
  only the outer body is a program, so it is Base's Kitchen fee. `--intent-execution-fee auto` reads
  each such destination's Kitchen and refuses when they differ. An outer intent built with
  `Base(body, options)` pays its own body's fee as `execution.value`, apart from the one in
  `compile.intents`.
- **The Portal and the prover are per level.** Each is looked up for that level's own chains: the
  inner intent above is published on Base's Portal, its route names Ethereum's, and its reward names
  the prover for Base to Ethereum. An override in `compile.intents` applies to every level alike.

Levels that need different deadlines, creators or fees cannot be written this way; the
[TypeScript builder](#the-typescript-builder-nest) takes a separate set of options per level.

## Three levels

The braces nest as deep as you write them. This program is the body of an intent to Base, like the
outer braces above ([cross-chain-cascade.ts](../examples/cross-chain-cascade.ts) builds that intent
with `Base(program, options)`). It opens the next level on Ethereum, whose body opens the last, back
on Base, with the amount it measured on arrival:

```js
// Three hops, written as three intents opening one another: Base, then Ethereum, then Base again.
//
// No amount below the first exists when this is signed. `amount` is measured here, on Base.
// `arrived` is measured on Ethereum while that hop is being fulfilled, by the program the middle
// braces compiled to, and it is the reward of the third hop. Each level's numbers are filled in by
// the level above it, at that level's own execution time.
//
// The middle body is more than token writes, so it compiles to a program and runs on Ethereum's
// Pot; its second argument names what a solver must deliver for it to have something to measure.
//
// Every `USDC` is the USDC of the chain where that part runs. Each body's is its destination's. Each
// reward is escrowed by the program offering it, so the Ethereum hop's reward is Base's USDC and the
// last hop's is Ethereum's.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Ethereum(
    () => {
      const arrived = USDC.balanceOf(ctx.self());
      Base(() => {
        USDC.transfer(RECIPIENT, arrived);
      }).reward({ tokens: [{ token: USDC, amount: arrived }] });
    },
    { tokens: [{ token: USDC, amount }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
}
```

No amount below the first exists when this is signed. `amount` is measured on Base. `arrived` is
measured on Ethereum, while that level is being fulfilled, by the program the middle braces compiled
to, and it is the reward of the third. Each level's numbers are filled in by the level above it, at
that level's own execution time.

The middle body measures and opens an intent, so it is a program too, cooked on Ethereum's Pot. Its
second argument names what the solver of that level delivers, so the program has something to
measure, and that level's route moves it into the Pot first. Each level is funded on the chain whose
program offers it: the second level's reward in Base's USDC, the third's in Ethereum's, out of what
the second level's solver delivered there.

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
  parentOptions: routes.IntentOptions,
  childOptions: routes.IntentOptions,
  parentReward: routes.SauceRewardSpec,
  childReward: Omit<routes.SauceRewardSpec, "source">,
  executionFee: bigint,
) {
  return Base("function main() { return 1n; }", parentOptions)
    .nest(
      (on) =>
        Ethereum("function main() { return 1n; }", childOptions).reward({
          ...childReward,
          source: on,
        }),
      { requireCap: true, executionFee },
    )
    .reward(parentReward);
}
```

Reach for it where the program form does not reach:

- **Per-level options.** Each child takes its own `IntentOptions`, so its own deadline, creator,
  prover and fee.
- **Action programs.** A JSON action program has no action that opens an intent, so `.nest()` is how
  one is chained to another ([actions](actions.md#fund-a-child-from-a-measured-amount)).
- **A child that is never published.** The default `via: "transfer"` pays the child's vault from the
  parent's Pot and publishes nothing: share the child with your solver yourself.

`via: "publishAndFund"` publishes the child from the parent route, and `via: "dynamic"` builds it
with placeholders for amounts the parent measures — what the program form does by capturing a
variable. [Nesting in TypeScript](../api/routes.md#nesting-in-typescript) is the reference for the
three modes, their options and their ordering.
