# Sauce documentation

> Sauce lets you write a short program that does several things on a blockchain in one go: swap,
> pay, lend, bridge. Either every step happens or none does. You write the program in a small, safe
> slice of TypeScript, and Sauce turns it into one transaction on Ethereum, Base or Solana. There is
> no smart contract to write, and no address to look up.

New here? Do the quick start. It takes about ten minutes, and trying a program costs nothing. When a
word is new, the glossary puts it next to one you know.

The manual has four parts, and every page says at its top which part it belongs to:

- **Tutorials** teach by doing. Follow one from start to finish.
- **How-to guides** each get one task done, for when you know what you want.
- **Concepts** explain how Sauce works, and why.
- **Reference** lists the facts: every chain, protocol, token, function and option.

Sauce sends transactions on **Ethereum**, **Base** and **Solana**. Every other chain it knows is a
preview chain, where programs compile and simulate but nothing is sent.

## Tutorials

- [Quick start](guides/quick-start.md): install, write a program that pays someone, try it for free,
  then run it on Base.
- [Solana quick start](guides/solana-quick-start.md): the same program on Solana, every account
  worked out for you.
- [Your first cross-chain intent](guides/first-intent.md): post a job on another chain, with a
  reward for whoever does it.

## How-to guides

With the `sauce` command:

- [The sauce command](guides/cli.md): install it, what each command does, which chains it sends
  on, and your own endpoints.
- [Run a program](guides/cli-run.md): compile, simulate and run, read what came back, and get
  tokens into your Pot.
- [Programs and arguments](guides/cli-programs.md): the program file, `--args`, compile errors,
  your editor, and JSON actions documents.
- [Wallets and signing](guides/cli-wallets.md): wallets, passwords, spending limits, and signing
  with a key kept somewhere else.
- [Solana from the command line](guides/cli-solana.md): accounts, costs, large programs, leftovers
  and running without a Pot.
- [Intents from the command line](guides/cli-intents.md): publish, follow, fill, prove, claim,
  cancel and refund.
- [Look things up](guides/cli-lookup.md): a chain's names, prices, pools, and taking transactions
  apart.

With a coding agent:

- [The MCP server](guides/mcp.md): set up Sauce's tools in your coding agent.
- [Sign with your wallet's MCP server](guides/wallet-mcp.md): let Coinbase's or Phantom's wallet
  sign what Sauce builds, so the key never reaches your agent.
- [What a local server keeps](guides/mcp-local.md): let the server on your computer keep wallets,
  Pots and intents for your agent.
- [Self-hosting over HTTP](guides/mcp-http.md): run one server for a team, behind your own login.
- [Agent skills](guides/skills.md): install the instructions that teach a coding agent to write and
  run programs.

Writing programs:

- [Protocols and tokens](guides/protocols-and-tokens.md): call tokens and protocols by name inside a
  program, in SauceScript and in TypeScript.
- [A distributed swap](guides/distributed-swap.md): one limit order spread over several pools.
- [A distributed swap on Solana](guides/solana-distributed-swap.md): the same limit order over
  Solana's pools.
- [Solana](guides/solana.md): accounts, Token-2022, Solana's pools, large programs and the two ways
  to run a program.
- [Actions](guides/actions.md): write the steps as JSON instead of code, then run them or make an
  intent.

From your application, in TypeScript:

- [Compiling programs](guides/compiling.md): compile a program and pass it arguments.
- [Create an intent](guides/intents.md): every option of an intent, and how to fund, publish and
  follow it.
- [Nested intents](guides/nested-intents.md): an intent whose program posts the next one, from an
  amount it measured.
- [Builders](guides/builders-and-actions.md): generate programs from data your application already
  has.
- [Testing programs](guides/testing.md): run your programs on a local copy of a chain, EVM or
  Solana, from your tests, recorded once and replayed offline.
- [Verification](guides/verification.md): check that a settlement someone hands you is what it
  claims to be.

## Concepts

- [Glossary](concepts/glossary.md): each Sauce word next to the one you already know.
- [Kitchen, Pot and cook](concepts/kitchen-pot-cook.md): your own account on chain, the transaction
  that runs a program on it, and who may do what.
- [Architecture](concepts/architecture.md): what the package, the compiler and the on-chain engine
  each do.
- [Writing SauceScript](concepts/saucescript.md): the language, what the compiler accepts, and how
  values reach a program.

## Reference

- [Examples](examples/README.md): complete programs, checked and run on every release.
- [Chains](reference/chains.md): every chain, whether Sauce sends transactions there, and its tokens
  and protocols.
- [Deployments](reference/deployments.md): the addresses of Sauce's own contracts and programs,
  the same on every chain.
- [Protocols](reference/protocols.md): every protocol by category, how to choose between them, and
  how a program names each one.
- [Tokens](reference/tokens.md): every chain's tokens and tokenized stocks, and the token functions.
- [SauceScript reference](reference/saucescript.md): every type, statement, builtin and limit.
- [Command reference](reference/cli.md): every `sauce` command and flag, as `--help` prints it.
- [The MCP server's tools](guides/mcp-tools.md): every tool, its inputs, and the flags each one
  stands for.
- [API entry points](api/README.md): every published import and what it contains.
- [Routes](api/routes.md): the TypeScript intent builder, its options and what it returns.
- [Contracts and tokens](api/contracts.md): every protocol namespace and token, in a program and in
  TypeScript.
- [Compiler](api/compiler.md): `compile()`'s options and result, and which engine runs a program.
- [`@sauce/router`](api/router.md): the swap library, one function per kind of pool.
- [Coverage](api/coverage.md): how the registries differ, and what each answers.
