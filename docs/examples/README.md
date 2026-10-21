# Executable examples

**Reference** · [Documentation](../README.md) · [Quick start](../guides/quick-start.md)

> These are complete, working programs you can copy. Every one of them is run automatically each
> time a new version is released, and if one stops working, that version does not ship. Start with
> `pay.sauce.ts`: it is the [quick start](../guides/quick-start.md)'s program.

This page is for a developer who has finished the quick start and wants a worked program for the
next task. It needs Node.js 24 or newer and the `sauce` command; the
[quick start](../guides/quick-start.md) installs it.

Files ending in `.sauce.ts` are Sauce programs, which the `sauce` command compiles and runs. Files
ending in `.ts` are TypeScript for your application, which use the package as a library. The
TypeScript ones are offline: they compile programs and build transactions without sending anything.
Repeated-digit addresses (`0x4444…`) and round fees are fixtures, not values to copy. The few that
read a chain do so only when your application calls them.

**Level** says how much you need to know first: Beginner after the quick start, Intermediate once
you have written a program of your own, Advanced for intents that post intents and for code that
reads a chain. **Chain** names the chains the example is written for, or where it runs; "A to B"
is an intent published on A and delivered on B. Only Ethereum, Base and Solana send transactions
from the `sauce` command; every other chain is a preview chain.

## Start here

| Example                                                    | Level        | Chain              | Shows                                                                                                                              |
| ---------------------------------------------------------- | ------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| [pay.sauce.ts](pay.sauce.ts)                               | Beginner     | Base, Solana       | Pay someone USDC from your Pot, and stop if the Pot holds too little: the quick start's program                                    |
| [cross-chain-intent.sauce.ts](cross-chain-intent.sauce.ts) | Intermediate | Base to Ethereum   | A program that measures its Pot and posts an intent carrying what it measured to Ethereum                                          |
| [cross-chain-intent.ts](cross-chain-intent.ts)             | Intermediate | Base               | Compiling that program for Base with its intents' deadline and creator, and building the cook that runs it with `main`'s arguments |
| [ethereum-to-solana.sauce.ts](ethereum-to-solana.sauce.ts) | Intermediate | Ethereum to Solana | An intent from Ethereum to Solana: pay a Solana wallet USDC, for a USDC reward on Ethereum                                         |
| [ethereum-to-solana.ts](ethereum-to-solana.ts)             | Intermediate | Ethereum           | Compiling it for Ethereum with the wallet in base58, its Solana route, and the two transactions your wallet sends                  |
| [first-intent.ts](first-intent.ts)                         | Intermediate | Ethereum to Base   | Both sides of a transfer intent: Ethereum reward, Base delivery, Executor-to-Pot funding, source transaction requests              |

## Intents that post more intents

| Example                                                      | Level    | Chain            | Shows                                                                                                     |
| ------------------------------------------------------------ | -------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| [nested-intent.sauce.ts](nested-intent.sauce.ts)             | Advanced | Ethereum to Base | An intent from Ethereum to Base whose body opens the next intent, back to Ethereum, from what it measured |
| [nested-swap.sauce.ts](nested-swap.sauce.ts)                 | Advanced | Ethereum to Base | The same with a swap on Base, whose output is the inner intent's reward                                   |
| [nested-intent.ts](nested-intent.ts)                         | Advanced | Ethereum         | Compiling both for Ethereum and building the wallet transactions that publish them                        |
| [cross-chain-cascade.sauce.ts](cross-chain-cascade.sauce.ts) | Advanced | Ethereum, Base   | Three levels, Base, Ethereum and Base again, each amount measured on arrival                              |
| [cross-chain-cascade.ts](cross-chain-cascade.ts)             | Advanced | Ethereum         | Compiling that cascade for Ethereum, where a wallet publishes its first hop                               |

## Protocols, tokens and swaps

| Example                                                        | Level        | Chain          | Shows                                                                                                                                        |
| -------------------------------------------------------------- | ------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [protocol-approval.ts](protocol-approval.ts)                   | Beginner     | Base           | A typed `Base(() => ...)` body calling `USDC.approve(Uniswap.UniversalRouter, ...)`                                                          |
| [venue-where-deployed.sauce.ts](venue-where-deployed.sauce.ts) | Intermediate | Any EVM chain  | One program for every chain, using PancakeSwap V3 only where `available(...)` finds it                                                       |
| [registry-names.ts](registry-names.ts)                         | Intermediate | Ethereum, Base | That program compiled for two chains, and the same registry names from TypeScript: `Base.USDC`, a typed call, `.read(client)`                |
| [router-swap.sauce.ts](router-swap.sauce.ts)                   | Intermediate | Ethereum       | Two swaps through `@sauce/router`, the second spending what the first returned                                                               |
| [router-swap.ts](router-swap.ts)                               | Intermediate | Ethereum       | Compiling that program for Ethereum and appending its floor as `main`'s argument                                                             |
| [router-route.sauce.ts](router-route.sauce.ts)                 | Advanced     | Any EVM chain  | One program for any route over four venues, picking each `@sauce/router` function while it runs                                              |
| [router-route.ts](router-route.ts)                             | Advanced     | Any EVM chain  | Compiling it once with the raw compiler and appending a route as its arguments                                                               |
| [solana-swap.sauce.ts](solana-swap.sauce.ts)                   | Intermediate | Solana         | One swap on Solana, at an Orca whirlpool: the pool and the amounts are `main`'s arguments, and every account the swap uses is found for you  |
| [solana-swap.ts](solana-swap.ts)                               | Intermediate | Solana         | Compiling that program for Solana, and how a cook works out each account it takes                                                            |
| [action-program.ts](action-program.ts)                         | Intermediate | Ethereum, Base | A chain-agnostic JSON action program (token symbols, a pool by key) compiled for two chains, with a runtime amount, and as an intent on Base |

## Compiling, reading a chain and signing

| Example                                          | Level        | Chain                  | Shows                                                                                                                                                                                       |
| ------------------------------------------------ | ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [compile-program.ts](compile-program.ts)         | Intermediate | Any                    | Direct compilation, a compact entry schema, and argument encoding and decoding                                                                                                              |
| [evm-execution.ts](evm-execution.ts)             | Advanced     | Any EVM chain          | Reading a destination chain: Kitchen, Executor ownership, Pot prediction and deployment, execution fee                                                                                      |
| [pot-router.ts](pot-router.ts)                   | Advanced     | Any EVM chain          | Whether a Pot runs its Kitchen's current Router, and the owner's `setRouter` call when it does not                                                                                          |
| [mcp-external-signer.ts](mcp-external-signer.ts) | Advanced     | Ethereum, Base, Solana | The MCP server with a signer it never sees: `sauce_tx` builds, your signer (a KMS, a hardware wallet) signs, `sauce_send` broadcasts and reports, a Solana plan's every step, by its cursor |

## Run an example in your project

A `.sauce.ts` program:

1. Copy the file into your project.
2. Read its first lines: they give the `sauce` command that runs it and describe each `main`
   argument.
3. Run that command with your own values. Add `--assume-balance` to a `sauce simulate` line to try
   it without funds. The [quick start](../guides/quick-start.md) walks through one.

A `.ts` example:

1. Install the package and viem in your project:

   ```sh
   npm install @eco-incorp/sauce viem
   ```

2. Set `"type": "module"` in your project's `package.json` (or name the copy `example.mts`).
3. Copy the example to `example.ts`, and any `.sauce.ts` file it reads next to it.
4. Run it, since Node.js 24 runs TypeScript as it is:

   ```sh
   node example.ts
   ```

5. To typecheck it too, add TypeScript (`npm install -D typescript`) and compile it:

   ```sh
   npx tsc example.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --outDir dist
   node dist/example.js
   ```

The [TypeScript quick start](../guides/typescript-quick-start.md) explains what these programs do
with the package.

## Details

`ethereum-to-solana.sauce.ts` is published with `sauce intent publish` on a local Ethereum, the
intent filled and proven on a local copy of Solana running the real eco-routes programs, and the
reward claimed.

`mcp-external-signer.ts` takes your MCP client's tool call and your signer, and imports nothing.
It is run against the server on a local chain, signing with a throwaway key.

Each TypeScript example is typechecked and run, and its encoded output is checked, including a
nonzero cook-fee budget. Each SauceScript program is also executed through the released engine. The
RPC helpers are not live-chain integration tests: they are the shape of the reads you make.

For actual EVM execution, read the destination Kitchen's `executionFee()` (`destinationExecutionFee()` builds the read) and use it instead of the fixture fee. The intent examples name no Portal, prover, Pot or engine, and no native amount for the solver to send: the SDK looks up the first two in its eco-routes registry, derives the Pot and engine, and sends what the route's calls spend. The derived Pot is the shared one the solver deploys for each Portal, and it must exist before a route runs on it. To check that it does, or to use a Pot of your own, call `prepareDestinationPot` from `evm-execution.ts` with a destination client, Portal, and salt (zero for the shared Pot). If it returns `ready: false`, send its deployment request with your signer, wait for a successful receipt, and call it again. Pass a Pot of your own as `execution.pot`. Supply valid deadlines, source funding, and solver fulfillment. Read [intents](../guides/intents.md) for atomic asset handling and fee budgets, and [Solana](../guides/solana.md) for the separate supported execution paths.

## Next

- [Write your first program](../guides/write-your-first-program.md) turns the quick start's
  program into one of your own.
- [Sauce from TypeScript](../guides/typescript-quick-start.md) is the path into the `.ts` examples.
- [Cross-chain intents](../concepts/cross-chain-intents.md) explains the intent examples.
