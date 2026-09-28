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
one. That matters because the amount is rarely known in advance: it is whatever the swap, bridge or
transfer just before it produced. This program measures that amount on chain and publishes an intent
carrying it onward.

```js
// Create a cross-chain intent from inside a Sauce program.
//
// This runs on the destination chain of the intent that contains it, as one of its route calls. It
// measures what the calls before it left in the Pot, and publishes a NEW intent that forwards that
// amount onward — so the amount does not have to be known when the first intent is signed. That is
// the whole point: a swap's output, or a bridge's, becomes the reward of the next leg.
//
// Every capitalised name is a compile-time `define` the caller supplies. They are not JavaScript
// values and nothing here captures anything from outside; see cross-chain-intent.ts for the caller.
function main() {
  // What the route calls before this one produced. `ctx.self()` is the Pot the route executes in.
  const amount = Token(TOKEN).balanceOf(ctx.self());
  if (amount < MIN_AMOUNT) {
    throw "cross-chain-intent: nothing to forward";
  }

  // The one call the new intent obliges a solver to make on its destination: move `amount` to
  // RECIPIENT. `abi.encode` lays the arguments out; the four-byte selector is transfer(address,uint256).
  const transferSelector = hex`a9059cbb`;
  const deliver = transferSelector.concat(abi.encode(RECIPIENT, amount));

  // The route, encoded exactly as the Portal hashes it. The leading word is the ABI offset that
  // Solidity's own `abi.encode(route)` writes for a dynamic struct; SauceScript's `abi.encode`
  // returns the struct body, so the offset is prepended here.
  const routeOffset = hex`0000000000000000000000000000000000000000000000000000000000000020`;
  const route = routeOffset.concat(
    abi.encode({
      salt: SALT,
      deadline: DEADLINE,
      portal: DESTINATION_PORTAL,
      nativeAmount: 0n,
      tokens: [{ token: TOKEN, amount: amount }],
      calls: [{ target: TOKEN, data: deliver, value: 0n }],
    }),
  );

  // The Portal escrows the reward by pulling it from this Pot, so the Pot has to allow it. Issued
  // as a raw call rather than `Token(TOKEN).approve(...)`: the ERC-20 ABI declares a `bool` return
  // that the engine decodes even when nothing reads it, and tokens like USDT return nothing at all.
  const approveSelector = hex`095ea7b3`;
  const allowance = approveSelector.concat(abi.encode(PORTAL, amount));
  evm.call(TOKEN, 0n, allowance);

  // Publish and fund it in one call. The reward is what this Pot just measured; the solver who
  // fulfils the new intent on DESTINATION collects it here.
  IPortal.at(PORTAL).publishAndFund(
    DESTINATION,
    route,
    {
      deadline: DEADLINE,
      creator: CREATOR,
      prover: PROVER,
      nativeAmount: 0n,
      tokens: [{ token: TOKEN, amount: amount }],
    },
    false,
  );
}
```

`Token`, `ctx`, `abi`, `hex`, `evm` and `IPortal` are the language and the SDK's built-in bindings,
available with no import. The capitalised names are compile-time `defines` — one 256-bit word each,
folded into the bytecode. That is how a program is parameterised, because a program captures nothing
from the JavaScript around it.

The TypeScript beside it compiles the program and attaches it to a route:
[docs/examples/cross-chain-intent.ts](docs/examples/cross-chain-intent.ts), run on every release.
[Nested intents](docs/guides/nested-intents.md) shows how to have the SDK generate this program for
you instead, including cascades several hops deep.

## A program that calls protocols and tokens by name

Inside a route body the SDK resolves token symbols and protocol contracts against the destination
chain, so a program reads like the operation it performs. This example builds a complete intent
offline; the repeated-digit addresses and the fee are fixtures and nothing is sent.

```ts
import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

const executionFee = 1_000n; // Read the destination Kitchen's executionFee() before use.
const options: routes.IntentOptions = {
  execution: {
    pot: "0x1111111111111111111111111111111111111111",
    engine: "0x2222222222222222222222222222222222222222",
    value: executionFee,
  },
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
