# Executable examples

[Documentation](../README.md) · [Quick start](../guides/quick-start.md)

> These are complete, working programs you can copy. Every one of them is run automatically each
> time a new version is released, and if one stops working, that version does not ship. Start with
> `pay.sauce.ts`: it is the [quick start](../guides/quick-start.md)'s program.

Files ending in `.sauce.ts` are Sauce programs, which the `sauce` command compiles and runs. Files
ending in `.ts` are TypeScript for your application, which use the package as a library. The
TypeScript ones are offline: they compile programs and build transactions without sending anything.
Repeated-digit addresses (`0x4444…`) and round fees are fixtures, not values to copy. The few that
read a chain do so only when your application calls them.

## Start here

| Example                                                    | Shows                                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [pay.sauce.ts](pay.sauce.ts)                               | Pay someone USDC from your Pot, on Base or on Solana, and stop if the Pot holds too little: the quick start's program              |
| [cross-chain-intent.sauce.ts](cross-chain-intent.sauce.ts) | A program that measures its Pot and posts an intent carrying what it measured to Ethereum                                          |
| [cross-chain-intent.ts](cross-chain-intent.ts)             | Compiling that program for Base with its intents' deadline and creator, and building the cook that runs it with `main`'s arguments |
| [ethereum-to-solana.ts](ethereum-to-solana.ts)             | An intent from Ethereum to Solana: 1 USDC to a Solana wallet, the reward on Ethereum, and the two transactions your wallet sends   |
| [first-intent.ts](first-intent.ts)                         | Both sides of a transfer intent: Ethereum reward, Base delivery, Executor-to-Pot funding, source transaction requests              |

## Intents that post more intents

| Example                                                      | Shows                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| [nested-intent.sauce.ts](nested-intent.sauce.ts)             | An intent from Ethereum to Base whose body opens the next intent, back to Ethereum, from what it measured |
| [nested-swap.sauce.ts](nested-swap.sauce.ts)                 | The same with a swap on Base, whose output is the inner intent's reward                                   |
| [nested-intent.ts](nested-intent.ts)                         | Compiling both for Ethereum and building the wallet transactions that publish them                        |
| [cross-chain-cascade.sauce.ts](cross-chain-cascade.sauce.ts) | Three levels, Base, Ethereum and Base again, each amount measured on arrival                              |
| [cross-chain-cascade.ts](cross-chain-cascade.ts)             | Compiling that cascade for Ethereum, where a wallet publishes its first hop                               |

## Protocols, tokens and swaps

| Example                                                        | Shows                                                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [protocol-approval.ts](protocol-approval.ts)                   | A typed `Base(() => ...)` body calling `USDC.approve(Uniswap.UniversalRouter, ...)`                                                          |
| [venue-where-deployed.sauce.ts](venue-where-deployed.sauce.ts) | One program for every chain, using PancakeSwap V3 only where `available(...)` finds it                                                       |
| [registry-names.ts](registry-names.ts)                         | That program compiled for two chains, and the same registry names from TypeScript: `Base.USDC`, a typed call, `.read(client)`                |
| [router-swap.sauce.ts](router-swap.sauce.ts)                   | Two swaps through `@sauce/router`, the second spending what the first returned                                                               |
| [router-swap.ts](router-swap.ts)                               | Compiling that program for Ethereum and appending its floor as `main`'s argument                                                             |
| [router-route.sauce.ts](router-route.sauce.ts)                 | One program for any route over four venues, picking each `@sauce/router` function while it runs                                              |
| [router-route.ts](router-route.ts)                             | Compiling it once with the raw compiler and appending a route as its arguments                                                               |
| [action-program.ts](action-program.ts)                         | A chain-agnostic JSON action program (token symbols, a pool by key) compiled for two chains, with a runtime amount, and as an intent on Base |

## Compiling, reading a chain and signing

| Example                                          | Shows                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [compile-program.ts](compile-program.ts)         | Direct compilation, a compact entry schema, and argument encoding and decoding                                                                                                              |
| [evm-execution.ts](evm-execution.ts)             | Reading a destination chain: Kitchen, Executor ownership, Pot prediction and deployment, execution fee                                                                                      |
| [pot-router.ts](pot-router.ts)                   | Whether a Pot runs its Kitchen's current Router, and the owner's `setRouter` call when it does not                                                                                          |
| [mcp-external-signer.ts](mcp-external-signer.ts) | The MCP server with a signer it never sees: `sauce_tx` builds, your signer (a KMS, a hardware wallet) signs, `sauce_send` broadcasts and reports, a Solana plan's every step, by its cursor |

## Run an example in your project

A `.sauce.ts` program runs with the `sauce` command: its first lines say how.

A `.ts` example needs Node.js 24 or newer, which runs TypeScript as it is. In your project:

```sh
npm install @eco-incorp/sauce viem
```

Set `"type": "module"` in your project's `package.json` (or name the copy `example.mts`), copy an
example to `example.ts`, and run it:

```sh
node example.ts
```

An example that reads a `.sauce.ts` file next to it needs that file copied too. To typecheck an
example as well, add TypeScript (`npm install -D typescript`) and compile it:

```sh
npx tsc example.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir dist
node dist/example.js
```

## Details

`ethereum-to-solana.ts` runs end to end in `sdk/test/docs-ethereum-to-solana.e2e.test.ts`: its
transactions published on a local Ethereum, the intent filled and proven on a local copy of Solana
running eco-routes' own programs, and the reward claimed.

`mcp-external-signer.ts` takes your MCP client's tool call and your signer, and imports nothing:
`mcp/test/send.e2e.test.ts` runs it against the server on a local chain, signing with a throwaway
key.

CI typechecks and runs each of them, and asserts the encoded output including a nonzero cook-fee
budget. Each SauceScript program is also executed in CI, through the released engine. The RPC
helpers are not live-chain integration tests — they are the shape of the reads you make.

For actual EVM execution, read the destination Kitchen's `executionFee()` (`destinationExecutionFee()` builds the read) and use it instead of the fixture fee. The intent examples name no Portal, prover, Pot or engine, and no native amount for the solver to send: the SDK looks up the first two in its eco-routes registry, derives the Pot and engine, and sends what the route's calls spend. The derived Pot is the shared one the solver deploys for each Portal, and it must exist before a route runs on it. To check that it does, or to use a Pot of your own, call `prepareDestinationPot` from `evm-execution.ts` with a destination client, Portal, and salt (zero for the shared Pot). If it returns `ready: false`, send its deployment request with your signer, wait for a successful receipt, and call it again. Pass a Pot of your own as `execution.pot`. Supply valid deadlines, source funding, and solver fulfillment. Read [intents](../guides/intents.md) for atomic asset handling and fee budgets, and [Solana](../guides/solana.md) for the separate supported execution paths.
