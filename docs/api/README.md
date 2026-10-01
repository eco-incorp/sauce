# API reference

Install `@eco-incorp/sauce` and import through the package's public entry points. All paths below
are suffixes of that package name; `.` means `@eco-incorp/sauce` itself.

| Import                         | Contents                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`                            | Chain accessors (`Base`, `Solana`, …); `routes`, `token`, `deposit`, `contracts`, `svmVenues`; protocol and chain queries; `sqrtPriceX96FromPrice`/`priceFromSqrtPriceX96`; `ready` |
| `/compiler`                    | `compile`, `ready`, compiler types, the compact codec, and `resolveSdkModule`/`resolveSdkPackage`                                                                                   |
| `/actions`                     | JSON action programs: validation, compilation and intents; the JSON Schema is `/actions/action-program.schema.json`                                                                 |
| `/protocols/*`                 | One protocol's `protocolInfo`, `deployments`, ABI exports, and named SauceScript templates                                                                                          |
| `/chains`                      | Canonical chain identities and EVM chain metadata                                                                                                                                   |
| `/deployments`                 | Sauce engine/Kitchen addresses, Pot derivation inputs, and which engine runs which compiler's programs                                                                              |
| `/recipes`                     | EVM settlement source and CCTP/plain-transfer recipe builders and sources                                                                                                           |
| `/recipes/settle.sauce.ts`     | EVM settlement source asset                                                                                                                                                         |
| `/svm`                         | SVM clients, account plans, resolution, staging, Kitchen instructions, recipes, and transactions                                                                                    |
| `/svm/engine`                  | SVM engine wire format and instruction builders                                                                                                                                     |
| `/svm/engine-artifacts`        | Node-only helpers locating packaged SVM engine/Kitchen binaries and IDL                                                                                                             |
| `/svm/verify`                  | SVM program and gated engine CPI verification; separate Kitchen decoding is required                                                                                                |
| `/svm/recipes/settle.sauce.ts` | SVM settlement source asset                                                                                                                                                         |
| `/evm/engine`                  | EVM Pot and Kitchen ABIs and call encoders (`v12PotAbi`, `v12KitchenAbi`, `v12Pot`, `v12Kitchen`), and `potRouterUpdate`                                                            |
| `/verify`                      | EVM settlement encoding, structural decoding, and validation against the pinned program                                                                                             |
| `/skills`                      | The per-protocol documents (the `sauce-protocols` agent skill's references) and their index, as text                                                                                |
| `/sauce-script`                | Types only: SauceScript's builtins, chains and ABI modules, for an editor checking `*.sauce.ts` programs ([In an editor](../guides/cli.md#in-an-editor))                            |

The [`exports` map](../../package.json) defines this list. There is no `/routes`, `/token`,
`/deposit`, or `/contracts` subpath; import these namespaces from the root:

```ts
import { routes, token, contracts } from "@eco-incorp/sauce";
import { compile } from "@eco-incorp/sauce/compiler";
```

Every chain is a **named export** of the root: `import { Base, Solana } from "@eco-incorp/sauce"`.
Importing the package puts nothing on `globalThis`. `chain(ref)` and the host `Token` builder are
named exports too.

Bare names such as `USDC` and `Uniswap` are different: they are _program syntax_, resolved by the
compiler inside a route body, with no host JavaScript object behind them. The same registry entries
are on the chain export in TypeScript (`Base.USDC`, `Base.Uniswap`). See
[protocols and tokens](../guides/protocols-and-tokens.md).

## Detailed references

- [SauceScript reference](../../skills/sauce-script/references/builtins.md): every type, operator,
  statement, builtin and limit, per target, checked against the compiler;
  [`builtins.json`](../../skills/sauce-script/references/builtins.json) lists the builtins with an
  example program each. It is the `sauce-script` agent skill's reference, shipped in the package.
- [Compiler](compiler.md): direct compilation, result metadata, compact argument encoding.
- [`@sauce/router`](router.md): the SauceScript swap library a program imports — one function per
  venue.
- [Routes](routes.md): compile options, intent construction, nested execution, and submission helpers.
- [Contracts and tokens](contracts.md): every protocol namespace and token, in a program and in TypeScript, and running a call through viem.
- [Coverage](coverage.md): distinguish catalog entries, callable descriptors, and available deployments.

For programs assembled from data rather than written, see [builders](../guides/builders-and-actions.md).
For account-based execution and settlement checks, see the [Solana](../guides/solana.md) and
[verification](../guides/verification.md) guides.

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
documents are the `sauce-protocols` agent skill's references
([`skills/sauce-protocols/references/`](../../skills/sauce-protocols/references/index.md)), the same
files `sauce skills install` puts in a project ([Agent skills](../guides/cli.md#agent-skills)), so the
text this export returns is the text an agent reads.

## Where each import runs

Every import runs in Node **24 or newer** and in a browser, with one exception:
`/svm/engine-artifacts` returns filesystem paths to the packaged engine binaries for a local
LiteSVM harness, and is Node-only. The [`sauce` command](../guides/cli.md) is not an import at
all: it is the package's executable, and Node-only too.

Anything that compiles — `/compiler`, route compilation, the builders, the recipes, `/actions`,
`/svm/verify` — needs one `await ready()` first in a browser, while the compiler's WebAssembly
loads; the [compiler reference](compiler.md#in-a-browser) covers it. In Node nothing needs it.
`/verify` never loads the compiler: its dependency closure is `viem` alone, so an EVM settlement
payload can be validated in a browser or an edge runtime without it.
