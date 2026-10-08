# Routes API

[Documentation](../README.md) · [Create an intent](../guides/intents.md) · [Compiler](compiler.md)

`routes` is the namespace behind every chain accessor: the intent builder, the encoders and hashes,
and the Portal helpers. Import it from the package root, next to the chains you use:

```ts
import { Base, routes } from "@eco-incorp/sauce";

const destination = routes.chain("base");
```

There is no `/routes` subpath. The public types are members of the namespace: `routes.HostIntent`,
`routes.HopConfig`, and so on.

## Chain entry points

| Entry point                                                | Result                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `Base.hop({ source, send, receive, refundee }).then(body)` | The program that opens the intent, and its cook: [a hop](#a-hop) |
| `routes.chainHop(ref)`                                     | The same `hop` for a chain reference                             |
| `routes.chain(ref)`                                        | The chain accessor (`.chain`, `.hop`) for a chain reference      |
| `routes.chainAccessors.Base`                               | Explicit access to the bare chain accessor                       |

Chain references accept canonical slugs, names/aliases supported by the registry, numeric chain IDs, and canonical chain records. `.chain` exposes the canonical record.

`Base` and every other chain are **named exports of the package root**: a namespace, not a function; importing the package installs nothing on `globalThis`. A root-imported accessor is the composed one, which also exposes host contract and venue accessors (`Base.Uniswap.UniversalRouter`, `Solana.RaydiumCpSwap`), its eco-routes Portal contract as `Base.Portal`, and the chain's registry tokens (`Base.USDC`), described in the [contracts reference](contracts.md); `routes.chainAccessors.Base` is the bare accessor without them. A host that wants the bare names at run time can call `installRouteGlobals()`; `uninstallRouteGlobals()` reverses it, and neither installs TypeScript declarations.

`body` (a hop's `.then(body)`) accepts a synchronous zero-argument arrow function, or the statements of one as a string. A callback supplies source text, with no JavaScript capture. See [callback semantics](../guides/intents.md#callbacks-are-compiled-source).

## A hop

`Base.hop(config)` opens an intent whose body runs on Base: `config` is one object, each field at
most once, and `.then(body)` gives the body. The type (`routes.HopConfig`) flags a field it does not
know, and the builder refuses one at run time.

| Field            | Takes                                                              | Omitted                                                                    |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `source`         | The source chain, a reference or a chain export                    | Required                                                                   |
| `compile`        | The source compile's options                                       | None                                                                       |
| `send`           | One `{ token, amount }` or `{ native: amount }`, or a list of them | Required; it must offer something                                          |
| `receive`        | One `{ token, amount }`, or a list of them                         | Nothing delivered                                                          |
| `refundee`       | The refund address: who may reclaim an unearned reward             | Required                                                                   |
| `deadline`       | The route's deadline                                               | When the cook runs, plus `routes.DEFAULT_FILL_WINDOW`                      |
| `rewardDeadline` | The reward's deadline                                              | The route's deadline plus `routes.DEFAULT_REFUND_WINDOW`                   |
| `prover`         | The reward's prover                                                | `ecoRoutesProver(source, destination)`                                     |
| `salt`           | The route's salt                                                   | 32 random bytes per compile, mixed with the transaction's count of intents |
| `fee`            | The destination Kitchen's fee the body's cook pays                 | `intents.executionFee` in `compile`; else refused                          |

`.then(body)` returns the `routes.HostIntent`. [Intent defaults](../reference/intent-defaults.md)
gives each default's reason. `.then(body)` writes the statement a program opens the intent with,
`routes.HostIntent.source`, and compiles it for the source chain with `compile`
(`SauceProgramOptions`: `defines` the body reads, `intents` defaults such as `executionFee`,
`sourcePortal` and `destinationPortal`, `tokens`). The intent is `@sauce/intents`' class, the one
every program's intents are, so the program is the same one the statement compiles to in a file.

| Member                | Behavior                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `source`              | The statement that opens the intent, as SauceScript                                                             |
| `program`             | It compiled for the source chain (`compileSauceProgram`): `bytecode`, and each body in `bodies`                 |
| `cook(target, value)` | `Pot.cook(engine, program)` on `target` — a Pot, or `{ owner, salt? }` — with `value` the source Kitchen's fee  |
| `intents(logs)`       | Each intent the source chain's Portal published in `logs`, a receipt's or a rehearsal's: `routes.loggedIntents` |

The cook is sent by the Pot's owner. The Pot pays each reward into its intent's vault (or approves
the Portal and calls `publishAndFund`, `intents.fundVia`) and publishes it, so it must hold the
reward when the cook runs, and must be deployed (`sauceEvmDeployPotCall`). There is no offline
hash: the default deadlines count from when the cook runs and the salt is picked per compile, so
the intent's hash is the one the Portal announces, read from its `IntentPublished` with
`intents(logs)` once the cook is sent or rehearsed (`eth_simulateV1`). An intent the body opens
names its own refundee, and takes its own default deadlines, from when it opens. `HOP_FIELDS` and
`HOP_STAGES` (`routes/intent-syntax.ts`) are the syntax as data — each field, what it takes and the
option it overrides, and the steps after it — which the declarations a typed closure checks against
are generated from.

On an EVM destination the body's Pot and engine are derived: the Pot owned by the `executor()` of
the destination Portal, under salt zero (`SAUCE_INTENT_POT_SALT`) — the one Pot per Portal the
solver deploys — and the released engine. The route does not deploy it: the Pot must exist before
fulfilment, and the solver deploys it. `destinationPot(chain, { portal?, ecoRoutes? })` returns the
derived address, and `intents.pot` and `intents.engine` override them. The route moves each
delivered token from the Executor into that Pot, then cooks the body there with the fee as
`route.nativeAmount`. See [the destination Pot](../guides/intents.md#the-destination-pot).

`then` is the intent's, not a promise's: awaiting a pending intent, or returning one from an async
function, calls `then(resolve, reject)`, which is refused with a message.

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
| `source`   | The program as the compiler was given it                              |

The route compile differs from the direct `/compiler` API, which returns one byte array plus compiler metadata and an optional SVM account manifest. Use the direct API when you need that metadata. The route target defaults to `"v12"` for EVM and `"svm"` for SVM; direct compiler targets are `"evm"` and `"svm"`.

`SauceCompileOptions` supports `resolve` and `resolvePackage` for the program's own imports, scalar `defines`, token-address `tokens`, ABI `contracts`, `ambient` module names, and `accessors`. `resolve` has the [compiler's resolver contract](compiler.md#resolver-contract) and is asked for any path the program imports; the SDK itself serves `@sauce/token`, `./artifacts/IERC20.json`, `./artifacts/ISauceRouter.json` and every `./protocols/<slug>/<Export>.json`, so source from the SDK's builders needs neither option. Every compile hands the compiler the chain's names as a module — its token symbols, `chainId`, protocol contracts and chains, and each chain an intent's body runs on, its own — and `compileSauceProgram` adds the default ambient token module too. A `defines` or `tokens` entry under one of those chain-scoped names belongs to the chain the program compiles for: an intent's body on another chain uses that chain's value instead ([names resolve per chain](../guides/intents.md#names-resolve-per-chain)).

The route compile has no runtime argument-payload parameter. Use compile-time defines here, or direct compilation and a suitable execution API for parameterized entry points; see [compiler integration](compiler.md).

## Already compiled programs

`buildSauceEvmCall({ pot, engine, program, value? })` builds one Pot `cook` call; `program` is a hex string. `value` defaults to zero and must include the Kitchen fee. `buildSauceEvmCalls({ pot, engine, cooks, value? })` applies that value to **each** ordered cook. Multiple statements within one program need only one cook and fee.

Both builders, and `sauceEvmDeployPotCall` below, return `{ to, target, data, value }`. `{ to, data, value }` is the request a wallet sends or `client.call` takes, the same shape as `destinationExecutionFee()` and the Portal transaction builders; `to` is the contract's checksummed 20-byte address. `target` names the same contract as a route's `calls` entry (the Portal's `Call` struct) records it, a 32-byte universal address for a cook, so the object goes into `RouteInput.calls` unchanged. `value` is a `bigint`.

## Deployment addresses

`sauceEvmDeployPotCall({ owner, salt, kitchen? })` encodes Pot deployment through a Kitchen, by default the released one (`v12KitchenAddress()`); for a direct intent route the owner is the destination `Portal.executor()`. No route the SDK builds includes this call. To deploy an intent's shared Pot yourself before the solver does, pass that Executor and `SAUCE_INTENT_POT_SALT`.

Every address helper here returns a **recorded** address, never a verified one. `v12EngineAddress()` and `v12KitchenAddress()` give the released addresses, the same on every chain; the SDK reads no chain, so it cannot say whether code is there. Check the chain before trusting any of them; [evm-execution.ts](../examples/evm-execution.ts) shows prediction, deployment and the owner/Kitchen checks.

`buildSauceSvmCall` and the SVM route path emit an 8-byte engine instruction that the Solana engine does not accept, whatever code account or engine id you give them: they do not build the Kitchen call the engine requires. Build Solana execution with the Kitchen client instead — see [SVM destinations in Eco intents](../guides/solana.md#svm-destinations-in-eco-intents).

## Portal helpers

Every helper below takes an `Intent` — a published one, from `intents(logs)` or
`intentFromPublished(log, sourceChainId)`, or one built some other way (`assembleIntent`) — builds
an EVM request you send, and performs no RPC. Submission and read helpers take an optional
`{ portal }` override; without one they use the eco-routes Portal for the intent's chain. The codec
represents an SVM destination fine; building that execution is the separate matter above.

`intentSourceTxs(intent, { portal }, options)` funds and publishes an intent from a wallet: by
default a `transfer` of each reward token to the intent's vault, a plain send of the native amount,
then `publish`; `fundVia: "publishAndFund"` returns the approvals, then `publishAndFund`. Pass
`vault` as `intentVaultAddressCall` read it; it must equal `predictIntentVault(intent)` or
`IntentVaultMismatchError` is thrown. Underneath are `vaultTransferTxs`, `rewardVaultLegs`,
`predictIntentVault` and `assertIntentVault`; `ecoRoutesVaultConfig(portal)` is the vault
configuration behind the prediction. [Intents](../guides/intents.md#publish-it-the-cook) covers
the order and the checks.

The destination side is a solver's: `fulfillTx(intent, { claimant })` is
`Portal.fulfill(intentHash, route, rewardHash, claimant)`, sent to the Portal the route records with
`route.nativeAmount` as its value, and `fulfillApprovalTxs(intent)` the solver's approvals of that
Portal for the route's tokens, which it pulls from the solver first (one per token, the entries
summed). Both require an EVM destination. The route they carry is `evmRouteTuple(route)`, the value
`routeHash` is taken over, so the Portal's hash check agrees with `hashIntent`.
[`sauce intent fill`](../guides/cli.md#rehearsing-the-fill-sauce-intent-fill) rehearses them on the
destination with no key, and with `--send` sends them.

After the fill, the same module builds the rest of an intent's life, each as a request you send: `fulfillAndProveTx(intent, { claimant, prover, sourceDomain, data, fee })` (the fill and its proof in one, `route.nativeAmount + fee` as its value) and `proveTx(intents, { prover, sourceDomain, data, fee })` on the destination, with `hyperlaneProverData({ sourceProver })` the Hyperlane prover's `data` and `proverFeeCall(...)` its fee; `withdrawTx`, `batchWithdrawTx` and `refundTx` on the source, taking `{ portal }`; `cancelTx` and `cancelAndProveTx` on a destination Portal that has `cancel`, after the route's deadline. The reads that decide them are `rewardStatusCall` (one of `REWARD_STATUSES`), `fulfillmentCall` (what the destination recorded: a claimant, `CANCELLED_CLAIMANT_BYTES32`, or zero), `provenIntentCall` (the source prover's claimant and destination) and `proofTypeCall`. [After the fill](../guides/intents.md#after-the-fill-prove-claim-refund-cancel) explains when each applies.

## Nested intents

A nested intent is written in the program: `await Chain.hop({ … })`, or
`Chain.hop({ … }).then(() => { ... })`, in a body opens an intent when that body runs, at any depth.
In a typed closure the chain is the imported export, whose `hop` takes SauceScript values beside the
host's (`SauceHopConfig`) — see [nested intents](../guides/nested-intents.md) and
[create an intent](../guides/intents.md#create-an-intent-from-inside-a-program). Its fields set
each intent's own values. `SauceCompileOptions.intents` carries what that lowering cannot look up
(the fee of a program body's cook: one `bigint`, or a function from the destination chain to its
fee) and what overrides it: `deadline`, `rewardDeadline`, `openedAt` (when the first level opens,
which its default deadlines count from), `sourcePortal`, `destinationPortal`, `prover`, `salt`,
`fundVia`, `allowPartial`, and the eco-routes `generation`/`environment`. They apply to every
intent the program opens that does not set its own, at every depth, but for `openedAt`: an intent a
body opens opens when that body runs. `fund: false` publishes each top-level intent without paying
its reward, for a rehearsal that reads the intents from the Portal's log: the intents are the same,
and no level below takes it. The refundee is never among them: every hop names its own `refundee`,
since the Pot it is published from may be shared. `fundVia` and the eco-routes selection are
inherited from the enclosing intent.

`compileSauceProgram(chain, source, options).bodies` lists the program each intent's body compiles
to (`CompiledBody`: its destination, its bytecode, and the values the enclosing program gives it as
it runs, `captures`). The intents themselves are `@sauce/intents`' classes, which the compiler runs:
each is built while the file compiles and encoded as the program runs, so it is published by a cook
and read from the Portal's `IntentPublished` in its receipt or rehearsal
(`intentFromPublished(log, sourceChainId)`), as `sauce intent publish` reads it.

`options.args` compiles the program for `main`'s arguments: one word each (an unsigned integer, an
address or a `bool`), in the order of `entryParams`, where a Solana `Account` parameter takes none
and stays the manifest's. `main` reads each as a constant, so it takes none as it runs
(`entryParams` is empty), and each body folds them in, capturing nothing for them.

## Lower-level encoding

For callers building their own calls, `assembleIntent(source, destination, route, reward)` normalizes an intent without compiling a program. `encodeRoute`, `encodeReward`, `hashIntent`, and their explicit EVM/SVM variants expose encoding and hashing. `toUniversalAddress` normalizes addresses for the cross-chain intent model, while `denormalizeToEvm` converts an EVM-shaped universal address back to its 20-byte form.

Where eco-routes is deployed is a registry: `ecoRoutesPortal(chain)`, `ecoRoutesProver(source,
destination)`, `ecoRoutesDeployment(chain)` and `ecoRoutesGenerations()` from
`@eco-incorp/sauce/protocols/eco-routes`. Both generations ship — `v3`'s single Portal and `v2`'s
separate `IntentSource`/`Inbox` — in production and staging, vendored from
`@eco-foundation/routes-ts` at a pinned version and digest.
