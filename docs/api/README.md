# API reference

**Reference** · [Documentation](../README.md)

> This is the index of everything you can import from the package, like the index at the back of a
> book. Start with the map by goal to find the import you need, then read the page it names. The
> table after it lists every import path and what it holds.

This page is for a developer who already has a program or a script and needs to know which import
does what. If you have not written a program yet, start with the [Quick start](../guides/quick-start.md);
if you want the TypeScript side first, start with [Sauce from TypeScript](../guides/typescript-quick-start.md).

Install `@eco-incorp/sauce` and import through the package's public entry points. All paths below
are suffixes of that package name; `.` means `@eco-incorp/sauce` itself.

## Find an import by goal

| I want to                                   | Import                                                                                | Read                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Compile a program to bytecode               | `compile` from `/compiler`                                                            | [Compiler](compiler.md)                                       |
| Encode a program's arguments                | `encodeCompactArguments`, `decodeCompactArguments` from `/compiler`                   | [Compact argument codec](compiler.md#compact-argument-codec)  |
| Compile a program for one chain, by name    | `routes.compileSauceProgram`, `routes.compileSauceRoute` from `.`                     | [Routes](routes.md)                                           |
| Open a cross-chain intent from TypeScript   | `Base(...).reward(...)` (any chain export) from `.`                                   | [Routes](routes.md)                                           |
| Call a protocol or a token by name          | `Base.USDC`, `Base.UniswapV3.Factory`, `contracts` from `.`                           | [Contracts and tokens](contracts.md)                          |
| Swap at a venue from a program              | `@sauce/router`, imported inside the program                                          | [`@sauce/router`](router.md)                                  |
| Turn a JSON document into a program         | `compileProgram` and the rest of `/actions`                                           | [Actions](../guides/actions.md)                               |
| Find out what a registry holds              | `getProtocol`, `listProtocols`, `routes.knownTokenSymbols`, `requireChain`            | [Coverage](coverage.md)                                       |
| Predict a Pot and build a cook              | `v12PredictPot` from `.`; `v12Pot`, `v12Kitchen` from `/evm/engine`                   | [Pots and cooks in code](#pots-and-cooks-in-code)             |
| Find the Kitchen and engine                 | `v12KitchenAddress()`, `v12EngineAddress()` from `/deployments`                       | [Deployments](../reference/deployments.md)                    |
| Run on Solana from TypeScript               | `createSauceSvmClient`, `SOLANA_CLUSTERS`, `resolveAccounts` from `/svm`              | [Solana from TypeScript](../guides/solana-from-typescript.md) |
| Check a settlement payload                  | `validateSettleProgram` from `/verify`; `verifySvmSettleExecution` from `/svm/verify` | [Verification](../guides/verification.md)                     |
| Test a program on a local chain             | `fork`, `local` from `/testing`                                                       | [Testing kit](testing-kit.md)                                 |
| Read a protocol's document as text          | `getProtocolSkill` from `/skills`                                                     | [Protocol resources](#protocol-resources)                     |
| Type-check a `*.sauce.ts` file in an editor | `/sauce-script` (types only)                                                          | [In an editor](../guides/cli-programs.md#in-an-editor)        |
| See what changed between releases           | none                                                                                  | [Changelog](../changelog.md)                                  |

## Every import path

| Import                         | Contents                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                            | Chain accessors (`Base`, `Solana`, …), `chain` and `Token`; the namespaces `routes`, `token`, `deposit`, `contracts`, `svmVenues`; protocol and chain queries; Pot and cook helpers (`v12PredictPot`, `potSalt`, `destinationPot`, `destinationExecutionFee`); `sqrtPriceX96FromPrice`/`priceFromSqrtPriceX96`; `ready` |
| `/compiler`                    | `compile`, `ready`, compiler types, the compact codec, and `resolveSdkModule`/`resolveSdkPackage`                                                                                                                                                                                                                       |
| `/actions`                     | JSON action programs by names and pool keys: validation, compilation for a chain, and intents; the JSON Schema is `/actions/action-program.schema.json`                                                                                                                                                                 |
| `/protocols/*`                 | One protocol's `protocolInfo`, `deployments`, ABI exports, and named SauceScript templates                                                                                                                                                                                                                              |
| `/chains`                      | Canonical chain identities and EVM chain metadata                                                                                                                                                                                                                                                                       |
| `/deployments`                 | Sauce engine and Kitchen addresses, Pot derivation inputs, and which engine runs which compiler's programs                                                                                                                                                                                                              |
| `/recipes`                     | EVM settlement source and CCTP/plain-transfer recipe builders and sources                                                                                                                                                                                                                                               |
| `/recipes/settle.sauce.ts`     | EVM settlement source asset                                                                                                                                                                                                                                                                                             |
| `/svm`                         | The Solana side: clients (`createSauceSvmClient`), clusters, program-derived addresses (`derivePotPda`), account resolution (`resolveAccounts`), Kitchen instructions, transactions (`buildExecuteTransaction`), token accounts (`svmTokenAccount`), venue accessors (`venue`, `venues`), recipes, and the Portal       |
| `/svm/engine`                  | SVM engine wire format and instruction builders                                                                                                                                                                                                                                                                         |
| `/svm/engine-artifacts`        | Node-only: file paths to the packaged SVM engine and Kitchen binaries and the Kitchen IDL                                                                                                                                                                                                                               |
| `/svm/verify`                  | SVM program and gated engine CPI verification (`verifySvmSettleProgram`, `decodeSvmSettleExecution`, `verifySvmSettleExecution`); the Kitchen's own envelope is decoded separately                                                                                                                                      |
| `/svm/recipes/settle.sauce.ts` | SVM settlement source asset                                                                                                                                                                                                                                                                                             |
| `/evm/engine`                  | EVM Pot and Kitchen ABIs and call encoders (`v12PotAbi`, `v12KitchenAbi`, `v12Pot`, `v12Kitchen`), and `potRouterUpdate`                                                                                                                                                                                                |
| `/verify`                      | EVM settlement encoding, structural decoding, and validation against the pinned program                                                                                                                                                                                                                                 |
| `/skills`                      | The per-protocol documents and their index, as text                                                                                                                                                                                                                                                                     |
| `/testing`                     | Node-only: run programs on a forked or empty local chain from a test, recorded once and replayed                                                                                                                                                                                                                        |
| `/sauce-script`                | Types only: SauceScript's builtins, chains and ABI modules, for an editor checking `*.sauce.ts` programs                                                                                                                                                                                                                |

The [`exports` map](../../package.json) defines this list. There is no `/routes`, `/token`,
`/deposit`, or `/contracts` subpath; import these namespaces from the root:

```ts
import { routes, token, contracts } from "@eco-incorp/sauce";
import { compile } from "@eco-incorp/sauce/compiler";
```

The `/svm` barrel is large and the Solana pages are organized by task, not by export. Take the
export names there from the package's own types; the [Solana guide](../guides/solana.md) shows the
ones a task uses. `verifySvmSettleExecution` is not in the `/svm` barrel: import it from
`/svm/verify`.

Every chain is a **named export** of the root: `import { Base, Solana } from "@eco-incorp/sauce"`.
Importing the package puts nothing on `globalThis`. `chain(ref)` and the host `Token` builder are
named exports too.

Bare names such as `USDC` and `Uniswap` are different: they are _program syntax_, resolved by the
compiler inside a route body, with no host JavaScript object behind them. The same registry entries
are on the chain export in TypeScript (`Base.USDC`, `Base.Uniswap`). See
[protocols and tokens](../guides/protocols-and-tokens.md).

## More references

- [SauceScript reference](../reference/saucescript.md): every type, operator, statement, builtin
  and limit, per target, checked against the compiler.
- [`@sauce/router` on Solana](router-solana.md): the same swap library's Solana venues.
- [Chains](../reference/chains.md), [protocols](../reference/protocols.md) and
  [tokens](../reference/tokens.md): what the registries hold, generated from them.

For programs assembled from data rather than written, see [builders](../guides/builders-and-actions.md).

## Protocol resources

```ts
import { getProtocol, getProtocolsByChain, listProtocols } from "@eco-incorp/sauce";
import { PoolABI } from "@eco-incorp/sauce/protocols/aave-v3";
import { getProtocolIndex, getProtocolSkill, listSkillSlugs } from "@eco-incorp/sauce/skills";

const baseProtocols = getProtocolsByChain(8453);
const aave = getProtocol("aave-v3");
const protocols = listProtocols();
const indexMarkdown = getProtocolIndex();
const aaveMarkdown = getProtocolSkill("aave-v3");
const availableSkills = listSkillSlugs();
```

Each document is Markdown written for coding agents; loading one reads a document and performs no
protocol operation. `getProtocolSkill` throws for a slug absent from `listSkillSlugs()`. The
documents are the ones `sauce skills install` puts in a project
([Agent skills](../guides/skills.md)), so the text this export returns is the text an agent
reads. Each protocol's page in the [reference](../reference/protocols.md) carries its document too.

## Where each import runs

Every import runs in Node and in a browser, with two exceptions, both Node-only:

- `/svm/engine-artifacts` returns filesystem paths to the packaged engine binaries, for a local
  LiteSVM harness.
- `/testing` starts a local `anvil` or a LiteSVM chain for a test.

The [`sauce` command](../guides/cli.md) is not an import at all: it is the package's executable, and
Node-only too. The [install](../guides/cli.md#install) section names the Node version.

Anything that compiles — `/compiler`, route compilation, the builders, the recipes, `/actions`,
`/svm/verify` — needs one `await ready()` first in a browser, while the compiler's WebAssembly
loads; the [compiler reference](compiler.md#in-a-browser) covers it. In Node nothing needs it.
`/verify` never loads the compiler: its dependency closure is `viem` alone, so an EVM settlement
payload can be validated in a browser or an edge runtime without it.

The package ships no RPC endpoint in any import: every client you build takes the connection from
you. The `sauce` command is the one exception, and it keeps its public endpoints to itself; see
[your own endpoints](../guides/cli.md#your-own-endpoints).

## Pots and cooks in code

Each step of running a program on a Pot, with the `sauce` command and in TypeScript
([Kitchen, Pot and cook](../concepts/kitchen-pot-cook.md) explains the three):

| To                          | With the `sauce` command                        | In TypeScript                                                                    |
| --------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Find a Pot's address        | `sauce pot --owner <address>`                   | `v12PredictPot(owner, salt)` from `@eco-incorp/sauce`                            |
| Deploy a Pot                | `sauce run` (when needed), `sauce pot --deploy` | `routes.sauceEvmDeployPotCall({ owner, salt })`                                  |
| Simulate a cook             | `sauce simulate`                                | an `eth_call` of the cook from the owner, on a deployed Pot                      |
| Build a cook                | `sauce tx`                                      | `v12Pot.encodeCook(engine, program)` from `@eco-incorp/sauce/evm/engine`         |
| Send a cook                 | `sauce run`                                     | your own wallet client, with the cook as `to`, `data` and `value`                |
| Read the fee                | read by `sauce run` and `sauce tx`              | `destinationExecutionFee()`                                                      |
| Find the Kitchen and engine | `sauce pot` prints the Kitchen                  | `v12KitchenAddress()`, `v12EngineAddress()` from `@eco-incorp/sauce/deployments` |

A cook is `Pot.cook(engine, program)`, so building one needs both addresses. A direct
`routes.compileSauceRoute` takes them from you. An intent derives them: the released engine, and
the Pot its Portal's Executor owns under salt zero, `SAUCE_INTENT_POT_SALT`.

On Arc, native value is USDC at 18 decimals, drawn from the same balance as the USDC ERC-20
([Arc: USDC is the native coin](../reference/chains/arc.md#notes)). The Kitchen fee there is paid
in that USDC.

### A Pot's Router after a rollout

After a Router rollout, `potRouterUpdate(client, pot)` from `@eco-incorp/sauce/evm/engine` reads the
Pot's Router and the Kitchen's through your client. It returns the `setRouter` call for the Pot's
owner to sign, or nothing when the Pot is already current. Nothing sends it for you, and a call
from anyone but the owner reverts with `NotOwner()`. It throws for a Pot of an earlier Kitchen
release, which has no `setRouter` and keeps its Router for good.
[pot-router.ts](../examples/pot-router.ts) shows the check.

### The full ABIs

`v12PotAbi` and `v12KitchenAbi` from `/evm/engine` are the released contracts' complete ABIs. The
Kitchen's includes its owner-only administration: `initialize`, `setRouter`, `setExecutionFee`,
the ownership transfer and the upgrade.

### Other kinds of Pot

The SDK's helpers use private Pots. The Kitchen also exposes `deployPot(owner, salt, true)` for a
private Pot with an immutable Router, and `deploySharedPot(salt)` for an ownerless Shared Pot,
whose Router is always immutable. Anyone can cook on an ownerless Shared Pot and spend its funds:
fund it and use it up within one transaction. Encode these calls with `v12KitchenAbi`.

## Next

Read the [Compiler](compiler.md) reference for `compile()` itself, or [Routes](routes.md) to build
an intent.
