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

Node.js **24 or newer**, or a browser — [one `await ready()`](docs/api/compiler.md#in-a-browser) and the
same code compiles the same bytes.

[Documentation](docs/README.md) · [Quick start](docs/guides/quick-start.md) ·
[Examples](docs/examples/README.md) · [API reference](docs/api/README.md)

## A program that creates a cross-chain intent

A program can spend an intent's funds, and it can also create the next intent. That is where the
runtime and the routes layer meet. This program measures an amount nobody knew in advance and offers
an intent carrying it onward.

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

That is the whole program. What you did not have to do:

- **Write or deploy a contract.** It compiles to bytecode that a Sauce engine runs in the shared
  Pot the solver deploys.
- **Import anything.** `USDC`, `Arbitrum` and `ctx` need no import line.
- **Encode the intent.** No Portal, prover, selector, approval or ABI encoding appears. The SDK
  looks up the Portal and prover in its eco-routes deployment tables and emits the rest.
- **Know the amount in advance.** `amount` is an ordinary variable, and the published intent
  carries the value the program measured.
- **Roll back by hand.** Below `MIN_AMOUNT` the `throw` reverts the whole fulfilment: nothing is
  published, and no earlier call in the route survives.

Without Sauce, this hop is either a contract you write and deploy (read the balance, approve the
Portal, encode the intent around the amount, call `publishAndFund`) or a second intent you publish
yourself after the first lands and you have read what it produced.

`USDC` is a registered token symbol, and inside the braces it means **Arbitrum's** USDC, because
that is where those calls run. `RECIPIENT` and `MIN_AMOUNT` are compile-time `defines`: a program
captures nothing from the JavaScript around it, so defines are how application values reach one.

You supply what the SDK cannot know once, on the enclosing intent, and every intent the program
creates inherits it: a deadline, and the creator who may reclaim the reward if nobody earns it. The
intent is an offer; a solver still decides to fill it.
[docs/examples/cross-chain-intent.ts](docs/examples/cross-chain-intent.ts) is the caller, run on
every release; [nested intents](docs/guides/nested-intents.md) covers cascades several hops deep.

## A program that calls protocols and tokens by name

Inside a route body the SDK resolves token symbols and protocol contracts against the destination
chain, so a program reads like the operation it performs. This example builds a complete intent
offline; the repeated-digit addresses and the fee are fixtures and nothing is sent.

```ts
import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

const executionFee = 1_000n; // Read the destination Kitchen's executionFee() before use.
const options: routes.IntentOptions = {
  // No Pot or engine: both are derived. The Pot is the shared one the solver deploys per Portal.
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

Two kinds of name meet in that snippet. `Base` is a **named export**, one per chain; importing the
package puts nothing on `globalThis`. `USDC` and `Uniswap` are **program syntax**: the SDK resolves
them to Base's addresses and binds the ABI, so there is no address to look up and no JavaScript
object to import. The callback is read as source text and never invoked, so it captures nothing;
application values reach it through `defines`.

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
| Compile and run a program file from a terminal      | [The sauce command](docs/guides/cli.md)         |
| Have a coding agent write and run programs          | [Agent skills](docs/guides/cli.md#agent-skills) |
| Execute on Solana                                   | [Solana](docs/guides/solana.md)                 |
| Check what a settlement payload contains            | [Verification](docs/guides/verification.md)     |
| Know which protocols, tokens and chains are wired   | [Coverage](docs/api/coverage.md)                |

The SauceScript compiler ships inside this package; there is no separate install and no compiler
checkout. [Architecture](docs/concepts/architecture.md) explains how the pieces fit,
[SauceScript](docs/concepts/saucescript.md) the language itself.
