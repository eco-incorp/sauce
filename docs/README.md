# Sauce documentation

Sauce is a programmable-transaction runtime. A Sauce program compiles to bytecode that an on-chain
engine executes atomically inside one transaction — every step lands or none does. `@eco-incorp/sauce`
is the package you build those programs with.

**Routes** are the layer above: a route packages a program as an Eco intent, so it can be executed
on another chain in exchange for a reward escrowed on this one. Everything cross-chain lives there.

New here? [Quick start](guides/quick-start.md) → [protocols and tokens](guides/protocols-and-tokens.md)
→ [create an intent](guides/intents.md). Complete programs live in the [examples](examples/README.md).

## By task

| You want to                                                     | Guide                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| Install and build your first intent                             | [Quick start](guides/quick-start.md)                   |
| Call tokens and protocols by name inside a program              | [Protocols and tokens](guides/protocols-and-tokens.md) |
| Construct, fund, submit and inspect an intent                   | [Create an intent](guides/intents.md)                  |
| Chain intents — statically, or from an amount measured on chain | [Nested intents](guides/nested-intents.md)             |
| Compile a standalone program and pass it runtime arguments      | [Compiling programs](guides/compiling.md)              |
| Generate programs from structured data                          | [Builders](guides/builders-and-actions.md)             |
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
- [Compiler](api/compiler.md) — `compile()` options and result, and the compact argument codec.
- [Coverage](api/coverage.md) — which protocols, tokens and chains are actually registered.
- [Examples](examples/README.md) — complete programs, and how they are kept working.
