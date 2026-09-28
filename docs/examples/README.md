# Executable examples

[Documentation](../README.md) · [Quick start](../guides/quick-start.md)

These run against the published package exports, and they run on every release — if one of them
stops working, the release does. The construction examples are offline: they compile source and
build transaction data without sending anything. Repeated-digit addresses and round fees are
fixtures, not configuration. The RPC helper is typechecked here and reads chain state only when your
application calls it.

| Example                                                    | Shows                                                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [cross-chain-intent.sauce.ts](cross-chain-intent.sauce.ts) | A program that measures a balance and publishes a new intent carrying it — written in SauceScript                     |
| [cross-chain-intent.ts](cross-chain-intent.ts)             | Compiling that program with `defines` and attaching it to a route                                                     |
| [protocol-approval.ts](protocol-approval.ts)               | A typed `Base(() => ...)` body calling `USDC.approve(Uniswap.UniversalRouter, ...)`                                   |
| [first-intent.ts](first-intent.ts)                         | Both sides of a transfer intent: Ethereum reward, Base delivery, Executor-to-Pot funding, source transaction requests |
| [compile-program.ts](compile-program.ts)                   | Direct compilation, a compact entry schema, and argument encoding and decoding                                        |
| [evm-execution.ts](evm-execution.ts)                       | Reading a destination chain: Kitchen, Executor ownership, Pot prediction and deployment, execution fee                |

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

For `first-intent.ts` and `evm-execution.ts`, also run `pnpm add viem`: they use Viem's address formatter and RPC interfaces.

CI typechecks and runs each of them, and asserts the encoded output including a nonzero cook-fee
budget. The RPC helper is not a live-chain integration test — it is the shape of the reads you make.

For actual EVM execution, read the destination Kitchen's `executionFee()` and use it instead of the fixture fee. The intent examples name no Pot or engine: the SDK derives both. The derived Pot is the shared one the solver deploys for each Portal, and it must exist before a route runs on it. To check that it does, or to use a Pot of your own, call `prepareDestinationPot` from `evm-execution.ts` with a destination client, Portal, and salt (zero for the shared Pot). If it returns `ready: false`, send its deployment request with your signer, wait for a successful receipt, and call it again. Pass a Pot of your own as `execution.pot`. Supply valid deadlines, source funding, and solver fulfillment. Read [intents](../guides/intents.md) for atomic asset handling and fee budgets, and [Solana](../guides/solana.md) for the separate supported execution paths.
