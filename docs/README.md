# Sauce documentation

Sauce is a programmable-transaction runtime. A Sauce program compiles to bytecode that an on-chain
engine executes atomically inside one transaction — every step lands or none does. `@eco-incorp/sauce`
is the package you build those programs with. One install carries the compiler and the chains,
tokens and protocols a program calls by name; you write the program, not a contract of your own.

**Routes** are the layer above: a route packages a program as an Eco intent, so it can be executed
on another chain in exchange for a reward escrowed on this one. Everything cross-chain lives there.

## Supported chains

For the initial release, Sauce supports transactions on three chains: **Ethereum**, **Base** and
**Solana**.

Every other chain in the registry is a **preview chain**. Programs compile for it, and the
[`sauce` command](guides/cli.md#supported-and-preview-chains) and the
[MCP server](guides/mcp.md#supported-and-preview-chains) rehearse and read there as anywhere:
`sauce simulate`, `sauce intent publish --dry-run`, `sauce intent fill` without `--send`, and every
read. What they do not do on a preview chain is build or send a transaction. `tx`, `run`,
`pot --deploy` (and the deployment `pot` prints), `intent publish`, `intent fill --send`, `prove`,
`claim`, `refund` and `cancel` are refused there before any endpoint is reached or any key is read,
with the supported chains and a link to request the chain. An intent publishes only when its source
and every destination it opens, nested ones included, are supported. Each step after publishing is
refused by the chain it is sent on: a fill, a proof or a cancellation by the destination, a claim or
a refund by the source.

The TypeScript SDK is not gated. Its builders take every registry chain and build its
transactions, and an integrator who submits one on a preview chain does so at their own risk.
`chainSupport(chain)`, `supportedChains()` and `previewChains()` say which chain is which
([coverage](api/coverage.md#supported-and-preview-chains)).

To ask for a chain, first
[search the existing requests](https://github.com/eco-incorp/sauce/issues?q=is%3Aissue+label%3Achain-support)
and add your use case to the one for that chain as a comment. If there is none,
[open a chain-support request](https://github.com/eco-incorp/sauce/issues/new?template=chain-support.yml):
the chain and its id, what you want to run there, the protocols and tokens it needs, the volume you
expect and from when, and optionally how to reach you. A refusal links both, prefilled for the chain
it refused.

## First program in five minutes

1. [Install](guides/quick-start.md) the package. The compiler is inside it.
2. [Build your first intent](guides/quick-start.md#build-your-first-intent) by copying one
   example. It runs offline.
3. Put your own calls in its body, naming [tokens and protocols](guides/protocols-and-tokens.md).
4. [Create an intent from inside the program](guides/intents.md#create-an-intent-from-inside-a-program)
   when the amount is only known on chain.
5. [Submit the source reward](guides/intents.md#submit-the-source-reward) with the requests the SDK
   prepares. A solver then decides whether to fill it.

Complete programs live in the [examples](examples/README.md).

## By task

| You want to                                                     | Guide                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| Call tokens and protocols by name inside a program              | [Protocols and tokens](guides/protocols-and-tokens.md) |
| Construct, fund, submit and inspect an intent                   | [Create an intent](guides/intents.md)                  |
| Chain intents — statically, or from an amount measured on chain | [Nested intents](guides/nested-intents.md)             |
| Compile a standalone program and pass it runtime arguments      | [Compiling programs](guides/compiling.md)              |
| Compile and run a program file from a terminal                  | [The sauce command](guides/cli.md)                     |
| Have a coding agent write and run programs                      | [Agent skills](guides/cli.md#agent-skills)             |
| Give a coding agent Sauce's tools and skills over MCP           | [The MCP server](guides/mcp.md)                        |
| Give an agent a wallet of its own, with a policy that limits it | [Agent wallets](guides/cli.md#agent-wallets)           |
| Generate programs from structured data                          | [Builders](guides/builders-and-actions.md)             |
| Write protocol actions as JSON, then run them or make an intent | [Actions](guides/actions.md)                           |
| Plan accounts, stage code and execute on Solana                 | [Solana](guides/solana.md)                             |
| Check what a settlement payload contains                        | [Verification](guides/verification.md)                 |

## Concepts

| Read                                     | To understand                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| [Architecture](concepts/architecture.md) | How the package, the compiler and the on-chain engine divide the work             |
| [SauceScript](concepts/saucescript.md)   | The language: what runs on chain, what the compiler accepts, what values reach it |

## Reference

- [API entry points](api/README.md) — every published import and what it contains.
- [Routes](api/routes.md) — chain entry points, intent options, built intents, nesting.
- [Contracts and tokens](api/contracts.md) — every protocol namespace and token, in a program and in TypeScript.
- [SauceScript reference](../skills/sauce-script/references/builtins.md) — every type, builtin, statement and limit, per target.
- [Compiler](api/compiler.md) — `compile()` options and result, and the compact argument codec.
- [`@sauce/router`](api/router.md) — the SauceScript swap library: one function per venue.
- [Coverage](api/coverage.md) — which protocols, tokens and chains are actually registered, and
  which chains are supported.
- [Examples](examples/README.md) — complete programs, and how they are kept working.
