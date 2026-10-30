# Kitchen compatibility for maintainers

**How-to guide** · [Documentation](../README.md) · [Upgrading](upgrading.md) · [Deployments](../reference/deployments.md)

> A Pot is the account that holds a service's funds and runs its programs. Treat its saved release
> binding like a key to an existing account, not a preference that follows the newest SDK.
> This guide separates creating a new account from continuing work on one already deployed.

For maintainers changing Kitchen, Pot, engine, compiler, Router or persisted SDK bindings.
Know the [execution model](../concepts/kitchen-pot-cook.md) and the
[exact compiler/engine pairing](../api/compiler.md#which-engine-runs-a-program) first.

## Choose the compatibility path

| Change                               | Required behavior                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use an already deployed Pot          | Load its explicit chain/Kitchen/Pot and release binding, verify it, and keep ordinary new work usable with its original engine/compiler and Router policy.                                           |
| Create a new EVM Pot                 | Use CREATE3 only through the existing factory ABI. Select the qualified release explicitly, then follow the creation order below.                                                                    |
| Change a service's release or Router | Require explicit service/owner opt-in. Defaults apply only to explicit new configuration, not saved bindings.                                                                                        |
| Deprecate or remove a supported path | Retain it until inventory proves all affected services and financial/authorization obligations are resolved, with operator acknowledgement and explicit removal approval. Elapsed time is not proof. |

Already deployed historical Pots retain their address, code, storage and bindings. Retention is not
limited to draining funds, retries or withdrawals: their ordinary new work must remain supported.
On EVM the cook/config/signature selects the engine; it is not an immutable engine field in the Pot.
An SDK update must preserve that persisted selection. Keep the exact compiler/WASM, engine code
identity, Router policy, program/wire and storage profiles and release provenance together.

For published CREATE3 pairs, independently pin both EVM components' Pot profile artifacts and
require matching canonical identity; formatting and asset digests may differ. Keep their
authenticated scheme/helper/profile/Router identity and raw release/ABI evidence with the exact
SDK/compiler/engine pair. Public npm transport must preserve each artifact's provenance.
A local candidate or generated file's presence is not release qualification.

Compiler provenance is retained in `deployments/releases.json` alongside release metadata.
For a newly qualified installed compiler, generate its measured WASM digest and exact public
known-answer program with `node sdk/scripts/gen-embedded-sources.mjs --record-compiler-probe`.
Review the artifact evidence and retain earlier descriptors unchanged across SDK updates.
Recording a descriptor is not release qualification. EVM ISA identity is the exact engine code
hash and Pot profile identity with retained wire metadata, not a new human-named revision.

A missing expected-deployed Pot, mismatched identity, unknown runtime profile or ambiguous release
provenance must fail before funding, approvals, signing or queuing. Never repair that failure by
creating current code, repinning an engine/compiler, replacing the address or incrementing the salt.

## Reauthorize an owner-selected Router change

For a dynamic Private Pot only, the owner may update its Router on chain. Then explicitly import
the updated binding before more funding or signing:

```sh
sauce pot import --pot <address> --pot-binding <updated-descriptor.json> \
  --chain <chain> --rpc-url <url> --pots <dir>
```

Change only `router` and `routerCodeHash` in that descriptor; retain the original `release.router`.
Explicit import appends an immutable `@router-N` history record. Normal funding/signing paths
refuse a stale Router binding rather than migrating it. Fixed/Shared Router changes and changes
to compiler, engine or profile are not this reauthorization path.

## Create a new Pot safely

1. Select the chain, Kitchen, owner, user salt, Pot kind and exact qualified release/artifact pair.
2. Predict with the SDK's CREATE3 derivation, then explicitly deploy through Kitchen.
3. Verify the actual deployed code, identity, Router policy and engine/compiler compatibility with
   `verifyPotBinding` from `@eco-incorp/sauce/evm/engine`, using trusted release artifacts.
4. Persist the verified binding and provenance.
5. Only then fund, grant allowances, sign or queue cooks for that service.

Prediction is arithmetic, not code authentication. Matching an on-chain prediction, finding nonempty
code or reading plausible getters does not establish a trusted Pot. If the factory profile changes
between planning and deployment, post-deployment verification must reject an incompatible result
before funds or authorizations follow it.

CREATE3 prediction no longer depends on Pot bytecode. Changing the qualified release does not change
the numerical target for the same Kitchen, owner, salt and kind, and cannot replace code already
there. An incompatible occupied target needs an explicit user-selected fresh salt. There is no
family/version selector, automatic salt fallback or historical undeployed construction lane.

The CLI accepts an explicit trusted descriptor with `--pot-binding <file>`.
For new creation use `sauce pot --deploy --pot-binding <file> --pots <dir>` with the service's
chain and owner. Then use the same persisted store for `run`, `tx` or `sign`; those paths require
an already deployed verified binding. Offline signing is refused. The descriptor's provenance is
a trust input, not something an address prediction supplies.

The RPC chain must match the binding's `chainId` before code authentication. `originalChainId` is a
trusted construction-chain pin; checking the signature domain establishes consistency with that pin,
not independent proof of which chain originally constructed the contract.

CREATE3 verification also simulates a fixed known-answer cook through the authenticated Pot and
selected engine. Only native balance for the fee is overridden; no code or protected storage is
overridden, and no transaction, signature or nonce change is persisted. The verified
`compatibilityProbe` retains its compiler, actual compiler-WASM SHA-256 and exact program bytes.
All three must match a trusted compiler-produced descriptor before any RPC; caller-supplied JSON
is not that provenance. Rechecks preserve the original descriptor across SDK updates.
Initial verification requires the matching installed compiler. Raw `eth_call` never follows
CCIP-read URLs. An RPC that cannot perform balance overrides cannot qualify the binding.

`potInitCodeHash` is historical/introspection data, not the CREATE3 authentication or build anchor.
The interpreter's CREATE3 builtin and stack deployment tooling are separate deployment namespaces.

## Gate the cutover and future releases

Before activation, require evidence for all of these gates:

- Inventory deployed bindings and direct factory callers, SDK/CLI versions, automation and offline
  clients. Include balances, allowances, signed/queued/in-flight/retry work, refunds and withdrawals.
- Reconcile CREATE2 predicted-but-undeployed accounts, prefunding and deployment dependencies.
  Resolve each exposure through separately authorized pre-cutover deployment/drain or a reviewed
  recovery disposition. Unknown balances are not zero; unresolved exposure blocks rollout.
- Communicate the breaking prediction/deployment semantics and exact supported SDK/compiler/engine
  artifacts. Update or stop stale new-Pot callers: retained selectors do not exclude stale clients.
- Qualify actual CREATE3 deployment and independent code/profile verification, SDK/on-chain
  prediction agreement, occupied targets and failure paths. Prove old deployed Pots still submit
  ordinary new work, including signatures, EVAL, fees and Router callbacks with their pinned pair.
- Prove shared Kitchen authorization, fees and storage survive the upgrade. Canary only explicit
  new-service opt-ins; qualify rollback that retains activated CREATE3 profiles and old execution.
  Rolling back code does not undo transfers, storage, nonces or signatures.
- Keep Solana Kitchen ELF, instructions, account ordering, PDA seeds and engine-owned Pot data
  unchanged for this EVM-only cutover. Any later SVM change needs separate compatibility evidence.

These are required gates, not claims that tests passed, live inventory is complete, migration is
safe, or deployment is authorized. A local fixture is not live-population proof. Compatibility also
does not remove shared Kitchen authority, fees, RPC trust or external-venue availability risks.
Keep private engine source, opcode/layout implementation and exploit details out of public docs.

## Next

- [Upgrading](upgrading.md): update a project without silently replacing its service bindings.
- [Production checklist](production-checklist.md): checks before funds or signatures move.
- [Changelog](../changelog.md): breaking changes and historical release pairs.
