# API reference

Install `@eco-incorp/sauce` and import through the package's public entry points. All paths below
are suffixes of that package name; `.` means `@eco-incorp/sauce` itself.

| Import                         | Contents                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `.`                            | `routes`, `token`, `swap`, `deposit`, `contracts`, `svmVenues`; protocol and chain queries; installation of chain globals |
| `/compiler`                    | `compile`, compiler types, `encodeCompactArguments`, and `decodeCompactArguments`                                         |
| `/actions`                     | Action primitives and `actionsToSauce` composition                                                                        |
| `/protocols/*`                 | One protocol's `protocolInfo`, `deployments`, ABI exports, and named SauceScript templates                                |
| `/chains`                      | Canonical chain identities and EVM chain metadata                                                                         |
| `/deployments`                 | Sauce engine/Kitchen addresses, Pot derivation inputs, and recorded deployment coverage                                   |
| `/recipes`                     | EVM settlement source and CCTP/plain-transfer recipe builders and sources                                                 |
| `/recipes/settle.sauce.ts`     | EVM settlement source asset                                                                                               |
| `/svm`                         | SVM clients, account plans, resolution, staging, Kitchen instructions, recipes, and transactions                          |
| `/svm/engine`                  | SVM engine wire format and instruction builders                                                                           |
| `/svm/engine-artifacts`        | Node helpers locating packaged SVM engine/Kitchen binaries and IDL                                                        |
| `/svm/verify`                  | SVM program and gated engine CPI verification; separate Kitchen decoding is required                                      |
| `/svm/recipes/settle.sauce.ts` | SVM settlement source asset                                                                                               |
| `/evm/engine`                  | EVM Pot and Kitchen ABIs and call encoders (`v12PotAbi`, `v12KitchenAbi`, `v12Pot`, `v12Kitchen`)                         |
| `/verify`                      | EVM settlement encoding, structural decoding, and validation against the pinned program                                   |
| `/skills`                      | Protocol Markdown index and skill-file loaders                                                                            |

The [`exports` map](../../package.json) defines this list. There is no `/routes`, `/token`,
`/swap`, `/deposit`, or `/contracts` subpath; import these namespaces from the root:

```ts
import { routes, token, contracts } from "@eco-incorp/sauce";
import { compile } from "@eco-incorp/sauce/compiler";
```

`Base`, `Solana`, `chain`, and `Token` are installed globals, rather than named root exports.
Bare protocol and token globals such as `Uniswap` and `USDC` describe compiled route source and
have no corresponding host JavaScript objects. See
[protocols and tokens](../guides/protocols-and-tokens.md).

## Detailed references

- [Compiler](compiler.md): direct compilation, result metadata, compact argument encoding.
- [Routes](routes.md): compile options, intent construction, nested execution, and submission helpers.
- [Coverage](coverage.md): distinguish catalog entries, callable descriptors, and available deployments.

For structured program creation, see [builders and actions](../guides/builders-and-actions.md).
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

Skill resources are documentation strings; loading one performs no protocol operation.
`getProtocolSkill` throws for a slug absent from `listSkillSlugs()`.

## Runtime requirements

The root SDK, its route compiler integration, recipe source loaders, skill loaders, and artifact
resolvers use Node.js APIs. `/verify` has a `viem`-only dependency closure and can validate EVM
settlement payloads in a browser without loading the compiler. See the
[compiler reference](compiler.md) for the compiler dependency's separate browser entry point.
