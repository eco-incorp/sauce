# Sauce

**Sauce is a programmable-transaction runtime.** You write a program, it compiles to bytecode, and a
Sauce engine executes it atomically inside one transaction on EVM or Solana. Either the whole
program lands or none of it does.

`@eco-incorp/sauce` is the developer package for that runtime: the compiler, the chain and protocol
knowledge a program needs, and the builders that turn a program into a transaction.

On top of the runtime sits a second layer — **routes**. A route packages a program as an Eco intent:
an offer to have that program executed on another chain, with a reward escrowed here for whoever
executes it there. Cross-chain execution is this layer, not the runtime.

```sh
npm install @eco-incorp/sauce
```

Node.js **24 or newer**.

[Documentation](docs/README.md) · [Quick start](docs/guides/quick-start.md) ·
[Examples](docs/examples/README.md) · [API reference](docs/api/README.md)

## A program that creates a cross-chain intent

Programs are usually thought of as a way to _spend_ an intent's funds. They can also create the next
one — and that is where the runtime and the routes layer meet. The amount is rarely known in
advance: it is whatever the swap, bridge or transfer just before it produced. This program measures
it on chain and offers an intent carrying it onward.

```js
// Create a cross-chain intent from inside a Sauce program.
//
// This runs on one chain as part of an intent's route, measures what the calls before it left in
// the Pot, and offers a NEW intent that carries that amount onward to another chain. The amount is
// never known in advance — it is whatever the swap, bridge or transfer just before it produced —
// which is the reason to build the intent here rather than off-chain.
//
// `Arbitrum(() => { ... }).reward({ ... })` is the whole of it. `amount` is an ordinary variable of
// this program, and using it inside the intent is enough: the SDK splices its run-time value into
// the encoded intent, and fills in the Portal, the prover, the approval and the encoding.
//
// RECIPIENT is a compile-time `define` the caller supplies. `USDC` is a registered symbol, and
// inside the braces it means Arbitrum's USDC, because that is the chain those calls run on.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  if (amount < MIN_AMOUNT) {
    throw "cross-chain-intent: nothing to forward";
  }

  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}
```

That is the whole program. `Arbitrum(() => { ... }).reward({ ... })` is the same fluent shape the
TypeScript builder has, written inside the program — and `amount` is an ordinary variable of it.
Using that variable inside the intent is all it takes: the SDK splices its run-time value into the
encoded intent and fills in everything else. No Portal, no selector, no ABI encoding, no approval
appears in what you write, because none of it is a decision you were making.

`USDC` is a registered token symbol, and inside the braces it means **Arbitrum's** USDC — a symbol
resolves against the chain its calls run on. `RECIPIENT` and `MIN_AMOUNT` are compile-time
`defines`: one 256-bit word each, folded into the bytecode. A program captures nothing from the
JavaScript around it, so defines are how application values reach one.

The Portal on each side and the prover for the pair come from the SDK's eco-routes deployment
tables, pinned per version and digest. What it cannot know, you supply once on the enclosing intent
and every intent the program creates inherits it: a deadline, and the creator who may reclaim the
reward if nobody earns it. [docs/examples/cross-chain-intent.ts](docs/examples/cross-chain-intent.ts)
is the caller, run on every release; [nested intents](docs/guides/nested-intents.md) covers cascades
several hops deep.

## A program that calls protocols and tokens by name

Inside a route body the SDK resolves token symbols and protocol contracts against the destination
chain, so a program reads like the operation it performs. This example builds a complete intent
offline; the repeated-digit addresses and the fee are fixtures and nothing is sent.

```ts
import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

const executionFee = 1_000n; // Read the destination Kitchen's executionFee() before use.
const options: routes.IntentOptions = {
  // No Pot or engine: both are derived, and the route deploys the Pot if it is missing.
  execution: { value: executionFee },
  nativeAmount: executionFee,
  portal: "0x3333333333333333333333333333333333333333",
  deadline: 2_000_000_000n,
};

const built = Base(() => {
  USDC.approve(Uniswap.UniversalRouter, 1_000_000n);
}, options).reward({
  source: "ethereum",
  creator: "0x4444444444444444444444444444444444444444",
  prover: "0x5555555555555555555555555555555555555555",
  deadline: 2_000_003_600n,
  nativeAmount: 0n,
});

console.log(built.hash().intentHash);
```

Two kinds of name meet in that snippet, and telling them apart is most of the learning curve. `Base`
is a **named export** — an ordinary JavaScript value, one per chain, and importing the package puts
nothing on `globalThis`. `USDC` and `Uniswap` are **program syntax**: the compiler resolves them
against Base, and there is no JavaScript object behind them to import or call. The callback is read
as source text, never invoked, and captures nothing; application values reach it through `defines`.

`.reward(...)` completes the intent and returns its hashes, bytecode and the Portal transaction
requests your application submits. [Quick start](docs/guides/quick-start.md) walks through it, and
[protocols and tokens](docs/guides/protocols-and-tokens.md) covers the names available.

## What else is in the package

| You want to                                         | Start at                                        |
| --------------------------------------------------- | ----------------------------------------------- |
| Build, fund and submit an intent                    | [Create an intent](docs/guides/intents.md)      |
| Chain intents together, statically or at run time   | [Nested intents](docs/guides/nested-intents.md) |
| Generate programs from data instead of writing them | [Builders](docs/guides/builders-and-actions.md) |
| Compile a standalone program with runtime arguments | [Compiling programs](docs/guides/compiling.md)  |
| Execute on Solana                                   | [Solana](docs/guides/solana.md)                 |
| Check what a settlement payload contains            | [Verification](docs/guides/verification.md)     |
| Know which protocols, tokens and chains are wired   | [Coverage](docs/api/coverage.md)                |

The SauceScript compiler ships inside this package; there is no separate install and no compiler
checkout. [Architecture](docs/concepts/architecture.md) explains how the pieces fit,
[SauceScript](docs/concepts/saucescript.md) the language itself.
