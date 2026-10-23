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
you have written a program of your own, Advanced for code that reads a chain or builds programs
with the raw compiler. **Chain** names the chains the example is written for, or where it runs.
Only Ethereum, Base, Arc and Solana send transactions from the `sauce` command; every other chain
is a preview chain.

## Start here

| Example                                                        | Level        | Chain          | Shows                                                                                                                         |
| -------------------------------------------------------------- | ------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [pay.sauce.ts](pay.sauce.ts)                                   | Beginner     | Base, Solana   | Pay someone USDC from your Pot, and stop if the Pot holds too little: the quick start's program                               |
| [pay-list.sauce.ts](pay-list.sauce.ts)                         | Beginner     | Base           | Pay a list of recipients in turn, stop before a total limit, and return what was paid: the second tutorial's program          |
| [router-swap.sauce.ts](router-swap.sauce.ts)                   | Intermediate | Ethereum       | Two swaps through `@sauce/router`, the second spending what the first returned                                                |
| [venue-where-deployed.sauce.ts](venue-where-deployed.sauce.ts) | Intermediate | Any EVM chain  | One program for every chain, using PancakeSwap V3 only where the chain has it, `if (X)`                                       |
| [registry-names.ts](registry-names.ts)                         | Intermediate | Optimism, Base | That program compiled for two chains, and the same registry names from TypeScript: `Base.USDC`, a typed call, `.read(client)` |

## Protocols, tokens and swaps

| Example                                        | Level        | Chain          | Shows                                                                                                                                           |
| ---------------------------------------------- | ------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [protocol-approval.ts](protocol-approval.ts)   | Beginner     | Base, Ethereum | A program that approves Aave V3's Pool by name for exactly what its supply spends, compiled for Base, and the cook that runs it on your Pot     |
| [router-swap.ts](router-swap.ts)               | Intermediate | Ethereum       | Compiling `router-swap.sauce.ts` for Ethereum and appending its floor as `main`'s argument                                                      |
| [router-route.sauce.ts](router-route.sauce.ts) | Advanced     | Any EVM chain  | One program for any route over four venues, picking each `@sauce/router` function while it runs                                                 |
| [router-route.ts](router-route.ts)             | Advanced     | Any EVM chain  | Compiling it once with the raw compiler and appending a route as its arguments                                                                  |
| [solana-swap.sauce.ts](solana-swap.sauce.ts)   | Intermediate | Solana         | One swap on Solana, at an Orca whirlpool found by its key: the amounts are `main`'s arguments, and every account the swap uses is found for you |
| [solana-swap.ts](solana-swap.ts)               | Intermediate | Solana         | Compiling that program for Solana, and how a cook works out each account it takes                                                               |
| [action-program.ts](action-program.ts)         | Intermediate | Ethereum, Base | A chain-agnostic JSON action program (token symbols, a pool by key) compiled for two chains, with a runtime amount                              |

## Compiling, reading a chain and signing

| Example                                          | Level        | Chain                  | Shows                                                                                                                                                                                                  |
| ------------------------------------------------ | ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [compile-program.ts](compile-program.ts)         | Intermediate | Any                    | Direct compilation, ABI-v1 entry arguments, and argument encoding and decoding                                                                                                                         |
| [prepare-pot.ts](prepare-pot.ts)                 | Advanced     | Any EVM chain          | Your Pot before your first cook: the Kitchen and engine checked, the Pot predicted from your address and salt, its deployment or its owner and Router checked, and the Kitchen's fee                   |
| [pot-router.ts](pot-router.ts)                   | Advanced     | Any EVM chain          | Whether a Pot runs its Kitchen's current Router, and the owner's `setRouter` call when it does not                                                                                                     |
| [signed-cook.ts](signed-cook.ts)                 | Advanced     | Base                   | A cook the owner signs and another account sends: `pay.sauce.ts` signed as EIP-712 typed data with a throwaway key, verified, encoded as `cookSigned`, and the `invalidateNonces` call that cancels it |
| [mcp-external-signer.ts](mcp-external-signer.ts) | Advanced     | Ethereum, Base, Solana | The MCP server with a signer it never sees: `sauce_tx` builds, your signer (a KMS, a hardware wallet) signs, `sauce_send` broadcasts and reports, a Solana plan's every step, by its cursor            |

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

`mcp-external-signer.ts` takes your MCP client's tool call and your signer, and imports nothing.
It is run against the server on a local chain, signing with a throwaway key.

Each TypeScript example is typechecked and run, and its encoded output is checked. Each SauceScript
program is also executed through the released engine. The RPC helpers are not live-chain
integration tests: they are the shape of the reads you make.

A cook on an EVM chain carries the Kitchen's fee as its value: read the Kitchen's `executionFee()`
(`kitchenExecutionFee()` builds the read) shortly before sending, instead of a fixture. The cook
runs on your Pot, which must exist first. To check that it does, call `preparePot` from
`prepare-pot.ts` with a client for the chain and your address. If it returns `ready: false`, send
its deployment request with your signer, wait for a successful receipt, and call it again; `sauce
run` does this for you. Read [Solana](../guides/solana.md) for how a cook runs there.

## Next

- [Write your first program](../guides/write-your-first-program.md) turns the quick start's
  program into one of your own.
- [Swap by name](../guides/swap-by-name.md) writes a swap with the registry's names, as
  `router-swap.sauce.ts` does.
- [Sauce from TypeScript](../guides/typescript-quick-start.md) is the path into the `.ts` examples.
