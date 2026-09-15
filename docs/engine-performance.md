# EcoSwap performance package

This release candidate packages compiler `2.2.0-rc.3` with ISA `stack-compact-v2` from
[UNPACK #461](https://github.com/eco-incorp/v12/pull/461), stacked on [SET_ELEMENT #458](https://github.com/eco-incorp/v12/pull/458). `engine-performance.json`
pins the source commit, tools and SHA-256 of each input. It retains the migration's
compiler and SVM fixes. The engine source includes merged #459; the released kitchen artifacts from SDK main are retained and separately identified below.

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

`SET_ELEMENT` (0x9b) and `UNPACK` (0x9c) require the paired engine. The EVM settlement
verification pin is 362 code bytes, hash
`0x2da5c63da0ed3e934f4bb09985a38723de1f2a8e9a9a97ef3993e526cb649d11`.
SVM settlement programs remain specialized by their complete define set.
Code hashes, composed code-plus-argument hashes and staging identities must be
computed from the exact bytes returned to the client.

Separate SVM artifacts are built for devnet and mainnet, with matching wire metadata.
`sync-engine-artifacts.mjs --fetch-v12-engines --cluster=mainnet` selects the
mainnet paths explicitly; the legacy local `artifacts/svm/engine.so` filename
always contains the devnet build. CI executes both binaries and checks their
actual chain IDs alongside compact decoding and checked mutation.

SDK `0.14.0-rc.4` is a registry-compatible prerelease version of the combined
`@eco-incorp/sauce` package. The compiler is bundled, so a consumer does not need
a second compiler install. `node sdk/scripts/check-packed-package.mjs` installs
the tarball into a fresh temporary consumer and tests the public compiler/codec
exports plus every manifest digest. It also runs in CI and the publish gate.
The older published `@eco-incorp/sauce-sdk` line does not provide this interface;
consumers keeping that import name can use an npm alias after publication.

The kitchen-svm 0.3.0 ELF supports 1 MiB code buffers and uses program ID
`SauceYLdWyabKFwtevSAgsSDoMjCoTKtx1HTb63eJot`. Its release IDL is included unchanged.
EVM ABIs and deployment bytecode come from kitchen-evm 0.4.0, including the UUPS
Kitchen surface. Both release assets are verified against the digests committed
by SDK main. Compact CALLDATA still copies into the engine's 65,535-byte heap;
the staging bound does not make larger compact payloads executable.

Before any separately authorized rollout: attest deployed engine/kitchen IDs,
ELF/runtime hashes, helper availability, authority/ownership and capacity; build
and validate cluster-specific artifacts; publish the compatible SDK and compiler
together; invalidate program/response caches; and verify actual HTTP settlement
on the intended environment. Local Anvil/LiteSVM results do not establish live
program compatibility. This work does not deploy or merge anything.

## Historical measurements

The following figures were measured for RC1 before the opcode split. They are not RC4 acceptance results.

The integrated consumer evidence lives in sauce-recipes PR #1129 under
`docs/engine-performance`. Preliminary frozen-fixture receipt gas falls from
8,771,370 to 4,001,642, with identical realized output. Payload falls from 56,347
to 22,120 bytes; the old 17,404-byte payload target remains unmet. Use the final
consumer evidence and its exact source/artifact pins for acceptance.

## Opcode split validation

RC3 packages SET_ELEMENT `0x9B` from engine #458 and UNPACK `0x9C` from #461.
The 3,158 SDK tests pass across the full SDK run and the kitchen/wire follow-up,
including actual EVM execution and both packaged Solana clusters. Build,
TypeScript checks, ESLint, formatting and clean package installation also pass.
The canonical settlement program was recompiled to 362 bytes and its hash was
updated from those bytes. RC4 supersedes that manifest.

RC3 incorporates SDK main through #198 and the measured SBF inlining cleanup.
Only `find_pda` keeps a non-inlining boundary to prevent an oversized interpreter
frame. The compiler and both SBF binaries are rebuilt from the exact engine head.

## SVM compute correction in RC4

RC4 uses constant entry-spill addresses on SVM. Compared with RC3's runtime-relative
addresses, the four-rung Solfi fixture fits at 1,296,579 CU (RC3 exceeded 1.4M),
and the two-market native Manifest fixture falls from 931,428 to 845,465 CU.
All 80 interpreted calibration cells pass with the existing budget model.
Constant addresses increase program bytes; the engine's
`docs/svm-spill-addressing.md` records both dimensions and the raw A/B results.
Called frames still use a runtime base. EVM output and both SBF binaries are
byte-identical to RC3; only compiler code generation changes in this package.
