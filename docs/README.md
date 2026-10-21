# Sauce documentation

> Sauce lets you write a short program that does several things on a blockchain in one go: swap,
> pay, lend, bridge. Either every step happens or none does. You write the program in a small, safe
> slice of TypeScript, and Sauce turns it into one transaction on Ethereum, Base or Solana. There is
> no smart contract to write, and no address to look up.

**How to use this manual.** You need to know TypeScript and the basic ideas of a blockchain: a
wallet, a transaction, a token. Nothing else. Read [What Sauce is](concepts/what-is-sauce.md) first,
for the picture in five minutes. Then follow the tutorials below in order, from 1 to 8. Each one
ends with a link to the next, and the early ones cost nothing: you try a program on a copy of the
chain before you spend a cent. When you know what you want to do, find it among the how-to guides.
When you want to know why, read a concept. When you need a fact, look in the reference. When a word
is new, the [glossary](concepts/glossary.md) puts it next to one you know.

The manual has four parts, and every page says at its top which part it belongs to:

- **Tutorials** teach by doing. Follow one from start to finish.
- **How-to guides** each get one task done, for when you know what you want.
- **Concepts** explain how Sauce works, and why.
- **Reference** lists the facts: every chain, protocol, token, function and option.

Sauce sends transactions on **Ethereum**, **Base** and **Solana**. Every other chain it knows is a
preview chain, where programs compile and simulate but nothing is sent.

## Tutorials

The learning path, in order. Each tutorial builds on the one before it.

- [1. Quick start](guides/quick-start.md): install Sauce, write a program that pays someone, try it for free, then run it on Base. Start here; needs Node.js 24, and a little ETH and USDC on Base for the last step only.
- [2. Write your first program](guides/write-your-first-program.md): write a program of your own, with typed inputs, a check and a token transfer, and read what the compiler says when it is wrong. Needs tutorial 1; nothing is sent.
- [3. Swap by name](guides/swap-by-name.md): swap tokens through protocols you call by name, and set the least you will accept. Needs tutorials 1 and 2; nothing is sent.
- [4. Your first cross-chain intent](guides/first-intent.md): post a job on another chain, with a reward for whoever does it. Needs tutorial 1 and a wallet with ETH and USDC on Base.
- [5. Solana quick start](guides/solana-quick-start.md): run the same program on Solana, every account worked out for you. Needs tutorial 1 and a little SOL.
- [6. Sauce from TypeScript](guides/typescript-quick-start.md): use Sauce as a library in your own project: compile a program, build an intent and a cook in code. Needs tutorials 1 and 4; nothing is sent.
- [7. Test your first program](guides/test-your-first-program.md): run a program in your own tests on a local copy of a chain. Needs tutorials 2 and 6; nothing is sent.
- [8. Your first agent session](guides/agent-quick-start.md): give a coding agent Sauce's tools and have it write and simulate a program. Needs tutorial 1 and a coding agent; nothing is sent.

## How-to guides

Set up:

- [The sauce command](guides/cli.md): install it, what each command does, which chains it sends on, and your own endpoints.
- [Wallets and signing](guides/cli-wallets.md): wallets, passwords, spending limits, and signing with a key kept somewhere else.
- [The MCP server](guides/mcp.md): set up Sauce's tools in your coding agent.
- [Agent skills](guides/skills.md): install the instructions that teach a coding agent to write and run programs.

Write programs:

- [Programs and arguments](guides/cli-programs.md): the program file, `--args`, compile errors, your editor, and JSON actions documents.
- [Protocols and tokens](guides/protocols-and-tokens.md): call tokens and protocols by name inside a program, in SauceScript and in TypeScript.
- [Actions](guides/actions.md): write the steps as JSON instead of code, then run them or make an intent.
- [Look things up](guides/cli-lookup.md): a chain's names, prices, pools, and taking transactions apart.
- [A distributed swap](guides/distributed-swap.md): one limit order spread over several pools.
- [A distributed swap on Solana](guides/solana-distributed-swap.md): the same limit order over Solana's pools.

Run programs:

- [Run a program](guides/cli-run.md): compile, simulate and run, read what came back, and get tokens into your Pot.
- [Solana](guides/solana.md): accounts, Token-2022, Solana's pools, large programs and the two ways to run a program.
- [Solana from the command line](guides/cli-solana.md): accounts, costs, large programs, leftovers and running without a Pot.

Intents:

- [Intents from the command line](guides/cli-intents.md): publish, follow, fill, prove, claim, cancel and refund.
- [Create an intent](guides/intents.md): every option of an intent, and how to fund, publish and follow it.
- [Nested intents](guides/nested-intents.md): an intent whose program posts the next one, from an amount it measured.

Build in TypeScript:

- [Compiling programs](guides/compiling.md): compile a program and pass it arguments.
- [Builders and actions](guides/builders-and-actions.md): generate programs from data your application already has.
- [Solana from TypeScript](guides/solana-from-typescript.md): plan accounts, build and send a Solana cook from your application.
- [Testing programs](guides/testing.md): run your programs on a local copy of a chain, EVM or Solana, from your tests, recorded once and replayed offline.
- [Verification](guides/verification.md): check that a settlement someone hands you is what it claims to be.

Agents:

- [Sign with your wallet's MCP server](guides/wallet-mcp.md): let Coinbase's or Phantom's wallet sign what Sauce builds, so the key never reaches your agent.
- [What a local server keeps](guides/mcp-local.md): let the server on your computer keep wallets, Pots and intents for your agent.
- [Self-hosting over HTTP](guides/mcp-http.md): run one server for a team, behind your own login.

Operate:

- [Troubleshooting](guides/troubleshooting.md): what an error means and what to do about it.
- [Production checklist](guides/production-checklist.md): what to check before a program spends real money.
- [Upgrading](guides/upgrading.md): move to a newer Sauce, and what to check afterwards.

## Concepts

Read in this order; each page uses the words the one before it explains.

- [What Sauce is](concepts/what-is-sauce.md): what Sauce does and does not do, and how a program becomes a transaction.
- [Kitchen, Pot and cook](concepts/kitchen-pot-cook.md): your own account on chain, the transaction that runs a program on it, and who may do what.
- [Architecture](concepts/architecture.md): what the package, the compiler and the on-chain engine each do.
- [Names and registries](concepts/names-and-registries.md): how a name like `USDC` becomes an address on each chain, and which chains Sauce supports.
- [SauceScript](concepts/saucescript.md): why programs are a small, strict TypeScript, and how values reach a program.
- [Cross-chain intents](concepts/cross-chain-intents.md): the job and the bounty, who does what, and what you trust.
- [How Sauce runs on Solana](concepts/solana-model.md): accounts, staging and the two ways to run a program.
- [Costs](concepts/costs.md): what a cook, a Pot, an account and a fill cost, and who pays.
- [Safety](concepts/safety.md): what can go wrong, how Sauce limits it, and what to check.
- [Glossary](concepts/glossary.md): each Sauce word next to the one you already know.

## Reference

- [Examples](examples/README.md): complete programs, checked and run on every release.
- [Chains](reference/chains.md): every chain, whether Sauce sends transactions there, and its tokens and protocols.
- [Deployments](reference/deployments.md): the addresses of Sauce's own contracts and programs, the same on every chain.
- [Protocols](reference/protocols.md): every protocol by category, how to choose between them, and how a program names each one.
- [Tokens](reference/tokens.md): every chain's tokens and tokenized stocks, and the token functions.
- [SauceScript reference](reference/saucescript.md): every type, statement, builtin and limit.
- [Command reference](reference/cli.md): every `sauce` command and flag, as `--help` prints it.
- [The MCP server's tools](guides/mcp-tools.md): every tool, its inputs, and the flags each one stands for.
- [API entry points](api/README.md): every published import and what it contains.
- [Routes](api/routes.md): the TypeScript intent builder, its options and what it returns.
- [Contracts and tokens](api/contracts.md): every protocol namespace and token, in a program and in TypeScript.
- [Compiler](api/compiler.md): `compile()`'s options and result, and the compact argument format.
- [`@sauce/router`](api/router.md): the swap library, one function per kind of pool.
- [`@sauce/router` on Solana](api/router-solana.md): the swap library's Solana venues, their accounts and price limits.
- [Testing kit](api/testing-kit.md): the local chains, recordings and helpers your tests use.
- [Coverage](api/coverage.md): how the registries differ, and what each answers.
- [Changelog](changelog.md): each SDK 0.99.x release, what changed in SauceScript, and what the compiler and engines it shipped changed.
