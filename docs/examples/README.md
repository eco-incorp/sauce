# Executable examples

[Documentation](../README.md) · [Quick start](../guides/quick-start.md)

These run against the published package exports, and they run on every release — if one of them
stops working, the release does. The construction examples are offline: they compile source and
build transaction data without sending anything. Repeated-digit addresses and round fees are
fixtures, not configuration. The RPC helpers are typechecked here and read chain state only when your
application calls them.

| Example                                                        | Shows                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [venue-where-deployed.sauce.ts](venue-where-deployed.sauce.ts) | One program for every chain, using PancakeSwap V3 only where the chain has it — written in SauceScript                        |
| [registry-names.ts](registry-names.ts)                         | That program compiled for two chains, and the same registry names from TypeScript: `Base.USDC`, a typed call, `.read(client)` |
| [compile-program.ts](compile-program.ts)                       | Direct compilation, a compact entry schema, and argument encoding and decoding                                                |
| [action-program.ts](action-program.ts)                         | A chain-agnostic JSON action program — token symbols, a pool by key — compiled for two chains, and with a runtime amount      |
| [router-swap.sauce.ts](router-swap.sauce.ts)                   | Two swaps through `@sauce/router`, the second spending what the first returned — written in SauceScript                       |
| [router-swap.ts](router-swap.ts)                               | Compiling that program for Ethereum and appending its floor as `main`'s argument                                              |
| [router-route.sauce.ts](router-route.sauce.ts)                 | One program for any route over four venues, picking each `@sauce/router` function while it runs                               |
| [router-route.ts](router-route.ts)                             | Compiling it once with the raw compiler and appending a route as its arguments                                                |
| [evm-execution.ts](evm-execution.ts)                           | Reading a destination chain: Kitchen, Executor ownership, Pot prediction and deployment, execution fee                        |
| [pot-router.ts](pot-router.ts)                                 | Whether a Pot runs its Kitchen's current Router, and the owner's `setRouter` call when it does not                            |

## Run an example in your project

Use Node.js 24 or newer. Install the SDK and TypeScript in your application:

```sh
pnpm add @eco-incorp/sauce
pnpm add -D typescript
```

Set `"type": "module"` in your project's `package.json`. Copy an example to `example.ts`, then compile and run it:

```sh
pnpm exec tsc example.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir dist
node dist/example.js
```

For `evm-execution.ts`, `pot-router.ts`, `router-route.ts`, `router-swap.ts` and `registry-names.ts`, also run `pnpm add viem`: they use Viem's encoding helpers and RPC interfaces.

CI typechecks and runs each of them, and asserts the encoded output including a nonzero cook-fee
budget. Each SauceScript program is also executed in CI, through the released engine. The RPC
helpers are not live-chain integration tests — they are the shape of the reads you make.

For actual EVM execution, read the Kitchen's `executionFee()` (`destinationExecutionFee()` builds the read) and use it instead of the fixture fee. An intent's body runs on the Pot the destination Portal's Executor owns: `prepareDestinationPot` from `evm-execution.ts` reports whether that Pot exists, and builds its deployment request when it does not. Read [Solana](../guides/solana.md) for the separate supported execution paths.
