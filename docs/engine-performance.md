# EcoSwap performance package

This draft package pairs compiler `0.7.0+perf.1` with ISA `stack-compact-v1` from
[v12 #458](https://github.com/eco-incorp/v12/pull/458). `engine-performance.json`
pins the source commit, tools and SHA-256 of each input. It retains the migration's
compiler and SVM fixes. It does not include upstream PRs #456 or #457.

## Build and verify

Use Node 24.14.1 and pnpm 10.28.2. From a clean checkout of this SDK commit:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm --filter './sdk' typecheck:test
npm pack --pack-destination /absolute/output/directory
```

`sdk/scripts/sync-engine-artifacts.mjs` verifies all committed inputs before
copying them into build output. Rebuild the engine from the exact `engineCommit`
with its `scripts/build-ecoswap-performance.sh`; the script uses a fresh source
archive and fresh SBF target directory. The compiler tarball and SVM ELF are
committed here so consumers do not need a sibling engine checkout. Existing
third-party venue fixtures are reused, not fetched by these builds.

## Wire contract

Pass `compactArgs: true` to the compiler, check `isaRevision`, and encode the
returned `entrySchema` with `encodeCompactArguments`. Append those bytes to the
returned program. Tuple values are positional. Schema and program depend on
source, types and defines; request values stay in the argument suffix. Cache
identities must include the compiler/runtime fingerprint and every compile-time
dependency. `decodeCompactArguments` strictly validates canonical encoding and
bounds its decoded object graph to 1,000,000 values by default (`maxValues` is an
explicit inspection limit). Engines separately meter execution and bound heaps.

The current engine also supports `abi-v1` entry programs. External contract calls
always use standard ABI. This is one current ISA, with no retired-engine path.
See the engine's `docs/compact-arguments.md` for byte-level vectors and limits.

## Compatibility and rollout requirements

`UNPACK` (0x9b) and `SLOT` (0x9c) require the paired engine. The EVM settlement
verification pin is 350 code bytes, hash
`0xfdc0083dd5d41fd40a60804e1fe00645639cb9949a1bcd416205761cec448cbd`.
SVM settlement programs remain specialized by their complete define set.
Code hashes, composed code-plus-argument hashes and staging identities must be
computed from the exact bytes returned to the client.

The SVM artifact is built for devnet. The preserved 65,535-byte kitchen ELF uses
program ID `D1ziogwKXoR5ssTxmmaJvx2RFe5zRhfSVUYF4YycpU3u`; its IDL address is derived
from that pinned source. Do not substitute a release IDL with another address.

Before any separately authorized rollout: attest deployed engine/kitchen IDs,
ELF/runtime hashes, helper availability, authority/ownership and capacity; build
and validate cluster-specific artifacts; publish the compatible SDK and compiler
together; invalidate program/response caches; and verify actual HTTP settlement
on the intended environment. Local Anvil/LiteSVM results do not establish live
program compatibility. This work does not deploy or merge anything.

## Measurements

The integrated consumer evidence lives in sauce-recipes PR #1129 under
`docs/engine-performance`. Preliminary frozen-fixture receipt gas falls from
8,771,370 to 4,001,642, with identical realized output. Payload falls from 56,347
to 22,120 bytes; the old 17,404-byte payload target remains unmet. Use the final
consumer evidence and its exact source/artifact pins for acceptance.
