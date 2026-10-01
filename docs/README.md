# Sauce documentation

Sauce is a programmable-transaction runtime. A Sauce program compiles to bytecode that an on-chain
engine executes atomically inside one transaction — every step lands or none does. `@eco-incorp/sauce`
is the package you build those programs with. One install carries the compiler and the chains,
tokens and protocols a program calls by name; you write the program, not a contract of your own.

**Routes** are the layer above: a route packages a program as an Eco intent, so it can be executed
on another chain in exchange for a reward escrowed on this one. Everything cross-chain lives there.

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
- [Compiler](api/compiler.md) — `compile()` options and result, and the compact argument codec.
- [Coverage](api/coverage.md) — which protocols, tokens and chains are actually registered.
- [Examples](examples/README.md) — complete programs, and how they are kept working.
