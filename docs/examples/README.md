# Executable examples

[Documentation](../README.md) · [Quick start](../guides/quick-start.md)

These run against the published package exports, and they run on every release — if one of them
stops working, the release does. The construction examples are offline: they compile source and
build transaction data without sending anything. Repeated-digit addresses and round fees are
fixtures, not configuration. The RPC helpers are typechecked here and read chain state only when your
application calls them.

| Example                                                        | Shows                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [cross-chain-intent.sauce.ts](cross-chain-intent.sauce.ts)     | A program that measures its Pot and publishes a new intent carrying what it measured — written in SauceScript                            |
| [cross-chain-intent.ts](cross-chain-intent.ts)                 | Compiling that program for Base with its intents' deadline and refundee, and building the cook that runs it with `main`'s arguments      |
| [nested-intent.sauce.ts](nested-intent.sauce.ts)               | An intent from Ethereum to Base whose body opens the next intent, back to Ethereum, from what it measured — written in SauceScript       |
| [nested-swap.sauce.ts](nested-swap.sauce.ts)                   | The same with a swap on Base, whose output is the inner intent's reward — written in SauceScript                                         |
| [nested-intent.ts](nested-intent.ts)                           | The intent built in TypeScript, the program that opens it, and both files compiled for Ethereum                                          |
| [cross-chain-cascade.sauce.ts](cross-chain-cascade.sauce.ts)   | Three levels, Base, Ethereum and Base again, each amount measured on arrival — written in SauceScript                                    |
| [cross-chain-cascade.ts](cross-chain-cascade.ts)               | Compiling that cascade for Ethereum, where a cook on your Pot publishes its first hop                                                    |
| [protocol-approval.ts](protocol-approval.ts)                   | A typed `Base.hop(…).then(() => ...)` body calling `USDC.approve(Uniswap.UniversalRouter, ...)`, compiled into the program that opens it |
| [venue-where-deployed.sauce.ts](venue-where-deployed.sauce.ts) | One program for every chain, using PancakeSwap V3 only where the chain has it — written in SauceScript                                   |
| [registry-names.ts](registry-names.ts)                         | That program compiled for two chains, and the same registry names from TypeScript: `Base.USDC`, a typed call, `.read(client)`            |
| [first-intent.ts](first-intent.ts)                             | A transfer intent built in TypeScript: Base reward, Ethereum delivery, the program that opens it and the cook that publishes it          |
| [compile-program.ts](compile-program.ts)                       | Direct compilation, a compact entry schema, and argument encoding and decoding                                                           |
| [action-program.ts](action-program.ts)                         | A chain-agnostic JSON action program — token symbols, a pool by key — compiled for two chains, with a runtime amount                     |
| [router-swap.sauce.ts](router-swap.sauce.ts)                   | Two swaps through `@sauce/router`, the second spending what the first returned — written in SauceScript                                  |
| [router-swap.ts](router-swap.ts)                               | Compiling that program for Ethereum and appending its floor as `main`'s argument                                                         |
| [router-route.sauce.ts](router-route.sauce.ts)                 | One program for any route over four venues, picking each `@sauce/router` function while it runs                                          |
| [router-route.ts](router-route.ts)                             | Compiling it once with the raw compiler and appending a route as its arguments                                                           |
| [evm-execution.ts](evm-execution.ts)                           | Reading a destination chain: Kitchen, Executor ownership, Pot prediction and deployment, execution fee                                   |
| [pot-router.ts](pot-router.ts)                                 | Whether a Pot runs its Kitchen's current Router, and the owner's `setRouter` call when it does not                                       |

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

For `first-intent.ts`, `cross-chain-intent.ts`, `evm-execution.ts`, `pot-router.ts`, `router-route.ts`, `router-swap.ts` and `registry-names.ts`, also run `pnpm add viem`: they use Viem's encoding helpers and RPC interfaces.

CI typechecks and runs each of them, and asserts the encoded output including a nonzero cook-fee
budget. Each SauceScript program is also executed in CI, through the released engine. The RPC
helpers are not live-chain integration tests — they are the shape of the reads you make.

For actual EVM execution, read each Kitchen's `executionFee()` (`destinationExecutionFee()` builds the read) and use it instead of the fixture fee. The intent examples name no Portal, prover, Pot or engine, and no native amount for the solver to send: the SDK looks up the first two in its eco-routes registry, derives the Pot and engine, and sends what the route's calls spend. A TypeScript intent is published by its cook, from a Pot on its source chain that holds the reward, and its hash is read from the Portal's `IntentPublished` in the cook's logs (`built.intents(receipt.logs)`), after it is sent or rehearsed. The derived Pot is the shared one the solver deploys for each Portal, and it must exist before a route runs on it. To check that it does, or to use a Pot of your own, call `prepareDestinationPot` from `evm-execution.ts` with a destination client, Portal, and salt (zero for the shared Pot). If it returns `ready: false`, send its deployment request with your signer, wait for a successful receipt, and call it again. Pass a Pot of your own as `execution.pot`. Supply valid deadlines, source funding, and solver fulfillment. Read [intents](../guides/intents.md) for atomic asset handling and fee budgets, and [Solana](../guides/solana.md) for the separate supported execution paths.
