# API reference

Install `@eco-incorp/sauce` and import through the package's public entry points. All paths below
are suffixes of that package name; `.` means `@eco-incorp/sauce` itself.

| Import                         | Contents                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.`                            | Chain accessors (`Base`, `Solana`, …); `routes`, `token`, `swap`, `deposit`, `contracts`, `svmVenues`; protocol and chain queries; `ready` |
| `/compiler`                    | `compile`, `ready`, compiler types, the compact codec, and `resolveSdkModule`/`resolveSdkPackage`                                          |
| `/actions`                     | JSON action programs: validation, compilation and intents; the JSON Schema is `/actions/action-program.schema.json`                        |
| `/protocols/*`                 | One protocol's `protocolInfo`, `deployments`, ABI exports, and named SauceScript templates                                                 |
| `/chains`                      | Canonical chain identities and EVM chain metadata                                                                                          |
| `/deployments`                 | Sauce engine/Kitchen addresses, Pot derivation inputs, and recorded deployment coverage                                                    |
| `/recipes`                     | EVM settlement source and CCTP/plain-transfer recipe builders and sources                                                                  |
| `/recipes/settle.sauce.ts`     | EVM settlement source asset                                                                                                                |
| `/svm`                         | SVM clients, account plans, resolution, staging, Kitchen instructions, recipes, and transactions                                           |
| `/svm/engine`                  | SVM engine wire format and instruction builders                                                                                            |
| `/svm/engine-artifacts`        | Node-only helpers locating packaged SVM engine/Kitchen binaries and IDL                                                                    |
| `/svm/verify`                  | SVM program and gated engine CPI verification; separate Kitchen decoding is required                                                       |
| `/svm/recipes/settle.sauce.ts` | SVM settlement source asset                                                                                                                |
| `/evm/engine`                  | EVM Pot and Kitchen ABIs and call encoders (`v12PotAbi`, `v12KitchenAbi`, `v12Pot`, `v12Kitchen`)                                          |
| `/verify`                      | EVM settlement encoding, structural decoding, and validation against the pinned program                                                    |
| `/skills`                      | Protocol Markdown index and skill-file loaders                                                                                             |

The [`exports` map](../../package.json) defines this list. There is no `/routes`, `/token`,
`/swap`, `/deposit`, or `/contracts` subpath; import these namespaces from the root:

```ts
import { routes, token, contracts } from "@eco-incorp/sauce";
import { compile } from "@eco-incorp/sauce/compiler";
```

Every chain is a **named export** of the root: `import { Base, Solana } from "@eco-incorp/sauce"`.
Importing the package puts nothing on `globalThis`. `chain(ref)` and the host `Token` builder are
named exports too.

Bare names such as `USDC` and `Uniswap` are different: they are _program syntax_, resolved by the
compiler inside a route body, with no host JavaScript object behind them. See
[protocols and tokens](../guides/protocols-and-tokens.md).

## Detailed references

- [Compiler](compiler.md): direct compilation, result metadata, compact argument encoding.
- [Routes](routes.md): compile options, intent construction, nested execution, and submission helpers.
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

Skill files are Markdown written for AI coding assistants; loading one reads a document and
performs no protocol operation. `getProtocolSkill` throws for a slug absent from `listSkillSlugs()`.

## Where each import runs

Every import runs in Node **24 or newer** and in a browser, with one exception:
`/svm/engine-artifacts` returns filesystem paths to the packaged engine binaries for a local
LiteSVM harness, and is Node-only.

Anything that compiles — `/compiler`, route compilation, the builders, the recipes, `/actions`,
`/svm/verify` — needs one `await ready()` first in a browser, while the compiler's WebAssembly
loads; the [compiler reference](compiler.md#in-a-browser) covers it. In Node nothing needs it.
`/verify` never loads the compiler: its dependency closure is `viem` alone, so an EVM settlement
payload can be validated in a browser or an edge runtime without it.
