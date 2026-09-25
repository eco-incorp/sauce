# Quick start

[Documentation](../README.md) · [Protocols and tokens](protocols-and-tokens.md) · [Intents](intents.md)

Use Node.js 24 or newer and install the single public package:

```sh
pnpm add @eco-incorp/sauce
```

The Sauce compiler is a dependency of that package. You do not need a compiler checkout or a separate compiler install.

## Compile your first intent

This complete TypeScript example builds an approval intent offline. Addresses and the fee are fixtures; the zero reward demonstrates construction only. Before submission, [read the current Kitchen fee and prepare an Executor-owned Pot](intents.md#prepare-the-destination-pot).

```ts
import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

const executionFee = 1_000n; // Fixture: read the destination Kitchen's executionFee() before use.
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

`Base` is a named export of the root package, one per supported chain; importing the package installs nothing globally. Inside the callback, the SDK resolves `USDC` and `Uniswap.UniversalRouter` for Base, compiles the body with Sauce, and encodes a Pot `cook(engine, program)` call. `.reward(...)` completes the Eco intent. Nothing is submitted to a chain.

For execution, deploy the Pot with the destination `Portal.executor()` as owner and pay the current Kitchen fee on every cook. [Intent setup](intents.md#prepare-the-destination-pot) shows the reads and deployment call. Fund and empty that shared Pot within the fulfillment.

`USDC` and protocol names are the one thing here that is not an import: they have generated TypeScript declarations but are source syntax resolved at compile time, not JavaScript clients, so there is nothing to import them from. The router is registered as `UniswapV4.UniversalRouter`, with `Uniswap.UniversalRouter` as a family alias. `UniswapV3.UniversalRouter` is not a registered name. See [coverage](../api/coverage.md) for which protocols expose these namespaces.

The callback captures no outer variables. Pass dynamic scalars through `defines`, or use explicit source strings; see the complete [transfer example](../examples/first-intent.ts). Callbacks must remain recognizable synchronous source after your build tooling transforms them.

## Deliver assets and fund the reward

In a transfer intent, the destination assets and source reward are separate. Destination `tokens` reach the Portal Executor. Add a transfer precall to deliver tokens into the Pot before Sauce spends them. Source reward tokens are approved to the source Portal and escrowed through its funding call.

The [first-intent.ts example](../examples/first-intent.ts) constructs both sides and returns source transaction requests. Read [creating intents](intents.md) before submitting those requests, and [nested intents](nested-intents.md) to compose subsequent routes.

## Compile a standalone program

Use `@eco-incorp/sauce/compiler` when you need raw bytecode, entry schemas, or an SVM account manifest. It exposes the published Rust/Wasm compiler through `compile(options)`; it does not install SDK protocol namespaces into arbitrary compiler input.

The [compiler example](../examples/compile-program.ts) compiles a typed SauceScript entry point and appends compact arguments. [Compiling](compiling.md) explains module resolution and the distinction between raw compiler output and the route wrapper.
