# Routes API

[Documentation](../README.md) · [Create an intent](../guides/intents.md) · [Compiler](compiler.md)

> This is the reference for building intents from TypeScript: the chain functions such as `Base(...)`,
> their options, and what you get back. [Create an intent](../guides/intents.md) explains intents;
> this page lists every setting.

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
| `tokens`                                        | Solver-delivered destination tokens                                              |
| `nativeAmount`                                  | Native the solver sends with the fill. Defaults to the sum of the calls' values  |
| `precalls`                                      | Calls before the compiled program and nested calls                               |
| `tokenDefines`                                  | Token-symbol address overrides                                                   |
| `defines`, `compile`                            | Program specialization and compile options                                       |
| `sourcePortal`                                  | Source Portal for submission/read requests. Defaults like `portal`               |
| `source`, `creator`, `prover`, `rewardDeadline` | Fallback fields for `.reward(...)`; `prover` defaults as the reward's does       |

On an EVM destination the Pot and engine are derived when omitted: the Pot owned by the `executor()` of the Portal the route records, under salt zero (`SAUCE_INTENT_POT_SALT`) — the one Pot per Portal the solver deploys — and the released engine. The route does not deploy it: the Pot must exist before fulfilment, and the solver deploys it. A Pot you name must equally exist and be owned by that Executor. `destinationPot(chain, { portal?, ecoRoutes? })` returns the derived address. Set `execution.value` to the current Kitchen fee plus any native assets the program spends; with no `value`, the cook sends zero and works only with a fee-free Kitchen. `nativeAmount` defaults to the sum of the route's call values — each cook's `value`, each precall's, each nested child's — less a `fundedByBody` child's native reward: what the Executor pays out, so the solver sends exactly that. One you set is used as given. See [the destination Pot](../guides/intents.md#the-destination-pot).

`.reward(...)` accepts an object, a native amount as `bigint`, or an array of `{ token, amount }`. Object fields override option fallbacks. `source` and `creator` must resolve from one of those places. `prover` defaults to `ecoRoutesProver(source, destination, options.ecoRoutes)`, the registry's prover for the pair — the one an intent opened inside a program and `sauce intent publish` record — and a pair the registry has none for must name one. Reward deadline resolution is `reward.deadline`, then `options.rewardDeadline`, then `options.deadline`. Native and token amounts default to zero/empty where omitted.

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

`sauceEvmDeployPotCall({ owner, salt, kitchen? })` encodes Pot deployment through a Kitchen, by default the released one (`v12KitchenAddress()`); for a direct intent route the owner is the destination `Portal.executor()`. No route the SDK builds includes this call. To deploy an intent's shared Pot yourself before the solver does, pass that Executor and `SAUCE_INTENT_POT_SALT`.

Every address helper here returns a **recorded** address, never a verified one. `v12EngineAddress()` and `v12KitchenAddress()` give the released addresses, the same on every chain; the SDK reads no chain, so it cannot say whether code is there. Check the chain before trusting any of them; [evm-execution.ts](../examples/evm-execution.ts) shows prediction, deployment and the owner/Kitchen checks.

`buildSauceSvmCall` and the SVM route path emit an 8-byte engine instruction that the Solana engine does not accept, whatever code account or engine id you give them: they do not build the Kitchen call the engine requires. Build Solana execution with the Kitchen client instead — see [SVM destinations in Eco intents](../guides/solana.md#svm-destinations-in-eco-intents).

## Built intents

| Member                                        | Behavior                                                           |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `intent`, `root()`                            | Normalized head intent                                             |
| `source`, `destination`                       | Canonical chain records                                            |
| `compiled`                                    | Head destination program's compilation result                      |
| `children`                                    | Direct nested children                                             |
| `intents()`                                   | Root-first preorder traversal of all intents                       |
| `hash()`                                      | Intent, route, and reward hashes                                   |
| `encodeEVM()`, `encodeSVM()`                  | Explicit codec serialization of route and reward                   |
| `sourceTxs({ fundVia, vault, allowPartial })` | The head reward's funding and publication, in order                |
| `approvals()`                                 | EVM approval requests for the head reward                          |
| `publishCalldata()`                           | Source Portal publication request                                  |
| `publishAndFundCalldata(allowPartial)`        | Publication and funding request                                    |
| `fundCalldata(allowPartial)`                  | Funding request                                                    |
| `vaultCall()`, `hashCall()`, `fundedCall()`   | Source Portal read request plus result decoder                     |
| `predictVault(config?)`                       | Offline CREATE2 prediction; eco-routes' derivation unless `config` |

Submission and read helpers take an optional `{ portal }` override; without one they use `sourcePortal`, which itself defaults to the eco-routes Portal for the reward's source chain. They build EVM requests, require an EVM source, and perform no RPC — you send them. The codec represents an SVM destination fine; building that execution is the separate matter above. `encodeEVM()`/`encodeSVM()` force a codec for inspection; they do not change an intent's chain kinds.

`sourceTxs()` funds by transfer by default: a `transfer` of each reward token to the intent's vault, a plain send of the native amount, then `publish`. Pass `vault` as `vaultCall()` read it; it must equal `predictVault()` or `IntentVaultMismatchError` is thrown. `fundVia: "publishAndFund"` (or `IntentOptions.fundVia`, which also selects it for the intents the route's own program opens) returns `approvals()` then `publishAndFundCalldata(allowPartial)`. The same choice is `intentSourceTxs(intent, { portal }, options)` for an `Intent` built some other way, over `vaultTransferTxs`, `rewardVaultLegs`, `predictIntentVault` and `assertIntentVault`; `ecoRoutesVaultConfig(portal)` is the vault configuration behind the prediction. [Intents](../guides/intents.md#submit-the-source-reward) covers the order and the checks.

The destination side is a solver's, and two helpers build it from `built.intent`: `fulfillTx(intent, { claimant })` is `Portal.fulfill(intentHash, route, rewardHash, claimant)`, sent to the Portal the route records with `route.nativeAmount` as its value, and `fulfillApprovalTxs(intent)` the solver's approvals of that Portal for the route's tokens, which it pulls from the solver first (one per token, the entries summed). Both require an EVM destination. The route they carry is `evmRouteTuple(route)`, the value `routeHash` is taken over, so the Portal's hash check agrees with `hashIntent`. [`sauce intent fill`](../guides/cli-intents.md#simulating-a-fill-in-detail) simulates them on the destination with no key, and with `--send` sends them.

After the fill, the same module builds the rest of an intent's life, each as a request you send: `fulfillAndProveTx(intent, { claimant, prover, sourceDomain, data, fee })` (the fill and its proof in one, `route.nativeAmount + fee` as its value) and `proveTx(intents, { prover, sourceDomain, data, fee })` on the destination, with `hyperlaneProverData({ sourceProver })` the Hyperlane prover's `data` and `proverFeeCall(...)` its fee; `withdrawTx`, `batchWithdrawTx` and `refundTx` on the source, taking `{ portal }`; `cancelTx` and `cancelAndProveTx` on a destination Portal that has `cancel`, after the route's deadline. The reads that decide them are `rewardStatusCall` (one of `REWARD_STATUSES`), `fulfillmentCall` (what the destination recorded: a claimant, `CANCELLED_CLAIMANT_BYTES32`, or zero), `provenIntentCall` (the source prover's claimant and destination) and `proofTypeCall`. `intentFromPublished(log, sourceChainId)` rebuilds an intent from its `IntentPublished` log, checking its hash. [After the fill](../guides/intents.md#after-the-fill-prove-claim-refund-cancel) explains when each applies.

## Nested intents

A nested intent is written in the program: `Chain(() => { ... }).reward({ ... })` in a body opens
an intent when that body runs, at any depth. In a typed closure the chain is the imported export,
which carries that SauceScript call (`SauceIntentChain`) ahead of its host signature — see [nested intents](../guides/nested-intents.md) and
[create an intent](../guides/intents.md#create-an-intent-from-inside-a-program).
`SauceCompileOptions.intents` carries what that lowering cannot look up (a deadline, a creator, the
fee of a program body's cook) and what overrides it: `sourcePortal`, `destinationPortal`, `prover`,
`salt`, `fundVia`, `allowPartial`, and the eco-routes `generation`/`environment`. They apply to every
intent the program opens, at every depth. Through `Base(...)` the deadlines, the creator, `fundVia`
and the eco-routes selection are inherited from the enclosing intent.

`compileSauceProgram(chain, source, options).intents` lists the intents a program opens, each as
the lowering encoded it (`LoweredIntent`): one with no `captures` is fixed when it is built, so
`intentSourceTxs(intent, { portal })` publishes it from a wallet, as `sauce intent publish` does.

## Nesting in TypeScript

`.nest(childOrThunk, options?)`, called before `.reward(...)`, attaches an intent built in
TypeScript to a route built in TypeScript: the lower level under the program form, for per-level
options, for [action programs](../guides/actions.md#fund-a-child-from-a-measured-amount), and for a
child that is never published. The thunk form, `(on) => Chain(...).reward({ ...reward, source: on })`,
receives the parent's destination as the child's source; an already built child is checked to have
it. Each mode below is the `via` option.

### Transfer funding (the default)

`via: "transfer"`, after the parent program by default: one more Sauce program, cooked on the
parent's Pot, reads the Pot's balance and transfers each child reward asset to the child's vault.
The child is not published: no `IntentPublished` is emitted, so share it with your solver yourself.

| Option                 | Default          | Effect                                                                                                        |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `clamp`                | `true`           | Transfer at most the declared child reward amount                                                             |
| `requireCap`           | `false`          | If enabled, revert the parent fulfillment when the Pot cannot cover the cap                                   |
| `native`               | `"balance"`      | Include the native leg; `"skip"` omits it                                                                     |
| `fundNativeFromRoute`  | `false`          | Forward the child's declared native reward from route value into the transfer `cook`                          |
| `executionFee`         | `0n`             | The Kitchen fee for the transfer cook                                                                         |
| `position`             | `"after"`        | Run after the parent body; `"before"` runs before it                                                          |
| `vault`, `vaultConfig` | the runtime read | A vault verified with `child.vaultCall()`, or `routes.ecoRoutesVaultConfig(portal)` for an offline prediction |

With `requireCap: false` a short Pot balance can leave the child underfunded while the parent
succeeds. Children merged into one position share one cook, so they must give the same Pot, engine
and fee; `"before"` and `"after"` cooks each pay.

### Publication funding

`via: "publishAndFund"` splices the Executor's ERC-20 approvals and `Portal.publishAndFund` into the
parent route: no cook and no fee. The child's reward assets must be in the Executor when those calls
run. The builder checks the parent route's declared assets cover the child rewards, unless
`fundedByBody: true` says the parent program supplies them. `allowPartial` defaults to `false`.

### Dynamic children

`via: "dynamic"` creates the child **during** the parent's execution, from an amount measured on
chain, as an intent opened in the program does by capturing a variable. Build the child with
`AMOUNT_IN_PLACEHOLDER` and `AMOUNT_OUT_PLACEHOLDER` where the amounts belong, and name the
measurement:

| Option         | Default                     | Effect                                                                                   |
| -------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| `measure`      | required                    | `erc20Balance`, `nativeBalance`, or a caller-supplied SauceScript expression             |
| `scale`        | `10n ** 18n`                | `amountOut = ceil(amountIn * scale / WAD)`; carries decimals conversion and margin       |
| `minAmountIn`  | `1n`                        | Revert the parent fulfillment below this floor; `0n` removes the check                   |
| `placeholders` | both 32-byte sentinels      | Which sentinels to cut at, with per-slot `scale`, `width`, `littleEndian`, `occurrences` |
| `approve`      | `"auto"`                    | Emit the Pot's reward-token approvals; `"none"` leaves them to you                       |
| `value`        | `child.reward.nativeAmount` | Native forwarded to `publishAndFund`                                                     |
| `allowPartial` | `false`                     | Passed through to `publishAndFund`                                                       |
| `executionFee` | `0n`                        | The cook's total value: Kitchen fee plus any native the child forwards                   |

The child's `publishAndFund` calldata is encoded once, cut at every placeholder, and emitted as
literal byte runs in an extra cook, which reads the balance, derives the amounts, approves the
Portal and calls it. Declare `occurrences` for every placeholder. Every guard it emits reverts the
parent's whole fulfilment. The child's real hash exists only once the parent runs: read it from
`IntentPublished`, or rebuild it off-chain with `renderDynamicChild(child, options, amountIn)`. A
child bound for Solana takes `AMOUNT_IN_PLACEHOLDER_U64`/`AMOUNT_OUT_PLACEHOLDER_U64` with
`width: 8, littleEndian: true` for its Borsh route amounts. `dynamicChildTemplate`,
`dynamicChildStatements` and `dynamicChildProgram` expose the segments, statements and program the
builder generates; underneath are `splitByPlaceholders`, `renderTemplate` and `emitTemplate`, which
work against any encoding whose fields sit at fixed offsets.

A dynamic child is an ordinary built intent, so it can carry a dynamic nest of its own. Splitting a
payload cuts the sentinels out, so a parent's split finds only its own child's slots, never a
grandchild's. Growth is linear: about 1,500 bytes of `cook` calldata at depth 1 and 1,950 per level
after it on the SDK's fixture. A `hex` segment carries a `u16` length, so the deepest cascade that
compiled there is 34 levels, and one more fails naming the limit.

### Ordering and constraints

The route's calls run in this order: the parent's `precalls`, children positioned `"before"`, the
parent's compiled program, children positioned `"after"`. Within a position, publication calls come
first, then the merged transfer cook, then the merged dynamic cook; children of one mode run in
`.nest()` order. The builder requires an EVM parent destination, a child whose source is the
parent's destination, and child deadlines no earlier than the parent route's. Identical direct
children are refused: give them distinct salts. `.intents()` lists the root and its descendants in
preorder, and `.children` the direct children; the root's funding helpers fund only the root.
`nestedChildCalls` builds the publication calls with explicit Portal and `allowPartial` settings.

## Lower-level encoding

For callers building their own calls, `assembleIntent(source, destination, route, reward)` normalizes an intent without compiling a program. `encodeRoute`, `encodeReward`, `hashIntent`, and their explicit EVM/SVM variants expose encoding and hashing. `toUniversalAddress` normalizes addresses for the cross-chain intent model, while `denormalizeToEvm` converts an EVM-shaped universal address back to its 20-byte form.

Where eco-routes is deployed is a registry: `ecoRoutesPortal(chain)`, `ecoRoutesProver(source,
destination)`, `ecoRoutesDeployment(chain)` and `ecoRoutesGenerations()` from
`@eco-incorp/sauce/protocols/eco-routes`. Both generations ship — `v3`'s single Portal and `v2`'s
separate `IntentSource`/`Inbox` — in production and staging, vendored from
`@eco-foundation/routes-ts` at a pinned version and digest.
