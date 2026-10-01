# Routes API

[Documentation](../README.md) · [Create an intent](../guides/intents.md) · [Compiler](compiler.md)

`routes` is the namespace behind every chain accessor: the intent builder, the encoders and hashes,
the Portal helpers and the nesting modes. Import it from the package root, next to the chains you use:

```ts
import { Base, routes } from "@eco-incorp/sauce";

const destination = routes.chain("base");
```

There is no `/routes` subpath. The public types are members of the namespace: `routes.IntentOptions`,
`routes.BuiltIntent`, and so on.

## Chain entry points

| Entry point                            | Result                                            |
| -------------------------------------- | ------------------------------------------------- |
| `Base(body, options)`                  | Pending destination route awaiting `.reward(...)` |
| `Base.route(body, options)`            | Same behavior as the callable chain               |
| `routes.chain(ref)`                    | Chain route entry point for a chain reference     |
| `routes.chainAccessors.Base`           | Explicit access to the route chain entry point    |
| `routes.openRoute(ref, body, options)` | Direct function behind chain entry points         |

Chain references accept canonical slugs, names/aliases supported by the registry, numeric chain IDs, and canonical chain records. `.chain` exposes the canonical record.

`Base` and every other chain are **named exports of the package root**; importing the package installs nothing on `globalThis`. A root-imported accessor is the composed one, which also exposes host contract and venue accessors (`Base.Uniswap.UniversalRouter`, `Solana.RaydiumCpSwap`) and the chain's registry tokens (`Base.USDC`), described in the [contracts reference](contracts.md); `routes.chainAccessors.Base` is the bare route entry point without them. A host that wants the bare names at run time can call `installRouteGlobals()`; `uninstallRouteGlobals()` reverses it, and neither installs TypeScript declarations.

`body` accepts a source string or a synchronous zero-argument callback. A string is a SauceScript file, compiled as written: a module declaring `function main(...)`, or a script whose top-level statements are the entry. A script cannot `return`, so a program that returns a value declares `main`. A callback supplies source text, with no JavaScript capture. See [callback semantics](../guides/intents.md#callbacks-are-compiled-source).

## Intent options

| Option                                          | Purpose                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `execution`                                     | EVM `{ pot?, engine?, value? }`; an SVM route call is not executable (see below) |
| `pot`, `engine`                                 | EVM shorthand for `execution.pot` and `execution.engine`; each optional          |
| `deadline`                                      | Absolute route deadline. Required                                                |
| `portal`                                        | Destination Portal. Defaults to the eco-routes deployment for that chain         |
| `ecoRoutes`                                     | Which eco-routes deployment to address: `generation` and `environment`           |
| `salt`                                          | Route salt; defaults to 32 zero bytes                                            |
| `tokens`, `nativeAmount`                        | Solver-delivered destination assets                                              |
| `precalls`                                      | Calls before the compiled program and nested calls                               |
| `tokenDefines`                                  | Token-symbol address overrides                                                   |
| `defines`, `compile`                            | Program specialization and compile options                                       |
| `sourcePortal`                                  | Source Portal for submission/read requests. Defaults like `portal`               |
| `source`, `creator`, `prover`, `rewardDeadline` | Fallback fields for `.reward(...)`                                               |

On an EVM destination the Pot and engine are derived when omitted: the Pot owned by the `executor()` of the Portal the route records, under salt zero (`SAUCE_INTENT_POT_SALT`) — the one Pot per Portal the solver deploys — and the released engine. The route does not deploy it: the Pot must exist before fulfilment, and the solver deploys it. A Pot you name must equally exist and be owned by that Executor. `destinationPot(chain, { portal?, ecoRoutes? })` returns the derived address. Set `execution.value` to the current Kitchen fee plus any native assets the program spends, and budget `nativeAmount` for all route call values; with no `value`, the cook sends zero and works only with a fee-free Kitchen. See [the destination Pot](../guides/intents.md#the-destination-pot).

`.reward(...)` accepts an object, a native amount as `bigint`, or an array of `{ token, amount }`. Object fields override option fallbacks. `source`, `creator`, and `prover` must resolve from one of those places. Reward deadline resolution is `reward.deadline`, then `options.rewardDeadline`, then `options.deadline`. Native and token amounts default to zero/empty where omitted.

The compiler needs no source reward to compile a destination program. Use `compileSauceRoute` when you only need destination calls.

## Compile a destination route

```ts
import { routes } from "@eco-incorp/sauce";

export function compileProgram(execution: routes.SauceEvmExecutionInput) {
  return routes.compileSauceRoute("base", "function main() { return 7n; }", execution);
}
```

`compileSauceRoute(destination, source, execution, options?)` returns:

| Field      | Contents                                                              |
| ---------- | --------------------------------------------------------------------- |
| `calls`    | Destination call inputs, normally one call for one program            |
| `compiled` | Route compatibility result with `bytecode: Uint8Array[]` and warnings |
| `source`   | Source after the SDK token/protocol rewrites                          |

The route wrapper differs from the direct `/compiler` API, which returns one byte array plus compiler metadata and an optional SVM account manifest. Use the direct API when you need that metadata. The route target defaults to `"v12"` for EVM and `"svm"` for SVM; direct compiler targets are `"evm"` and `"svm"`.

`SauceCompileOptions` supports `resolve` and `resolvePackage` for the program's own imports, scalar `defines`, token-address `tokens`, ABI `contracts`, `ambient` module names, and `accessors`. `resolve` has the [compiler's resolver contract](compiler.md#resolver-contract) and is asked for any path the program imports; the SDK itself serves `@sauce/token`, `./artifacts/IERC20.json`, `./artifacts/ISauceRouter.json` and every `./protocols/<slug>/<Export>.json`, so source from the SDK's builders needs neither option. Accessor rewriting defaults on; an options object can configure qualified-chain scope or other rewrite behavior. `openRoute` adds each chain's defaults — its token symbols, `chainId` and protocol addresses, taken separately for every chain an intent written in the program names — and the default ambient token module. A `defines` or `tokens` entry under one of those chain-scoped names belongs to the chain the program compiles for: an intent's body on another chain uses that chain's value instead ([names resolve per chain](../guides/intents.md#names-resolve-per-chain)). Direct `compileSauceRoute` performs token/protocol rewrites but does not automatically merge that ambient module.

The route wrapper has no runtime argument-payload parameter. Use compile-time defines here, or direct compilation and a suitable execution API for parameterized entry points; see [compiler integration](compiler.md).

## Already compiled programs

`buildSauceEvmCall({ pot, engine, program, value? })` builds one Pot `cook` call; `program` is a hex string. `value` defaults to zero and must include the Kitchen fee. `buildSauceEvmCalls({ pot, engine, cooks, value? })` applies that value to **each** ordered cook. Multiple statements within one program need only one cook and fee.

Both builders, and `sauceEvmDeployPotCall` below, return `{ to, target, data, value }`. `{ to, data, value }` is the request a wallet sends or `client.call` takes, the same shape as `destinationExecutionFee()` and the Portal transaction builders; `to` is the contract's checksummed 20-byte address. `target` names the same contract as a route's `calls` entry (the Portal's `Call` struct) records it, a 32-byte universal address for a cook, so the object goes into `RouteInput.calls` unchanged. `value` is a `bigint`.

## Deployment addresses

`sauceEvmDeployPotCall({ owner, salt, kitchen })` encodes Pot deployment through the Kitchen you name; for a direct intent route the owner is the destination `Portal.executor()`. No route the SDK builds includes this call. To deploy an intent's shared Pot yourself before the solver does, pass `kitchen: v12GateKitchen()`, that Executor, and `SAUCE_INTENT_POT_SALT`.

Every address helper here returns a **recorded** address, never a verified one. `v12EngineAddress()` and `v12KitchenAddress()` give the released addresses directly and are the ones to prefer. `sauceEvmDeployPotCall`'s `chainId` form, `v12Deployment` and `requireV12Deployment` filter by a roster of chains where deployment previously succeeded, which is a different question from whether code is there now. `V12_EVM_CONTRACTS` and `v12SvmProgramId` name an earlier deployment generation. Check the chain before trusting any of them; [evm-execution.ts](../examples/evm-execution.ts) shows prediction, deployment and the owner/Kitchen checks.

`buildSauceSvmCall` and the SVM route path emit an 8-byte engine instruction that the Solana engine does not accept, whatever code account or engine id you give them: they do not build the Kitchen call the engine requires. Build Solana execution with the Kitchen client instead — see [SVM destinations in Eco intents](../guides/solana.md#svm-destinations-in-eco-intents).

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

Submission and read helpers take an optional `{ portal }` override; without one they use `sourcePortal`, which itself defaults to the eco-routes Portal for the reward's source chain. They build EVM requests, require an EVM source, and perform no RPC — you send them. The codec represents an SVM destination fine; building that execution is the separate matter above. `encodeEVM()`/`encodeSVM()` force a codec for inspection; they do not change an intent's chain kinds.

## Composition and lower-level encoding

Call `.nest(childOrThunk, options?)` before `.reward(...)`. The fluent default is transfer funding after the parent program. [Nested intents](../guides/nested-intents.md) explains funding modes, deadlines, account custody, and execution ordering.

For callers building their own calls, `assembleIntent(source, destination, route, reward)` normalizes an intent without compiling a program. `encodeRoute`, `encodeReward`, `hashIntent`, and their explicit EVM/SVM variants expose encoding and hashing. `toUniversalAddress` normalizes addresses for the cross-chain intent model, while `denormalizeToEvm` converts an EVM-shaped universal address back to its 20-byte form.

The low-level `nestedChildCalls` helper builds approval/publication calls with explicit Portal and `allowPartial` settings. The fluent `.nest()` default is `"transfer"`; pass the current `executionFee` for its additional cook.

`via: "dynamic"` creates the child **during** the parent's execution, from an amount measured on
chain. `AMOUNT_IN_PLACEHOLDER` and `AMOUNT_OUT_PLACEHOLDER` mark the amounts to splice;
`renderDynamicChild(child, options, amountIn)` reproduces the resulting calldata off-chain, and
`dynamicChildTemplate` / `dynamicChildStatements` / `dynamicChildProgram` expose the segments,
statements and merged program the builder generates. Underneath are `splitByPlaceholders`,
`renderTemplate` and `emitTemplate` — byte-templating primitives that work against any encoding whose
fields sit at fixed offsets, not only intents.

A program can also create an intent itself, with `Chain(() => { ... }).reward({ ... })` written in
its body — see [create an intent](../guides/intents.md#create-an-intent-from-inside-a-program).
`SauceCompileOptions.intents` carries what that lowering cannot look up (a deadline, a creator) and
what overrides it: `sourcePortal`, `destinationPortal`, `prover`, `salt`, `allowPartial`, and the
eco-routes `generation`/`environment`. Through `Base(...)` those are inherited from the enclosing
intent, so the common case sets none of them.

Where eco-routes is deployed is a registry: `ecoRoutesPortal(chain)`, `ecoRoutesProver(source,
destination)`, `ecoRoutesDeployment(chain)` and `ecoRoutesGenerations()` from
`@eco-incorp/sauce/protocols/eco-routes`. Both generations ship — `v3`'s single Portal and `v2`'s
separate `IntentSource`/`Inbox` — in production and staging, vendored from
`@eco-foundation/routes-ts` at a pinned version and digest.
