# Routes API

[Documentation](../README.md) · [Create an intent](../guides/intents.md) · [Compiler](compiler.md)

Import the routes namespace from the package root, alongside the chain accessors:

```ts
import { Base, routes } from "@eco-incorp/sauce";

const destination = routes.chain("base");
```

There is no published `/routes` subpath. Public route types are available as `routes.IntentOptions`, `routes.BuiltIntent`, and other members of this namespace.

## Chain entry points

| Entry point                            | Result                                            |
| -------------------------------------- | ------------------------------------------------- |
| `Base(body, options)`                  | Pending destination route awaiting `.reward(...)` |
| `Base.route(body, options)`            | Same behavior as the callable chain               |
| `routes.chain(ref)`                    | Chain route entry point for a chain reference     |
| `routes.chainAccessors.Base`           | Explicit access to the route chain entry point    |
| `routes.openRoute(ref, body, options)` | Direct function behind chain entry points         |

Chain references accept canonical slugs, names/aliases supported by the registry, numeric chain IDs, and canonical chain records. `.chain` exposes the canonical record.

`Base` and every other chain are **named exports of the package root**; importing the package installs nothing on `globalThis`. A root-imported accessor is the composed one, which also exposes host contract and venue accessors (`Base.Uniswap.UniversalRouter`, `Solana.RaydiumCpSwap`); `routes.chainAccessors.Base` is the bare route entry point without that tree. A host that wants the bare names at run time can call `installRouteGlobals()`; `uninstallRouteGlobals()` reverses it, and neither installs TypeScript declarations.

`body` accepts a source string or a synchronous zero-argument callback. A string can contain a full `function main(...)` or a bare body. A callback supplies source text, with no JavaScript capture. See [callback semantics](../guides/intents.md#callbacks-are-compiled-source).

## Intent options

| Option                                          | Purpose                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `execution`                                     | EVM `{ pot, engine, value? }`; SVM route calls cannot execute on the released engine |
| `pot`, `engine`                                 | EVM shorthand instead of `execution`; both are required together                     |
| `portal`, `deadline`                            | Required destination Portal and absolute route deadline                              |
| `salt`                                          | Route salt; defaults to 32 zero bytes                                                |
| `tokens`, `nativeAmount`                        | Solver-delivered destination assets                                                  |
| `precalls`                                      | Calls before the compiled program and nested calls                                   |
| `tokenDefines`                                  | Token-symbol address overrides                                                       |
| `defines`, `compile`                            | Program specialization and compile options                                           |
| `sourcePortal`                                  | Default source Portal for submission/read requests                                   |
| `source`, `creator`, `prover`, `rewardDeadline` | Fallback fields for `.reward(...)`                                                   |

The EVM shorthand sends zero `cook` value and only works with a fee-free Kitchen when the program needs no native input. For released deployments, use `execution: { pot, engine, value }` with the current Kitchen fee plus any native assets the program spends, and budget `nativeAmount` for all route call values. The direct route's Pot owner must equal the destination `Portal.executor()`. See [deployment and fee setup](../guides/intents.md#prepare-the-destination-pot).

`.reward(...)` accepts an object, a native amount as `bigint`, or an array of `{ token, amount }`. Object fields override option fallbacks. `source`, `creator`, and `prover` must resolve from one of those places. Reward deadline resolution is `reward.deadline`, then `options.rewardDeadline`, then `options.deadline`. Native and token amounts default to zero/empty where omitted.

The compiler needs no source reward to compile a destination program. Use `compileSauceRoute` when you only need destination calls.

## Compile a destination route

```ts
import { routes } from "@eco-incorp/sauce";

export function compileProgram(execution: routes.SauceEvmExecutionInput) {
  return routes.compileSauceRoute("base", "return 7n;", execution);
}
```

`compileSauceRoute(destination, source, execution, options?)` returns:

| Field      | Contents                                                              |
| ---------- | --------------------------------------------------------------------- |
| `calls`    | Destination call inputs, normally one call for one program            |
| `compiled` | Route compatibility result with `bytecode: Uint8Array[]` and warnings |
| `source`   | Source after wrapping and SDK token/protocol rewrites                 |

The route wrapper differs from the direct `/compiler` API, which returns one byte array plus compiler metadata and an optional SVM account manifest. Use the direct API when you need that metadata. The route target defaults to `"v12"` for EVM and `"svm"` for SVM; direct compiler targets are `"evm"` and `"svm"`.

`SauceCompileOptions` supports `baseDirs`, scalar `defines`, token-address `tokens`, ABI `contracts`, `ambient` module names, and `accessors`. Accessor rewriting defaults on; an options object can configure qualified-chain scope or other rewrite behavior. `openRoute` merges chain defaults and the default ambient token module. Direct `compileSauceRoute` performs token/protocol rewrites but does not automatically merge that ambient module.

The route wrapper has no runtime argument-payload parameter. Use compile-time defines here, or direct compilation and a suitable execution API for parameterized entry points; see [compiler integration](compiler.md).

## Already compiled programs

`buildSauceEvmCall({ pot, engine, program, value? })` builds one Pot `cook` call; `program` is a hex string. `value` defaults to zero and must include the Kitchen fee. `buildSauceEvmCalls({ pot, engine, cooks, value? })` applies that value to **each** ordered cook. Multiple statements within one program need only one cook and fee.

## Deployment addresses

`sauceEvmDeployPotCall({ owner, salt, kitchen })` encodes Pot deployment through the supplied Kitchen; direct intent routes use the destination `Portal.executor()` as owner. Its `chainId` alternative selects the pinned release Kitchen only for chains in the historical successful-deployment roster. `v12Deployment` and `requireV12Deployment` also return current release addresses under that historical filter; none of these helpers verifies current on-chain deployment. Prefer explicit `v12KitchenAddress()` after checking the target chain. `V12_EVM_CONTRACTS` and `v12SvmProgramId` are legacy addresses; use the current `/deployments` address functions. [evm-execution.ts](../examples/evm-execution.ts) demonstrates prediction, deployment, and owner/Kitchen checks.

`buildSauceSvmCall` and the SVM route path emit a legacy 8-byte staged-engine instruction, which is **incompatible with engine 1.2.0** even when supplied a code account and the current engine ID. They do not construct the required Kitchen call. Use the direct Kitchen client for Solana execution; see [the SVM intent limitation](../guides/solana.md#svm-destinations-in-eco-intents).

## Built intents

| Member                                      | Behavior                                                            |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `intent`, `root()`                          | Normalized head intent                                              |
| `source`, `destination`                     | Canonical chain records                                             |
| `compiled`                                  | Head destination program's compilation result                       |
| `children`                                  | Direct nested children                                              |
| `intents()`                                 | Root-first preorder traversal of all intents                        |
| `hash()`                                    | Intent, route, and reward hashes                                    |
| `encodeEVM()`, `encodeSVM()`                | Explicit codec serialization of route and reward                    |
| `approvals()`                               | EVM approval requests for the head reward                           |
| `publishCalldata()`                         | Source Portal publication request                                   |
| `publishAndFundCalldata(allowPartial)`      | Publication and funding request                                     |
| `fundCalldata(allowPartial)`                | Funding request                                                     |
| `vaultCall()`, `hashCall()`, `fundedCall()` | Source Portal read request plus result decoder                      |
| `predictVault(config)`                      | Offline CREATE2 prediction with caller-provided vault configuration |

Submission/read helpers accept an optional `{ portal }` override; otherwise `sourcePortal` is required. They generate EVM requests, require an EVM source, and never perform RPC. The codec can represent an SVM destination, but the built-in SVM Sauce route has the execution limitation above. Source/destination-selected encoding is used internally by hashing and Portal helpers; explicitly forcing a codec does not change an intent's chain kinds.

## Composition and lower-level encoding

Call `.nest(childOrThunk, options?)` before `.reward(...)`. The fluent default is transfer funding after the parent program. [Nested intents](../guides/nested-intents.md) explains funding modes, deadlines, account custody, and execution ordering.

For callers building their own calls, `assembleIntent(source, destination, route, reward)` normalizes an intent without compiling a program. `encodeRoute`, `encodeReward`, `hashIntent`, and their explicit EVM/SVM variants expose encoding and hashing. `toUniversalAddress` normalizes addresses for the cross-chain intent model, while `denormalizeToEvm` converts an EVM-shaped universal address back to its 20-byte form.

The low-level `nestedChildCalls` helper builds approval/publication calls with explicit Portal and `allowPartial` settings. The fluent `.nest()` default is `"transfer"`; pass the current `executionFee` for its additional cook.

`via: "dynamic"` creates the child during the parent's execution from a runtime measurement. `AMOUNT_IN_PLACEHOLDER` and `AMOUNT_OUT_PLACEHOLDER` mark the amounts to splice; `renderDynamicChild(child, options, amountIn)` reproduces the resulting calldata off-chain, and `dynamicChildTemplate`/`dynamicChildStatements`/`dynamicChildProgram` expose the segments, statements, and merged program the builder generates. `splitByPlaceholders`, `renderTemplate`, and `emitTemplate` are the underlying byte-templating primitives, usable against any encoding whose fields sit at fixed offsets.
