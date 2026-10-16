# Executable examples

[Documentation](../README.md) · [Quick start](../guides/quick-start.md)

These run against the published package exports, and they run on every release — if one of them
stops working, the release does. The construction examples are offline: they compile source and
build transaction data without sending anything. Repeated-digit addresses and round fees are
fixtures, not configuration. The RPC helpers are typechecked here and read chain state only when your
application calls them.

| Example                                                        | Shows                                                                                                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [cross-chain-intent.sauce.ts](cross-chain-intent.sauce.ts)     | A program that measures its Pot and publishes a new intent carrying what it measured — written in SauceScript                                                                                |
| [cross-chain-intent.ts](cross-chain-intent.ts)                 | Compiling that program for Base with its intents' deadline and creator, and building the cook that runs it with `main`'s arguments                                                           |
| [nested-intent.sauce.ts](nested-intent.sauce.ts)               | An intent from Ethereum to Base whose body opens the next intent, back to Ethereum, from what it measured — written in SauceScript                                                           |
| [nested-swap.sauce.ts](nested-swap.sauce.ts)                   | The same with a swap on Base, whose output is the inner intent's reward — written in SauceScript                                                                                             |
| [nested-intent.ts](nested-intent.ts)                           | Compiling both for Ethereum and building the wallet transactions that publish them                                                                                                           |
| [cross-chain-cascade.sauce.ts](cross-chain-cascade.sauce.ts)   | Three levels, Base, Ethereum and Base again, each amount measured on arrival — written in SauceScript                                                                                        |
| [cross-chain-cascade.ts](cross-chain-cascade.ts)               | Compiling that cascade for Ethereum, where a wallet publishes its first hop                                                                                                                  |
| [protocol-approval.ts](protocol-approval.ts)                   | A typed `Base(() => ...)` body calling `USDC.approve(Uniswap.UniversalRouter, ...)`                                                                                                          |
| [venue-where-deployed.sauce.ts](venue-where-deployed.sauce.ts) | One program for every chain, using PancakeSwap V3 only where `available(...)` finds it — written in SauceScript                                                                              |
| [registry-names.ts](registry-names.ts)                         | That program compiled for two chains, and the same registry names from TypeScript: `Base.USDC`, a typed call, `.read(client)`                                                                |
| [first-intent.ts](first-intent.ts)                             | Both sides of a transfer intent: Ethereum reward, Base delivery, Executor-to-Pot funding, source transaction requests                                                                        |
| [compile-program.ts](compile-program.ts)                       | Direct compilation, a compact entry schema, and argument encoding and decoding                                                                                                               |
| [action-program.ts](action-program.ts)                         | A chain-agnostic JSON action program — token symbols, a pool by key — compiled for two chains, with a runtime amount, and as an intent on Base                                               |
| [router-swap.sauce.ts](router-swap.sauce.ts)                   | Two swaps through `@sauce/router`, the second spending what the first returned — written in SauceScript                                                                                      |
| [router-swap.ts](router-swap.ts)                               | Compiling that program for Ethereum and appending its floor as `main`'s argument                                                                                                             |
| [router-route.sauce.ts](router-route.sauce.ts)                 | One program for any route over four venues, picking each `@sauce/router` function while it runs                                                                                              |
| [router-route.ts](router-route.ts)                             | Compiling it once with the raw compiler and appending a route as its arguments                                                                                                               |
| [solana-swap.sauce.ts](solana-swap.sauce.ts)                   | One swap on Solana, at an Orca whirlpool: the pool and the amounts are `main`'s arguments, and every account is derived — written in SauceScript                                             |
| [solana-swap.ts](solana-swap.ts)                               | Compiling that program for Solana, and how a cook derives each account it takes                                                                                                              |
| [evm-execution.ts](evm-execution.ts)                           | Reading a destination chain: Kitchen, Executor ownership, Pot prediction and deployment, execution fee                                                                                       |
| [pot-router.ts](pot-router.ts)                                 | Whether a Pot runs its Kitchen's current Router, and the owner's `setRouter` call when it does not                                                                                           |
| [mcp-external-signer.ts](mcp-external-signer.ts)               | The MCP server with a signer it never sees: `sauce_tx` builds, your signer (a KMS, a hardware wallet) signs, `sauce_send` broadcasts and reports — a Solana plan's every step, by its cursor |

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

`mcp-external-signer.ts` takes your MCP client's tool call and your signer, and imports nothing:
`mcp/test/send.e2e.test.ts` runs it against the server on a local chain, signing with a throwaway
key.

CI typechecks and runs each of them, and asserts the encoded output including a nonzero cook-fee
budget. Each SauceScript program is also executed in CI, through the released engine. The RPC
helpers are not live-chain integration tests — they are the shape of the reads you make.

For actual EVM execution, read the destination Kitchen's `executionFee()` (`destinationExecutionFee()` builds the read) and use it instead of the fixture fee. The intent examples name no Portal, prover, Pot or engine, and no native amount for the solver to send: the SDK looks up the first two in its eco-routes registry, derives the Pot and engine, and sends what the route's calls spend. The derived Pot is the shared one the solver deploys for each Portal, and it must exist before a route runs on it. To check that it does, or to use a Pot of your own, call `prepareDestinationPot` from `evm-execution.ts` with a destination client, Portal, and salt (zero for the shared Pot). If it returns `ready: false`, send its deployment request with your signer, wait for a successful receipt, and call it again. Pass a Pot of your own as `execution.pot`. Supply valid deadlines, source funding, and solver fulfillment. Read [intents](../guides/intents.md) for atomic asset handling and fee budgets, and [Solana](../guides/solana.md) for the separate supported execution paths.
