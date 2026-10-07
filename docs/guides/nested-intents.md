# Nested intents

[Documentation](../README.md) · [Create an intent](intents.md) · [Routes API](../api/routes.md)

A nested intent is an intent opened inside another intent's body: a hop from the chain the body
runs on. In SauceScript the hops read top to bottom, each `await` the next:

```js
await Base.hop({
  reward: { token: USDC, amount: reward },
  receive: { token: USDC, amount: delivered },
  refundee: refundTo,
});
// On Base, in the fill of the first intent:
const payout = delivered - delivered / 1000;
await Ethereum.hop({
  reward: { token: USDC, amount: delivered },
  receive: { token: USDC, amount: payout },
  refundee: refundTo,
});
// On Ethereum, in the fill of the second:
USDC.transfer(recipient, payout);
```

When a solver fills the outer intent, its body runs on Base, and in that same fulfilment it pays the
inner intent's reward into a vault on Base and publishes it. A solver fills the inner intent later,
on Ethereum. Each level is an intent of its own, filled, proven and claimed on its own: a failure on
a later level does not undo an earlier one.

The examples use Ethereum and Base, two of the chains the release supports. The `sauce` command and
the MCP server check the chains of the first level only, so keep every level on a supported chain
([Chains](../reference/chains.md)).

## Write the next intent inside the body

In TypeScript, the outer intent's body is a closure, and the inner hop is written inside it:

```ts
import { Base, Ethereum, routes } from "@eco-incorp/sauce";
import { toHex } from "viem";

const usdc = (chain: typeof Base.chain) =>
  toHex(routes.registryTokenAddress(chain, "USDC")!, { size: 20 });
const executionFee = 1_000n; // Base's Kitchen fee: read it with destinationExecutionFee().

const built = Base.hop({
  source: "ethereum",
  reward: { token: usdc(Ethereum.chain), amount: 1_010_000n },
  // What the solver brings to Base. It arrives at the Executor, which moves it into the Pot.
  receive: { token: usdc(Base.chain), amount: 1_000_000n },
  refundee: "0x4444444444444444444444444444444444444444",
  fee: executionFee,
}).then(() => {
  // Runs on Base, in the fill of this intent, on a Pot every intent to Base shares: it moves what
  // this intent delivered, never the Pot's whole balance.
  const payout = 1_000_000n - 1_000_000n / 1000n;
  // Opened, funded in Base's USDC and published on Base, in that same fill. Every intent a
  // program opens names its refundee.
  Ethereum.hop({
    reward: { token: USDC, amount: 1_000_000n },
    receive: { token: USDC, amount: payout },
    refundee: 0x4444444444444444444444444444444444444444n,
    fee: 1_000n, // Ethereum's Kitchen fee, which this body's cook pays.
  }).then(() => {
    USDC.transfer(0x6666666666666666666666666666666666666666n, payout);
  });
});
```

The chain names inside the closure come from the same imports as the host calls:
`import { Base, Ethereum }` serves both. Each chain export's `hop` takes SauceScript values as well
as the host's, so `Ethereum.hop({ … })` inside the closure typechecks beside the token symbols and
builtins a closure already has. Nothing is declared globally: a chain the closure names without importing
it is an error. The closure is never run: its text is compiled. So it names only what SauceScript
knows, a value of your script is written into it as a literal, and a bundler that renames imports
breaks it ([callbacks are compiled source](intents.md#callbacks-are-compiled-source)).
`built.cook({ owner }, fee)` publishes the outer intent from your Pot on Ethereum, and the inner one
is published in the outer one's fill, read from the `IntentPublished` in that fill's receipt.

The same intent can be a file, all of it SauceScript, and the CLI opens it on the chain that pays
the outer reward. Its inputs are `main`'s parameters, which `sauce intent publish --args` passes to
the cook that publishes it. The delivery is each hop's `receive`, and the lowering adds the transfer
into the Pot itself. Each body is written out with `.then(...)`, the same program as the `await`s
above:

```js
// An intent from Ethereum to Base whose body opens an intent of its own, from Base back to
// Ethereum. All of it is SauceScript, opened on Ethereum and published by a cook on your Pot:
//   sauce intent publish nested-intent.sauce.ts --chain ethereum --keystore <keystore> \
//     --fund USDC:<amount> --args <recipient> <delivered> <reward> <refundTo>
//
//   recipient: Address  who is paid on Ethereum, at the end
//   delivered: Uint256  the USDC a solver delivers to Base, in base units (6 decimals)
//   reward: Uint256     the USDC on Ethereum that pays that solver
//   refundTo: Address   who reclaims either intent's reward if no solver earns it
//
// The outer body runs on Base, in the fulfilment of the outer intent, on a Pot every intent to Base
// shares: it moves `delivered`, what this intent delivered, never the Pot's whole balance. The inner
// intent carries it on to Ethereum, less a tenth of a percent the next solver keeps. Its reward is
// paid into its vault on Base's Portal, and it is published, in that same fulfilment.
//
// Every `USDC` is the USDC of the chain where its part runs: the outer reward's is Ethereum's; the
// outer body's, its delivery's and the inner reward's are Base's; the inner body's is Ethereum's.
function main(recipient: Address, delivered: Uint256, reward: Uint256, refundTo: Address) {
  Base.hop({
    reward: { token: USDC, amount: reward },
    receive: { token: USDC, amount: delivered },
    refundee: refundTo,
  }).then(() => {
    const payout = delivered - delivered / 1000;
    Ethereum.hop({
      reward: { token: USDC, amount: delivered },
      receive: { token: USDC, amount: payout },
      refundee: refundTo, // every intent a program opens names its refundee
    }).then(() => {
      USDC.transfer(recipient, payout);
    });
  });
}
```

```sh
sauce intent publish nested-intent.sauce.ts --chain ethereum --keystore <keystore> \
  --args <recipient> 1000000 1010000 <refundTo>
```

The command reads each fee from its destination's Kitchen, Base's and Ethereum's, since every body
is a program whose cook pays it, and counts the first level's deadlines from when it builds the
intent, with a random salt. [nested-intent.ts](../examples/nested-intent.ts) builds the closure
form and compiles the file. From TypeScript, `routes.compileSauceProgram("ethereum", source, {
intents })` compiles the file, its `.bodies` holding the program it compiles for each destination;
the intents themselves are encoded as the program runs, and read from the Portal's
`IntentPublished` once a cook publishes them.

Nothing names a Portal, a prover, a Pot or an encoding: each level's are looked up for its own
chains. What you supply is what only you know: the amounts, each level's refundee, and, where its
default does not suit you, a level's deadline or fee.

## Where each name resolves

Each part of the file runs on one chain, and a token symbol, `chainId` or protocol address in it is
that chain's:

| Part                                                    | Runs on                         | `USDC` is  |
| ------------------------------------------------------- | ------------------------------- | ---------- |
| The outer `reward`                                      | Ethereum, which escrows it      | Ethereum's |
| The outer body, and what its solver delivers, `receive` | Base, the outer destination     | Base's     |
| The inner `reward`                                      | Base: the outer body funds it   | Base's     |
| The inner body and its `receive`                        | Ethereum, the inner destination | Ethereum's |

A body and its delivery resolve on their destination; a reward resolves on the chain whose program
offers it, because that program pays it into the vault there. The rule repeats at every depth.
[Names resolve per chain](intents.md#names-resolve-per-chain) says what goes wrong when a name is
taken from the other chain.

## How the inner intent is funded

The outer body is a program, as every body is, run on Base's shared Pot. Its route
first moves the delivered USDC from the Portal's Executor into the Pot (the lowering adds that
transfer, from `receive`), then cooks the program, with Base's Kitchen fee as the call's
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

Its hash exists only once the outer body has run, because its deadlines count from then and its
amounts may be computed there. Read it from the `IntentPublished` event of the outer fill: `sauce intent import <fill tx hash> --chain base`
stores the inner intent, after which `sauce intent status`, `fill`, `prove` and `claim` take it like
any other.

## Amounts measured as it runs

Any value the outer body computes can be an amount of the inner intent: a swap's output, a
balance's change across one step, or arithmetic on either. A body moves only what it can account
for that way, or what its own intent delivered, never the balance of the Pot it runs on, which every
intent to that chain shares. The program encodes the inner intent as it runs, each such value
written in, before it publishes. Here the inner reward is what a
swap on Base bought:

```js
import { uniswapV3 } from "@sauce/router";

// The nested intent with a swap in the middle: buy WETH on Base with the USDC delivered there, and
// send the WETH bought on to Ethereum. `bought` is the swap's output, known only when the outer body
// runs, and it is the inner intent's reward as it is. Opened on Ethereum and published by a cook
// on your Pot:
//   sauce intent publish nested-swap.sauce.ts --chain ethereum --keystore <keystore> \
//     --fund USDC:<amount> --args <recipient> <delivered> <reward> <minOut> <refundTo>
//
//   recipient: Address  who is paid the WETH on Ethereum, at the end
//   delivered: Uint256  the USDC a solver delivers to Base, in base units (6 decimals)
//   reward: Uint256     the USDC on Ethereum that pays that solver
//   minOut: Uint256     the least WETH the swap may buy on Base, in base units (18 decimals)
//   refundTo: Address   who reclaims either intent's reward if no solver earns it
//
// The swap is on Base's Uniswap V3 WETH/USDC pool at the 0.05% tier, looked up where the body runs.
// It sells `delivered`, what this intent delivered: the Pot there is shared by every intent to Base,
// so the body never sells its whole balance.
function main(
  recipient: Address,
  delivered: Uint256,
  reward: Uint256,
  minOut: Uint256,
  refundTo: Address,
) {
  Base.hop({
    reward: { token: USDC, amount: reward },
    receive: { token: USDC, amount: delivered },
    refundee: refundTo,
  }).then(() => {
    const pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
    const bought = uniswapV3(pool, USDC, WETH, delivered, 0, minOut, ctx.self());
    const payout = bought - bought / 1000;
    Ethereum.hop({
      reward: { token: WETH, amount: bought },
      receive: { token: WETH, amount: payout },
      refundee: refundTo,
    }).then(() => {
      WETH.transfer(recipient, payout);
    });
  });
}
```

`bought` is known only when the body runs, and no one has to know it before. A floor is a
`require(...)` in the body, a margin is arithmetic, and a token's decimals are yours to convert, as
in any program. The [`@sauce/router` reference](../api/router.md) lists the swaps and what each
returns.

## Deadlines, refundee and fee: each level its own

Every level takes the fields any hop takes, written in its own object, and each one it leaves out
takes its default for that level ([Intent defaults](../reference/intent-defaults.md)):

- **Deadlines count from when the level opens.** The first level opens when the program opening it
  runs, unless the compile fixes when (`intents.openedAt`, which the `sauce` command sets), and
  every level below it when the body above runs, in that fill. So each level has its own five minutes to be filled, and its
  reward its own seven days after that. A level that needs longer says so:
  `deadline: ctx.timestamp() + 3600` is an hour from when that level opens.
- **Each level names its refundee.** An intent a program opens has no default refundee, at any depth:
  the Pot a body runs on is the destination's shared one, so a refund there could go to anyone, and
  nothing is taken from the level above. The files here give every level `refundTo`, one of
  `main`'s parameters, so one address reclaims an unearned reward of every level, each on the
  chain that escrowed it: it must be an address its owner controls on each of them.
- **Each level's salt is random**, picked when the file compiles; `salt` gives one.
- **Each program body pays its own chain's Kitchen fee.** The `sauce` command reads the Kitchen of
  every chain a level's program runs on; a level's `fee` gives that level's, and
  `compile.intents.executionFee` may be a function from the destination chain to its fee. In the
  two-level file both bodies are programs, so Base's fee and Ethereum's are each paid.
- **The Portal and the prover are per level.** Each is looked up for that level's own chains: the
  inner intent above is published on Base's Portal, its route names Ethereum's, and its reward names
  the prover for Base to Ethereum. An override in `compile.intents` applies to every level alike.

A command-line flag (`--intent-deadline`, `--intent-reward-deadline`, `--intent-salt`,
`--intent-fund-via`, `--intent-execution-fee`) or a field of `compile.intents` sets its value for
every level that does not set its own. A deadline given that way is one moment for all of them, so
a later level has whatever time the earlier ones leave. The refundee has no flag: every level names
its own.

## Three levels

Hops chain as far as you write them. Three, each paying the next what it was delivered: to Base,
then Ethereum, then back to Base, each line after an `await` running on the chain it hopped to:

```js
function main(recipient: Address, delivered: Uint256, reward: Uint256, refundTo: Address) {
  await Base.hop({
    reward: { token: USDC, amount: reward },
    receive: { token: USDC, amount: delivered },
    refundee: refundTo,
  });
  const second = delivered - delivered / 1000; // on Base
  await Ethereum.hop({
    reward: { token: USDC, amount: delivered },
    receive: { token: USDC, amount: second },
    refundee: refundTo,
  });
  const third = second - second / 1000; // on Ethereum
  await Base.hop({
    reward: { token: USDC, amount: second },
    receive: { token: USDC, amount: third },
    refundee: refundTo,
  });
  USDC.transfer(recipient, third); // on Base again
}
```

This file is the same program with each body written out with `.then(...)`. It is published like
the file above, by a cook on your Pot on Ethereum
([cross-chain-cascade.ts](../examples/cross-chain-cascade.ts) compiles it):

```js
// Three hops, written as three intents opening one another: Base, then Ethereum, then Base again.
// All of it is SauceScript, opened on Ethereum and published by a cook on your Pot:
//   sauce intent publish cross-chain-cascade.sauce.ts --chain ethereum --keystore <keystore> \
//     --fund USDC:<amount> --args <recipient> <delivered> <reward> <refundTo>
//
//   recipient: Address  who is paid on Base, at the end
//   delivered: Uint256  the USDC a solver delivers to Base for the first hop, in base units
//   reward: Uint256     the USDC on Ethereum that pays that solver
//   refundTo: Address   who reclaims any hop's reward if no solver earns it
//
// Each hop pays the next solver what it was delivered, and asks it for a tenth of a percent less:
// `second` is what the second hop delivers on Ethereum, `third` what the third delivers on Base.
// A body runs on a Pot every intent to its chain shares, so it moves only what its own intent
// delivered, never the Pot's whole balance. Each level is opened and published by the level above
// it, at that level's own execution time.
//
// Each body compiles to a program and runs on its chain's Pot, paying that chain's Kitchen fee,
// read for it; the `receive` of each hop names what a solver must deliver to it. Each level's
// deadlines count from when it opens, and each names its refundee, `refundTo`: no intent has a
// default one.
//
// Every `USDC` is the USDC of the chain where that part runs. Each body's is its destination's. Each
// reward is escrowed by the program offering it: the first hop's in Ethereum's USDC, the second's in
// Base's and the third's in Ethereum's.
function main(recipient: Address, delivered: Uint256, reward: Uint256, refundTo: Address) {
  Base.hop({
    reward: { token: USDC, amount: reward },
    receive: { token: USDC, amount: delivered },
    refundee: refundTo,
  }).then(() => {
    const second = delivered - delivered / 1000;
    Ethereum.hop({
      reward: { token: USDC, amount: delivered },
      receive: { token: USDC, amount: second },
      refundee: refundTo,
    }).then(() => {
      const third = second - second / 1000;
      Base.hop({
        reward: { token: USDC, amount: second },
        receive: { token: USDC, amount: third },
        refundee: refundTo,
      }).then(() => {
        USDC.transfer(recipient, third);
      });
    });
  });
}
```

Every amount follows from the first: each level pays the next solver what it was delivered, and
asks it for a tenth of a percent less, so `second` is what arrives on Ethereum and `third` what
arrives back on Base. Each level is opened and published by the level above it, at that level's own
execution time.

Each body is a program, cooked on its chain's Pot, and the first two open an intent. The
`receive` of each names what the solver of that level delivers, and that level's route moves
it into the Pot first. Each level is funded on
the chain whose program offers it: the second level's reward in Base's USDC, the third's in
Ethereum's, out of what the second level's solver delivered there.

Each cook pays its own chain's Kitchen fee, Base's and Ethereum's, which the command reads from
each; a level's `fee` gives that level's instead.

Nesting is recursive rather than special-cased: the middle body is compiled by re-entering the same
pipeline, so the same lowering runs inside it at any depth. [Create an intent from inside a
program](intents.md#create-an-intent-from-inside-a-program) covers what may be captured, how a body
is compiled, and the functions and imports a body may use. The
hashes follow one level at a time: each level's is in the `IntentPublished` event of the fill above
it.
