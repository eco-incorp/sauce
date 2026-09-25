# Sauce documentation

Build programmable EVM and Solana transactions with `@eco-incorp/sauce`, and compose EVM
executions into Eco intents. Solana execution uses the direct Kitchen client; the
[legacy SVM intent helper](guides/solana.md#svm-destinations-in-eco-intents) is incompatible
with the released engine.

**New here?** Follow the [quick start](guides/quick-start.md), explore
[token and protocol globals](guides/protocols-and-tokens.md), then
[create and fund an intent](guides/intents.md). Complete programs live in the
[examples](examples/README.md).

## Concepts

| Read                                     | Learn                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| [Architecture](concepts/architecture.md) | How the SDK, compiler package, on-chain engine, and Eco intents fit together            |
| [SauceScript](concepts/saucescript.md)   | Execution model, source closures, supported language constructs, and target differences |

## Guides

| Task                                                  | Guide                                                  |
| ----------------------------------------------------- | ------------------------------------------------------ |
| Install and build your first intent                   | [Quick start](guides/quick-start.md)                   |
| Use `USDC`, `Token(address)`, and protocol namespaces | [Protocols and tokens](guides/protocols-and-tokens.md) |
| Construct, fund, and inspect an intent                | [Eco intents](guides/intents.md)                       |
| Compose multiple intent executions                    | [Nested intents](guides/nested-intents.md)             |
| Compile directly and encode runtime arguments         | [Compiling programs](guides/compiling.md)              |
| Generate programs from structured inputs              | [Builders and actions](guides/builders-and-actions.md) |
| Plan accounts, stage code, and execute on SVM         | [Solana](guides/solana.md)                             |
| Check a settlement payload                            | [Verification](guides/verification.md)                 |

## Reference and examples

- [API entry points](api/README.md): published imports and where to find each feature.
- [Compiler API](api/compiler.md): compiler options, output metadata, and argument encoding.
- [Routes API](api/routes.md): execution options, intent builders, and Portal helpers.
- [Registry coverage](api/coverage.md): protocols, source globals, tokens, and chain registries.
- [Examples](examples/README.md): complete examples and how they are validated.
