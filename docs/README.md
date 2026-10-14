# Sauce documentation

Sauce is a programmable-transaction runtime. A Sauce program compiles to bytecode that an on-chain
engine executes atomically inside one transaction — every step lands or none does. `@eco-incorp/sauce`
is the package you build those programs with. One install carries the compiler and the chains,
tokens and protocols a program calls by name; you write the program, not a contract of your own.

A program runs on a **Pot**: an account on chain, a contract whose owner alone runs programs on it,
which holds what those programs spend and makes every call they make. A **cook** is the transaction
that runs one program on a Pot, every step or none. The **Kitchen** is the contract that creates
Pots and sets the fee each cook pays. Read [Kitchen, Pot and cook](concepts/kitchen-pot-cook.md)
first: every page below uses the three words.

**Intents** are the layer above: an Eco intent offers a program to be executed on another chain in
exchange for a reward escrowed on this one. Opening one from a program is coming soon; filling,
proving, claiming, refunding and cancelling the ones that exist work today
([Cross-chain intents](guides/intents.md)).

For the initial release, Sauce supports transactions on **Ethereum**, **Base** and **Solana**. Every
other chain is a preview chain, where a program compiles and simulates but the `sauce` command and
the MCP server build no transaction; [Chains](reference/chains.md) has the policy, every chain, and
how to request one.

Every page of this manual is listed below, once. The agent skills the package ships teach a coding
agent the same facts, from the same sources: [Agent skills](guides/skills.md).

## Start

- [Kitchen, Pot and cook](concepts/kitchen-pot-cook.md): the account a program runs as, the
  transaction that runs it, and the contract that creates the account.
- [Quick start](guides/quick-start.md): install the package and compile a first program, offline.
- [Examples](examples/README.md): complete programs, typechecked and run on every release.

## Guides

- [Protocols and tokens](guides/protocols-and-tokens.md): call tokens and protocols by name inside a
  program, in SauceScript and in TypeScript.
- [Compiling programs](guides/compiling.md): compile a standalone program and pass it runtime
  arguments.
- [A distributed swap](guides/distributed-swap.md): one limit order spread over several
  price-limited pools.
- [A distributed swap on Solana](guides/solana-distributed-swap.md): the same limit order over
  the pools of every Solana venue whose swap stops at a price limit, each pool's accounts from
  `sauce pools`.
- [Actions](guides/actions.md): write protocol actions as JSON, then run them.
- [Builders](guides/builders-and-actions.md): generate programs from structured data.
- [Solana](guides/solana.md): plan accounts, stage code and execute on Solana.
- [Verification](guides/verification.md): check what a settlement payload contains.
- [Cross-chain intents](guides/intents.md): how a program will open one, coming soon, and acting
  on the intents that exist.
- [The sauce command](guides/cli.md): compile, simulate and run from a terminal, with agent
  wallets and their policies.
- [The MCP server](guides/mcp.md): give a coding agent Sauce's tools.
- [Agent skills](guides/skills.md): install the skills that teach a coding agent to write and run
  programs.

## Concepts

- [Architecture](concepts/architecture.md): how the package, the compiler and the on-chain engine
  divide the work.
- [Writing SauceScript](concepts/saucescript.md): what runs on chain, what the compiler accepts,
  and how values reach a program.

## Reference

- [Chains](reference/chains.md): every chain, whether the release supports it, its ids, its intent
  deployment, its tokens and every protocol on it.
- [Deployments](reference/deployments.md): the Sauce release, its versions and the addresses of its
  contracts and programs, the same on every chain.
- [Protocols](reference/protocols.md): every protocol by category, how to choose between them, and
  each one's deployments, names in a program and ABI.
- [Tokens](reference/tokens.md): every chain's tokens and tokenized stocks, and the token functions.
- [SauceScript reference](reference/saucescript.md): every type, statement, builtin and limit, per
  target.
- [API entry points](api/README.md): every published import and what it contains.
- [Routes](api/routes.md): chain entry points, route compilation, intent records and the Portal's calls.
- [Contracts and tokens](api/contracts.md): every protocol namespace and token, in a program and in
  TypeScript.
- [Compiler](api/compiler.md): `compile()` options and result, and the compact argument codec.
- [`@sauce/router`](api/router.md): the SauceScript swap library, one function per venue.
- [Coverage](api/coverage.md): how the registries differ, and what each answers.
