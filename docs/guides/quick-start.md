# Quick start

[Documentation](../README.md) · [Protocols and tokens](protocols-and-tokens.md) · [Create an intent](intents.md)

```sh
pnpm add @eco-incorp/sauce
```

Node.js **24 or newer**. The SauceScript compiler is a dependency of this package — there is nothing
else to install and no compiler checkout to keep in sync.

## Build your first intent

This is a complete program. It builds an Eco intent offline: the addresses and the fee are fixtures
and nothing is sent to a chain.

```ts
import { Base } from "@eco-incorp/sauce";
import type { routes } from "@eco-incorp/sauce";

const executionFee = 1_000n; // Read the destination Kitchen's executionFee() before a real run.
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

`Base` names the **destination**: the chain the program runs on. The SDK resolves `USDC` and
`Uniswap.UniversalRouter` there, compiles the body, and encodes it as a Pot `cook(engine, program)`
call. `.reward(...)` names the **source**: the chain where the reward is escrowed. The result carries
the intent, its hashes, the compiled bytecode and the transaction requests your application submits.

## The three things that trip people up

**The callback is source, not a function.** It is read with `Function.prototype.toString()`, parsed
and compiled. It never runs as JavaScript, so it captures nothing: a surrounding `const amount` is
invisible inside it. Pass application values through `defines`, or write the body as a string. If
your bundler rewrites function bodies, use a string or a source file.

**`USDC` and `Uniswap` are not imports.** They are program syntax the compiler resolves against the
destination chain. The package ships TypeScript declarations so a typed body checks, but there is no
JavaScript object to import. `Base`, by contrast, _is_ a named export. The registered spelling of the
router is `UniswapV4.UniversalRouter`, with `Uniswap.UniversalRouter` as an unambiguous family alias;
`UniswapV3.UniversalRouter` does not exist. [Coverage](../api/coverage.md) lists what is registered.

**The Pot is not yours alone.** For a Portal-driven intent the Pot's owner is the destination
`Portal.executor()`, which every solver can drive. Deliver assets into it, use them, and take the
remainder out inside the same fulfillment. Every cook also pays the Kitchen's current fee in native
value. [Intent setup](intents.md#prepare-the-destination-pot) shows the reads and the deployment call.

## Deliver assets and fund the reward

The destination assets and the source reward are separate things. Destination `tokens` arrive at the
Portal's Executor, so a program that spends them needs a transfer precall moving them into the Pot
first. Source reward tokens are approved to the source Portal, which escrows them in the intent vault.

[first-intent.ts](../examples/first-intent.ts) builds both sides and returns the source transaction
requests. Read [create an intent](intents.md) before submitting them, and
[nested intents](nested-intents.md) to chain a second execution onto the first.

## Compile without an intent

Reach for `@eco-incorp/sauce/compiler` when you want raw bytecode, runtime entry arguments or a
Solana account manifest — a reusable program you supply values to at execution time rather than one
specialised at compile time.

[compile-program.ts](../examples/compile-program.ts) compiles a typed entry point and appends compact
arguments. [Compiling programs](compiling.md) explains module resolution and how the raw compiler
differs from the route wrapper.
