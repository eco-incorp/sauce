# Executable examples

[Documentation](../README.md) · [Quick start](../guides/quick-start.md)

These examples use the published package exports. The construction examples run offline: they compile source and construct transaction data without sending transactions. Repeated-digit addresses and illustrative fees are fixtures, not deployment configuration. The RPC setup helper is typechecked but only makes chain reads when your application calls it.

| Example                                      | Demonstrates                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [protocol-approval.ts](protocol-approval.ts) | A typed `Base(() => ...)` callback with `USDC.approve(Uniswap.UniversalRouter, ...)`                                           |
| [first-intent.ts](first-intent.ts)           | Ethereum reward, Base USDC delivery, Executor-to-Pot funding, explicit callback defines, source transaction requests           |
| [compile-program.ts](compile-program.ts)     | The compiler dependency, compact entry schema, argument encoding and decoding                                                  |
| [evm-execution.ts](evm-execution.ts)         | Destination RPC setup helper: current Kitchen, Portal Executor ownership, Pot prediction/deployment request, and execution fee |

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

The examples are typechecked and loaded automatically in the SDK's CI. Construction examples assert their encoded output, including nonzero cook-fee budgeting; the RPC helper is not a live-chain integration test.

For actual EVM execution, first call `prepareDestinationPot` from `evm-execution.ts` with a destination client, Portal, and salt. If it returns `ready: false`, send its deployment request with your signer, wait for a successful receipt, and call it again. When `ready: true`, use its Pot, engine, and observed execution fee instead of the offline fixtures. Supply valid deadlines, source funding, and solver fulfillment. Read [intents](../guides/intents.md) for atomic asset handling and fee budgets, and [Solana](../guides/solana.md) for the separate supported execution paths.
