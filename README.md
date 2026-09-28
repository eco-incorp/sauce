# Sauce

Write programmable transactions and Eco intents with **`@eco-incorp/sauce`**. The SDK compiles
SauceScript into bytecode for the Sauce EVM and Solana runtimes, resolves protocol contracts and
tokens, and builds the calls that execute your program.

```sh
npm install @eco-incorp/sauce
```

[Documentation](docs/README.md) · [Quick start](docs/guides/quick-start.md) ·
[Examples](docs/examples/README.md) · [API reference](docs/api/README.md)

Use Node.js **24 or newer**. The links open the Markdown manual and examples included in this package version. After installation, you can also open `node_modules/@eco-incorp/sauce/docs/README.md` locally.

## Create a cross-chain intent, in Sauce

Sauce programs are not only a way to spend an intent's funds — a program can create the NEXT intent
while it runs. That matters because the amount is usually not known in advance: it is whatever the
swap, bridge or transfer just before it produced. The program below measures that amount on chain
and publishes an intent carrying it onward.

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
available with no import. The capitalised names are compile-time `defines`: one 256-bit word each,
folded into the bytecode, which is how a program is parameterised without capturing anything from
JavaScript. The program is compiled and attached to a route by the TypeScript beside it —
[docs/examples/cross-chain-intent.ts](docs/examples/cross-chain-intent.ts), which is run on every
release — and [nested intents](docs/guides/nested-intents.md) shows how to have the SDK generate
this program for you, including cascades several hops deep.

## Programs with protocol and token globals

This complete example builds an intent offline. The repeated-digit addresses and fee are fixtures;
no transaction is sent. Import a destination chain, then use its contracts and tokens in the program:

```ts
import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

// Offline fixtures. Read the destination Kitchen fee and use an Executor-owned Pot before use.
const executionFee = 1_000n;
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

The [quick start](docs/guides/quick-start.md) explains the setup, and the [examples](docs/examples/README.md) are checked
against the SDK. Every chain is a named export — `import { Base, Solana }` — and importing the SDK
installs nothing globally. The callback is compiled as source, so the names inside it are different:
`USDC` and `Uniswap` are compile-time names the compiler resolves on Base, never JavaScript values,
and anything from surrounding JavaScript must be supplied through compile-time `defines`.

Use `USDC.transfer(...)`, `USDC.balanceOf(...)`, `Token(address).approve(...)`, and linked protocol
methods in the same program. `Uniswap.UniversalRouter` is the family alias for
`UniswapV4.UniversalRouter`; available contracts and methods come from the
[accessor registry](docs/api/coverage.md). The compiler checks chain availability and ABI fidelity.

## From a program to an intent

`Base(body, options).reward(reward)` compiles a destination program and constructs an Eco intent.
The result exposes the intent, bytecode, hashes, and Portal transaction requests. Your application
submits those requests. Direct Portal execution requires an Executor-owned Pot and native value for the Kitchen execution fee. Use `.nest(...)` to compose intents with separate executions and funding.

Use the direct Kitchen client for Solana execution. The legacy SVM intent helper is incompatible
with the released gated engine; the Solana guide below describes this boundary.

- [Create and fund an intent](docs/guides/intents.md)
- [Compose nested intents](docs/guides/nested-intents.md)
- [Build programs with token, swap, deposit, and action helpers](docs/guides/builders-and-actions.md)
- [Execute on Solana](docs/guides/solana.md)
- [Verify settlement programs](docs/guides/verification.md)

## Compiler and runtime

The SDK includes **`@eco-incorp/sauce-compiler`**, the Rust/WebAssembly SauceScript compiler, and
exposes it through `@eco-incorp/sauce/compiler`. Compile directly when you need entry arguments,
custom module resolution, or SVM account manifests. See the [compiler guide](docs/guides/compiling.md)
and [compiler API](docs/api/compiler.md).

SauceScript supports contract calls, arithmetic, control flow, and composition within the
[compiler's language subset](docs/concepts/saucescript.md). A program executes atomically in one
transaction on its target chain. Cross-chain intents coordinate separate transactions.

The root SDK and its compiler integration require Node.js **24 or newer**. The compiler dependency also has its
own browser entry point. See [architecture](docs/concepts/architecture.md) for how the SDK,
compiler, and deployed runtime work together.

Current release pins: compiler **2.3.0**, EVM engine **1.0.1**, SVM engine **1.2.0**, both Kitchens
**1.0.0**.

The EVM settle program compiles to **356 bytes** with a new verification hash. Recompile and
invalidate cached programs when upgrading; to verify existing 362-byte payloads, pass their
historical `{ hash, bytes: 362 }` pin to `validateSettleProgram` (see
[verification](docs/guides/verification.md)).
