# Routes API

[Documentation](../README.md) · [Compiler](compiler.md) · [Contracts and tokens](contracts.md)

`routes` is the namespace behind every chain accessor: program and route compilation, the encoders
and hashes, and the Portal helpers. Import it from the package root, next to the chains you use:

```ts
import { Base, routes } from "@eco-incorp/sauce";

const destination = routes.chain("base");
```

There is no `/routes` subpath. The public types are members of the namespace: `routes.Intent`,
`routes.CompiledSauceProgram`, and so on.

## Chain entry points

| Entry point                                       | Result                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `routes.chain(ref)`                               | The chain accessor (`.chain`) for a reference                            |
| `routes.chainAccessors.Base`                      | Explicit access to the bare chain accessor                               |
| `Base(…)`, `Base.route(…)`, `routes.openRoute(…)` | Throw `IntentsComingSoonError`: opening an intent is coming soon (below) |

Chain references accept canonical slugs, names/aliases supported by the registry, numeric chain IDs, and canonical chain records. `.chain` exposes the canonical record.

`Base` and every other chain are **named exports of the package root**: a namespace; importing the package installs nothing on `globalThis`. A root-imported accessor is the composed one, which also exposes host contract and venue accessors (`Base.Uniswap.UniversalRouter`, `Solana.RaydiumCpSwap`) and the chain's registry tokens (`Base.USDC`), described in the [contracts reference](contracts.md); `routes.chainAccessors.Base` is the bare accessor without them. A host that wants the bare names at run time can call `installRouteGlobals()`; `uninstallRouteGlobals()` reverses it, and neither installs TypeScript declarations.

Calling a chain (`Base(…)`) or its `.route(…)`, and `routes.openRoute(…)`, opened an intent whose
route ran a program. Opening an intent is [coming soon](../guides/intents.md), written
`<Chain>.hop({ send, receive, refundee }).then(() => { … })` in a program, so each throws
`IntentsComingSoonError` (exported from the package root; its `site` names the call), typed
`never`. So does compiling a program that writes `<Chain>.hop(…)`, or the earlier
`<Chain>(() => { … })`, at the line it is on. The Portal's calls below act on an intent that
already exists.

## Compile a program

```ts
import { routes } from "@eco-incorp/sauce";

export const program = routes.compileSauceProgram(
  "base",
  "function main(amount: Uint256) { USDC.approve(Uniswap.UniversalRouter, amount); }",
);
```

`compileSauceProgram(chain, source, options?)` compiles a standalone program, one a Pot cooks
directly, for `chain`: the chain's token symbols, `chainId` and protocol addresses, and the default
ambient token module. A `defines` or `tokens` entry under one of those chain-scoped names replaces
it. It returns the program's `bytecode`, its `entryEncoding` (and `entrySchema` with
`compactArgs`), `entryParams`, `main`'s runtime parameters, which `encodeEntryArguments(program,
values)` encodes and `decodeEntryArguments` reads back, the Solana `manifest`, and `source` after
the SDK's rewrites. `options.args` binds `main`'s arguments into the program as constants instead,
each one word.

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

`SauceCompileOptions` supports `resolve` and `resolvePackage` for the program's own imports, scalar `defines`, token-address `tokens`, ABI `contracts`, `ambient` module names, and `accessors`. `resolve` has the [compiler's resolver contract](compiler.md#resolver-contract) and is asked for any path the program imports; the SDK itself serves `@sauce/token`, `./artifacts/IERC20.json`, `./artifacts/ISauceRouter.json` and every `./protocols/<slug>/<Export>.json`, so source from the SDK's builders needs neither option. Accessor rewriting defaults on; an options object can configure qualified-chain scope or other rewrite behavior. Direct `compileSauceRoute` performs token/protocol rewrites but does not automatically merge the ambient module `compileSauceProgram` adds.

The route wrapper has no runtime argument-payload parameter. Use compile-time defines here, or `compileSauceProgram` and `encodeEntryArguments` for parameterized entry points; see [compiler integration](compiler.md).

## Already compiled programs

`buildSauceEvmCall({ pot, engine, program, value? })` builds one Pot `cook` call; `program` is a hex string. `value` defaults to zero and must include the Kitchen fee. `buildSauceEvmCalls({ pot, engine, cooks, value? })` applies that value to **each** ordered cook. Multiple statements within one program need only one cook and fee.

Both builders, and `sauceEvmDeployPotCall` below, return `{ to, target, data, value }`. `{ to, data, value }` is the request a wallet sends or `client.call` takes, the same shape as `destinationExecutionFee()` and the Portal transaction builders; `to` is the contract's checksummed 20-byte address. `target` names the same contract as a route's `calls` entry (the Portal's `Call` struct) records it, a 32-byte universal address for a cook, so the object goes into `RouteInput.calls` unchanged. `value` is a `bigint`.

## Deployment addresses

`sauceEvmDeployPotCall({ owner, salt, kitchen? })` encodes Pot deployment through a Kitchen, by default the released one (`v12KitchenAddress()`); for an intent's route the owner is the destination `Portal.executor()`. No route the SDK builds includes this call. To deploy an intent's shared Pot yourself before the solver does, pass that Executor and `SAUCE_INTENT_POT_SALT`.

Every address helper here returns a **recorded** address, never a verified one. `v12EngineAddress()` and `v12KitchenAddress()` give the released addresses, the same on every chain; the SDK reads no chain, so it cannot say whether code is there. Check the chain before trusting any of them; [evm-execution.ts](../examples/evm-execution.ts) shows prediction, deployment and the owner/Kitchen checks.

`buildSauceSvmCall` and the SVM route path emit an 8-byte engine instruction that the Solana engine does not accept, whatever code account or engine id you give them: they do not build the Kitchen call the engine requires. Build Solana execution with the Kitchen client instead — see [SVM destinations in Eco intents](../guides/solana.md#svm-destinations-in-eco-intents).

## The Portal's calls

The Portal helpers take an `Intent` — `assembleIntent(source, destination, route, reward)`, or
`intentFromPublished(log, sourceChainId)`, which rebuilds one from its `IntentPublished` log,
checking its hash — and build EVM requests, `{ to, data, value }`, with no RPC: you send them.

`intentSourceTxs(intent, { portal }, options)` funds and publishes an intent from a wallet, by
transfer by default: a `transfer` of each reward token to the intent's vault, a plain send of the
native amount, then `publish`. Pass `vault` as `intentVaultAddressCall` read it; it must equal
`predictIntentVault` or `IntentVaultMismatchError` is thrown. `fundVia: "publishAndFund"` returns
`approvalTxs` then `publishAndFundTx` instead. Underneath are `vaultTransferTxs`, `rewardVaultLegs`,
`predictIntentVault` and `assertIntentVault`; `ecoRoutesVaultConfig(portal)` is the vault
configuration behind the prediction. `publishTx`, `fundTx`, `intentHashCall` and
`isIntentFundedCall` are the single calls and reads.

The destination side is a solver's: `fulfillTx(intent, { claimant })` is
`Portal.fulfill(intentHash, route, rewardHash, claimant)`, sent to the Portal the route records with
`route.nativeAmount` as its value, and `fulfillApprovalTxs(intent)` the solver's approvals of that
Portal for the route's tokens, which it pulls from the solver first (one per token, the entries
summed). Both require an EVM destination. The route they carry is `evmRouteTuple(route)`, the value
`routeHash` is taken over, so the Portal's hash check agrees with `hashIntent`. [`sauce intent
fill`](../guides/cli.md#simulating-the-fill-sauce-intent-fill) simulates them on the destination
with no key, and with `--send` sends them.

After the fill, the same module builds the rest of an intent's life, each as a request you send: `fulfillAndProveTx(intent, { claimant, prover, sourceDomain, data, fee })` (the fill and its proof in one, `route.nativeAmount + fee` as its value) and `proveTx(intents, { prover, sourceDomain, data, fee })` on the destination, with `hyperlaneProverData({ sourceProver })` the Hyperlane prover's `data` and `proverFeeCall(...)` its fee; `withdrawTx`, `batchWithdrawTx` and `refundTx` on the source, taking `{ portal }`; `cancelTx` and `cancelAndProveTx` on a destination Portal that has `cancel`, after the route's deadline. The reads that decide them are `rewardStatusCall` (one of `REWARD_STATUSES`), `fulfillmentCall` (what the destination recorded: a claimant, `CANCELLED_CLAIMANT_BYTES32`, or zero), `provenIntentCall` (the source prover's claimant and destination) and `proofTypeCall`. [After the fill](../guides/cli.md#after-the-fill-prove-claim-refund-cancel) explains when each applies.

## Lower-level encoding

For callers building their own calls, `assembleIntent(source, destination, route, reward)` normalizes an intent without compiling a program. `encodeRoute`, `encodeReward`, `hashIntent`, and their explicit EVM/SVM variants expose encoding and hashing. `toUniversalAddress` normalizes addresses for the cross-chain intent model, while `denormalizeToEvm` converts an EVM-shaped universal address back to its 20-byte form. `splitByPlaceholders`, `renderTemplate` and `emitTemplate` cut an encoding at placeholder values and emit SauceScript that writes it with amounts known only on chain, against any encoding whose fields sit at fixed offsets.

Where eco-routes is deployed is a registry: `ecoRoutesPortal(chain)`, `ecoRoutesProver(source,
destination)`, `ecoRoutesDeployment(chain)` and `ecoRoutesGenerations()` from
`@eco-incorp/sauce/protocols/eco-routes`. Both generations ship — `v3`'s single Portal and `v2`'s
separate `IntentSource`/`Inbox` — in production and staging, vendored from
`@eco-foundation/routes-ts` at a pinned version and digest.
