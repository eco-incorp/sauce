# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Sauce** — the developer-facing package for the **Sauce protocol**, an on-chain bytecode runtime
that executes Turing-complete, atomic scripts in a single EVM transaction. This is the whole `sauce`
repo (`eco-incorp/sauce`, **renamed from `eco-incorp/sauce-sdk`** — the old name still redirects). The
runtime **engine** it *targets* lives in the separate private **`eco-incorp/v12`** repo (**renamed
from `eco-incorp/sauce`**; the engine, not this package, is what took the `v12` name — often checked
out at `../v12`).

A **pnpm monorepo** of three workspace packages (`pnpm-workspace.yaml`: `dev-tools`, `sdk`,
`actions`), all `private: true`, bundled and published as a **single npm package
`@eco-incorp/sauce-sdk`** via subpath exports — only the root `package.json` publishes. This
bundling is the key mental model: code lives in three packages for development, consumers import
everything from one name.

| Workspace | Internal name | Published as | Role |
| --- | --- | --- | --- |
| `sdk/` | `@eco-incorp/sauce-sdk-source` | `.` and most subpaths (`/compiler`, `/protocols/*`, `/chains`, `/recipes`, `/skills`, `/svm*`, `/evm/engine`, `/verify`, `/deployments`) | 129-protocol registry, chains, recipes, SVM/EVM engine clients, AI skill files |
| `actions/` | `@eco-incorp/sauce-actions` | `/actions` | Routing-intent → bytecode lowering |
| `dev-tools/` | `@eco-incorp/sauce-dev-tools` | bin `sauce-dev-tools` | Local/forked hardhat env + recipe runner |

This repo was **extracted from the engine repo** (now `eco-incorp/v12`, checked out at `../v12`),
which may still carry older copies of these packages. The packages here are **siblings, not
generations**: `dev-tools` is a dev harness, not a legacy `sdk`.

## Build, test, lint

Run from the repo root. **There is no build ordering to respect** — `build` is
`pnpm -r --filter './sdk' --filter './actions' build`, and neither depends on the other's `dist/`.
The compiler is an ordinary npm dependency, already built; nothing in this repo builds it.

```sh
pnpm install
pnpm build          # sdk + actions
pnpm typecheck      # all workspaces
pnpm test           # all workspaces
```

Per-workspace (`--filter`):

```sh
pnpm --filter './sdk' test               # compiles every protocol's SauceScript fn (~2,860 tests)
pnpm --filter './actions' test:unit      # fork-free subset CI runs
```

Single test file: jest (sdk) → `pnpm --filter './sdk' test -- routes-void-main.test.ts`.
Actions and dev-tools use the **node test runner**, not jest → `pnpm --filter './actions' exec tsx
--test tests/megas-swap.unit.test.ts`.

## Toolchain gotchas (why a fresh clone may fail)

- **Private engine git dep.** The ROOT `package.json` devDepends on the engine from
  `github:eco-incorp/v12#<sha>` (private) — **the dependency KEY stays `sauce`** (so it installs to
  `node_modules/sauce` and `sync-engine-artifacts.mjs` still finds it), but the URL points at the
  **renamed engine repo `eco-incorp/v12`** (it was `eco-incorp/sauce` before the SDK took that name —
  a repin to the old URL now resolves to THIS repo and fails, since the pinned SHA lives on `v12`). It
  is no longer the compiler's dependency — the compiler comes from npm — it is where
  `sdk/scripts/sync-engine-artifacts.mjs` gets the Solidity engine sources and the deploy record.
  Cloning needs GitHub auth — locally `gh auth setup-git` or an `~/.npmrc` token; CI uses the
  `ECO_INCORP_TOKEN` secret via a `git config insteadOf` rewrite (`.github/workflows/ci.yml` rewrites
  the HTTPS *and* SSH forms, because the lockfile may pin either).
- **Foundry is still required**, for two reasons that have nothing to do with the deleted compiler:
  (1) `forge` for `pnpm --filter './sdk' sync-engine-artifacts`, which `forge build`s the `sauce`
  dep's `engine/src` to produce the 8 artifact JSONs — the script also git-fetches the OpenZeppelin
  sources the dep arrives without, since pnpm doesn't recurse submodules (this work used to live in
  the compiler's `postinstall`; it is now `sync-engine-artifacts.mjs` itself); and (2) `anvil` on
  `PATH` for `sdk/test/std/token/evm.e2e.test.ts`, which spawns it directly. CI additionally uses
  `anvil` + `cast` to derive the deployed v12 runtime bytecode. **A tree where that sync has not run
  is not green**: on a fresh install with no `sdk/{src,dist}/artifacts/`, 56 tests that import
  `./artifacts/*.json` fail (measured; the rest pass). The sdk `build` script sets
  `SYNC_OPTIONAL_FORGE=1` so a Foundry-less build warns rather than failing — which means a missing
  `forge` surfaces later, as those test failures, not as a build error.
- **`FORK_URL`** — actions `test`/`test:megas-swap` and dev-tools fork flows hit a hardhat mainnet
  fork (loaded from `.env`). `test:unit` is the fork-free subset.
- **`SAUCE_ENGINE_SO`** — path to the Solana engine binary (`engine.so`, built with
  `cargo build-sbf` in the engine (`v12`) repo's `svm/`). The SVM integration suites (`sdk/test/svm/*.test.ts`)
  run compiled `target: 'svm'` bytecode on it via LiteSVM. The binary is **vendored** at
  `artifacts/svm/engine.so` (committed, force-added — `artifacts/` is gitignored; it is the
  only force-added path left, since no `dist/` is tracked) and that's the default both
  locally and in CI, so these suites run **offline by default**, same as the EVM ones; the
  suites **skip cleanly** only if that binary is somehow missing. Set `SAUCE_ENGINE_SO` to
  override — e.g. to test a freshly built engine before repinning the `sauce` dep. **Refresh
  the vendored binary whenever the `sauce` dep is repinned**: `cargo build-sbf` in the pinned
  commit's `svm/` checkout, copy `target/deploy/engine.so` over `artifacts/svm/engine.so`,
  force-commit — nothing re-derives this automatically, so a repin without a refresh silently
  tests against a stale engine again. The `'svm'` compile target, its account-plan output,
  and the `/svm` SDK subpath are documented in `docs/plans/2026-07-03-solana-svm-support.md`.
- **`SAUCE_RUST_ENGINE_SO` / `SAUCE_RUST_V12_RUNTIME`** — the two engines every suite that EXECUTES
  compiled bytecode needs, and **deliberately separate variables** from `SAUCE_ENGINE_SO` above.
  The SDK compiles through the published compiler (`@eco-incorp/sauce-compiler` from the public npm
  registry, aliased to the short name `sauce-compiler` in every `package.json` — a naming choice, not
  a workaround; nothing is built locally and no Rust toolchain is needed), which emits for the sauce
  `main` engine lineage. `SAUCE_ENGINE_SO`'s vendored `artifacts/svm/engine.so` is built from the pinned
  `release/beta` lineage, so it can only serve suites that do NOT run freshly compiled bytecode
  (instruction builders, PDA derivation, decoders). Anything that does run it gates on
  `describeRustSvm`/`SAUCE_RUST_ENGINE_SO` instead, which hard-fails in CI rather than skipping.
  **The two wire formats have diverged, measured in both directions**: on the SVM, `JUMP`/`JUMP_I`
  (0xB0/0xB1) exist only on `main` and `NEW_ARRAY` (0x92) encodes its scalar elements differently, so
  Rust-compiled bytecode carrying any `require`/`if` is rejected by the vendored `engine.so` with
  `InvalidInstructionData`; on the EVM, `0xB0–0xB5` are `IF/IF_2/JUMP/JUMP_2/JUMP_BACK/JUMP_BACK_2`
  on the pin but `JUMP/JUMP_I` on `main`, and `0x88–0x8A` (`MLOAD`/`MSTORE`/`MALLOC` — every
  value-returning program's epilogue) are `do_unknown` on the pin, so a Rust-compiled `balanceOf`
  either returns empty or dies with `MemoryOOG` on the `V12RuntimeBytecode` this repo generates.
  Pointing `SAUCE_ENGINE_SO` itself at a `main` engine is therefore **not** a workaround — it breaks
  the suites that exercise the SDK's staged-execution instruction builders, which encode the pinned
  engine's layout. **Staged execution is a known gap**: those builders and `main`-lineage bytecode
  cannot both be satisfied today, so `svm-settle.e2e` runs its programs INLINE and the staged-path
  e2e is gone. Restoring it needs the v12-svm v0.4.0 instruction layout; it is unrelated to which
  compiler the SDK uses. Engine-gated suites skip when their variable is unset LOCALLY, so the
  default `pnpm test` needs no engines (it does still need the synced artifacts — see the Foundry
  gotcha above) — but in CI
  an unset variable is a hard failure, and CI supplies both from the `v12-svm-v0.4.0` and
  `v12-evm-v0.3.0` release artifacts, which are built from the same sauce commit the published
  compiler's `compiler-v0.5.0` tag is cut from. (They cannot come from the `sauce` git dep:
  `release/beta` is the wrong lineage, and sauce `main` deleted the `engine/` tree
  `sync-engine-artifacts.mjs` reads.)
  `pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines` fetches both from those releases,
  digest-verified against values pinned in the script, so no Huff toolchain and no local sauce
  checkout is needed. Building by hand is only for an **unreleased** engine: the `.so` is
  `cd <v12>/v12-svm && make build`, and the EVM runtime cannot come from `hnc -r` at all —
  `Runtime.huff`'s CONSTRUCTOR returns its own bytecode, so the deployed code is only known once
  deployed; deploy the creation code to an anvil and read it back with `cast code`. (The EVM suite
  needs `anvil` on `PATH` either way.)
- **EVM engine artifacts** (`sdk/{src,dist}/artifacts/` — `Router`, `SauceRouter`,
  `ISauceRouter`, `V12Pot`, `V12Kitchen`, `V12RuntimeBytecode`, `IERC20`, `IUniswapV3Pool`,
  `IStateView`) ship to downstream SDK consumers, which read them for local tests/deploys, so
  they must track the pinned `sauce` engine. **Nothing is tracked** — `artifacts/` is gitignored,
  as is every `dist/` — so they exist only where a build has run, and `tsc` does not emit them:
  **after any repin run `pnpm --filter './sdk' sync-engine-artifacts`** (copies the 8 forge
  artifacts from the pinned dep's `engine/out/`). CI runs that same sync from the
  freshly-installed engine (foundry v1.5.1 + solc 0.8.27 → byte-reproducible) and asserts all 9
  JSONs landed, so a broken generation fails there rather than shipping an empty dir. The one
  thing it drift-checks against the index is `sdk/src/deployments`, which *is* committed.
- **`V12RuntimeBytecode.json` comes from a pinned release asset, not from the `sauce` git dep.**
  The engine deleted its committed `engine-v12/snapshots/` copy (`chore(v12): compile the runtime
  at deploy time`) because a second source of truth rotted — six changed `.huff` handlers once
  shipped with a snapshot built from pre-change source, through green CI.
  `sync-engine-artifacts.mjs:279` now wraps `v12-evm-v0.3.0`'s `runtime.creation.hex` in the JSON
  shape consumers already read. No Huff toolchain is involved in producing it.
- **A tag is not a pin.** A GitHub tag is movable, so each asset is checked against a digest
  committed in the script itself (`keccak256` of the *decoded* creation code; `sha256` of the
  `.so`), cross-checked against the release manifest's `creationCodeKeccak`/`soSha256`, **and**
  against `manifest.commit`. A moved tag throws rather than silently supplying a different engine.
  Assets cache under `node_modules/.cache/sauce-engine-releases/<tag>/`, so a warm tree needs no
  network, and a corrupt cache is caught by re-hashing and refetched.
- **`hnc` (the Huff compiler) is no longer needed.** The suites that compiled `v12/Runtime.huff`
  themselves lived in the deleted `compiler/` workspace, and nothing in CI installs a Huff
  toolchain. The one surviving caller is `dev-tools/test/e2e.test.ts`, which shells out to
  `hnc -b engine-v12/v12/V12Compiler.huff` — that is `test:e2e`, which neither `pnpm test` nor CI
  runs.

## Architecture

**SauceScript** is compiled by the published Rust/wasm compiler `@eco-incorp/sauce-compiler`,
aliased to the short name `sauce-compiler` in every `package.json`. **There is no in-repo
compiler**: the `compiler/` workspace was deleted, and `sdk/src/compiler.ts` re-exports the
published one as the `./compiler` subpath (through `createRequire`, because the package's `node`
condition is a CommonJS build that reads its sibling `.wasm` off disk).

The whole surface is one function — source text in, bytecode out, no opcode-level builder, no
`Saucer`/`CompilerContext`/`OPS`:

```ts
compile(options: CompileOptions): CompileResult
```

`target` (`'evm' | 'svm'`) and `resolve` are required; `entry` (default `"main.js"`),
`resolvePackage`, `contracts`, `inlineContracts`, `ambient`, `defines` and `optimize` (default
`true`) are optional. `CompileResult` is `{ bytecode: Uint8Array; manifest?: AccountManifest }` —
`manifest` is the SVM account contract, `undefined` on the EVM. There is no `argsLayout` and no
`staged`/`args` option; the SDK owns the staged-args layout type itself (`sdk/src/svm/layout.ts`).
A compile or resolve failure **throws a JS `Error`** carrying the same rustc-style diagnostic the
CLI prints, never a WASM trap.

**The authoritative description of that surface is the package's own typings**
(`node_modules/sauce-compiler/node/sauce_wasm.d.ts`), which document each option in detail —
`ambient` precedence, `defines` precedence and their program-wide scope, the resolver contract
(returning `undefined` means "nothing here" and falls back; a throw propagates). Read them rather
than a paraphrase. Compiler *behavior* — language features, constant folding, per-target lowering —
is documented in the `sauce` repo's `compiler/README.md` and crate doc-comments, not here.

**Do not resurrect this file's old compiler notes.** ~1,470 lines here documented the deleted
TypeScript compiler's internals: its `before`-transformer pipeline, the `ts-frontend`/`processor/`/
`saucer/` modules, and the descriptor-kind bug family found in each. Every compiler source file they
cited — `processor/*.ts`, `saucer/*.ts`, `inference.ts`, `src/cache.ts`, `src/processor/inline.ts`,
and all their `test/`/`integration-test/` files — is gone. They also recorded measurements taken on the
`release/beta` engine lineage, which is **not** the lineage this repo now runs (see
`SAUCE_RUST_ENGINE_SO` above for the measured opcode divergence), so restating them would trade a
stale claim for a wrong one. They survive as history in `docs/compiler-feature-inventory.md`
(self-labelled "TS implementation") and `docs/compiler-rs-vs-ts-delta.md` (self-labelled a stale
point-in-time snapshot) — historical records, not descriptions of this repo today.

**`sdk/`** — a data registry, no runtime logic. `src/protocols/<slug>/` per protocol (`info`,
`addresses`, `abis` as-const, `functions` SauceScript templates); `src/protocols/index.ts` is the
query registry. `src/skills/*.md` are AI-ready per-protocol docs (loaded by `loader.ts`, shipped in
the package). `src/chains/`, `src/recipes/`, `src/core/types.ts`. **SDK tests compile every protocol's
`sauceFunctions` through the real compiler**, which is the installed npm package — there is nothing
to build first, but the suites that import `./artifacts/*.json` need `sync-engine-artifacts` to have
run (see the Foundry gotcha above).

`src/std/` is the SauceScript **standard library** — source shipped for the compiler to consume, not
TypeScript. `src/std/token/` is `@sauce/token` (an ERC20/SPL token interface behind one import), a
**byte-identical copy** of the engine (`v12`) repo's conformance fixture
(`compiler/crates/sauce-cli/tests/fixtures/node_modules/@sauce/token/`), kept identical on purpose so
drift between the two repos shows up as a diff rather than as silently divergent behavior — **do not
edit it here; change it in sauce and re-copy.** Nothing here enforces that: the `sauce` git dep is
pinned to a commit that predates the Rust compiler's move into `compiler/crates/`, so that fixture
path does not exist in `node_modules/sauce` and there is nothing on disk to compare against. The
check is manual —
`diff -r sdk/src/std/token <v12>/compiler/crates/sauce-cli/tests/fixtures/node_modules/@sauce/token`
against a local checkout. What CI *does* pin is the SPL Token program id the SVM arm guards on:
`test/std/token/compile.test.ts` derives it from the canonical base58 address and counts it in the
emitted bytecode, so a wrong digit or a deleted `require` fails there. It has two per-target arms (`token.evm.js`, `token.svm.js`) and
**deliberately no neutral `token.js`**: a token program is inherently target-specific, and a neutral
file would turn a missing arm into a confusing missing-EXPORT error instead of a clear failure to
import the package (`package.json`'s `main` names the neutral BASE the compiler suffixes per target).
The per-arm signatures genuinely differ where the account models force it — SVM `totalSupply`/
`decimals` take the mint as an `Account` while the EVM takes an `Address`, and the SVM writes take
5 args to the EVM's 3–4. Verified in `sdk/test/std/token/`: `compile.test.ts` (both targets, all seven
methods, the SVM account manifest, and the no-neutral-arm packaging invariant — always runs, no engine
needed) plus `svm.e2e.test.ts`/`evm.e2e.test.ts`, which EXECUTE the compiled bytecode against real SPL
accounts and a real deployed ERC20 — see `SAUCE_RUST_ENGINE_SO`/`SAUCE_RUST_V12_RUNTIME` above for why
those two are gated. `src/std/token` now **ships**: `copy-verify-assets.mjs` copies it into
`dist/std/token` (and `dist/` is in the package `files` list), because the route path resolves
`@sauce/token` to this vendored copy — see the next paragraph.

`@sauce/token` is the **default ambient MODULE** on the route path. `manifest.json`'s `ambient`
list (`["@sauce/token"]`) is handed by `chainAmbient()` to every `openRoute` compile, so its
exported functions (`approve`/`transfer`/`balanceOf`/…) are callable in any route body opened that
way with **zero import**. `openRoute` and no further: `chainAmbient` has exactly one call site
(`intent-dsl.ts`), and `compileSauceRoute` passes its caller's `ambient` straight through without
merging this list in — so a direct `compileSauceRoute(..., {})` gets no ambient module at all. This resolves because `rs-compile.ts`'s `SDK_STD_PACKAGES` maps the bare
`@sauce/token` specifier to the SDK's own vendored `std/token` dir (`STD_ROOT`, = `dist/std` once
built) regardless of `baseDirs` — an ambient module the compile can't resolve makes EVERY route
throw, so that list must only ever name modules the SDK resolves itself. Two DISTINCT mechanisms
share the word "ambient": ambient **DEFINES** (`chainDefines` — chain-scoped SCALARS: chainId,
protocol addresses, token symbols) vs ambient **MODULES** (this — whole library exports).

The **`Token(addr)` global wrapper** (`Token(addr).approve(spender, amt)` / `let t = Token(addr);
t.approve(...)`, zero import) is delivered by `token-rewrite.ts#rewriteTokenFactory`, a TEXTUAL
rewrite `Token(<expr>)` → `IERC20.at(<expr>)` run in `compileSauceRoute` before the compiler — the
SAME mechanism as the `<Sym>.transfer(...)` symbol sugar. So the compiler only ever sees the
supported `IERC20.at(addr)` binding, never a method call on a `Token(...)` result — no compiler
feature needed. It fires on ANY argument (a literal, a variable, an ambient `USDC` define), so unlike
the symbol sugar it does NOT depend on the token-symbol map and works on every EVM chain; it is
shadow-safe and svm-rejected the same way. **This is why the earlier "`Token(addr)` needs a compiler
feature" framing was a red herring:** it only applies to the DIFFERENT approach of making `@sauce/token`
*export* a real `Token` value (blocked by the M1 subset — a SauceScript function can't return a
contract binding, no re-export, no method-on-call-result). The rewrite sidesteps all of that. The
`@sauce/token` ambient module above still provides the FUNCTION surface (`approve(token, …)`); the two
are complementary spellings, not competitors.

**`actions/`** — `actionsToSauce(actions)` lowers routing intents (`uniswapV3ExactInput`, bridges,
wraps, stakes) to bytecode. Actions **chain**: output feeds the next implicitly (no `amountIn`) or via
`saveOutputAs`/`amountRef`. See `actions/AMM_SWAP_INTERFACES.md`.

**`dev-tools/`** — harness: `start:local`/`start:fork` boot a hardhat net + deploy the engine;
`npm run sauce <file.js> [args]` compiles+runs a SauceScript; `npm run recipe …` runs recipes.

## The swap Router (`../v12/engine/src/Router.sol`)

Lives in the **private engine repo**, not here, but recipes target it (its `Router`/`SauceRouter`
artifacts are what `cook()` runs against). `SauceRouter` is a thin delegatecall proxy → `Router`
(1829 lines at the pinned dep commit). Recipes import the minimal `ISauceRouter` ABI from
`dev-tools/artifacts/` — gitignored build output, copied from `sdk/src/artifacts/` by
`pnpm --filter './dev-tools' sync-artifacts`, so it does not exist until that has run.

**Entry points** (all the `swap*` ones are `onlySelf` — callable only via `cook()` from the same
contract, so a recipe calls them as `ISauceRouter.at(address.self).swapX(...)`):
- `swap(SwapParams)` — unified swap; dispatches on `params.poolType` to `_swapV2/_swapV3/_swapV4/
  _swapCurve/_swapBalancerV2/_swapDODOV2/_swapTraderJoeLB/_swapMaverickV2/_swapWOOFi`.
  `SwapParams` embeds a `PoolKey` struct (`currency0,currency1,fee,tickSpacing,hooks`) used by V4 and,
  for its `fee` field only, by V2 (see the fee note below); ignored for V3. Calling this from
  SauceScript requires the compiler to order object-literal
  struct fields by the ABI's declared component order at the call boundary (recursively for nested
  tuples); sorting them alphabetically scrambles the nested `PoolKey` into an empty revert. The TS
  compiler was fixed to do this, and its unit pin went away with it — **nothing in this repo pins the
  behavior against the current compiler**, so verify before relying on the unified `swap()` path. The
  flat methods below remain valid alternatives.
- `swapV3(pool, tokenIn, tokenOut, amountSpecified, sqrtPriceLimitX96, payer, recipient)` and
  `swapV4(...)` — **flat** legacy methods (no nested struct), verified working from SauceScript.
- `quote(QuoteParams)` — off-chain simulation; performs the swap and reverts with `QuoteRevert(amountIn,
  amountOut, sqrtPriceAfter, gas)`, which the caller decodes. Never lands a swap. **Nothing in this
  repo uses it** — `actions/src/to-quote.ts` calls each protocol's own quoter contract instead.

**`amountSpecified` sign is inconsistent by path** (this bit us): the flat `swapV3` passes through to
Uniswap, where **positive = exact input** (verified on fork). The unified `swap()`/V4 path and the
`SwapParams`/`QuoteParams` doc say **negative = exact input** (Uniswap-V4/quote convention). For
recipes using flat `swapV3`, pass a **positive** amount.

**`SwapPoolType` enum** (`engine/src/interfaces/IRouter.sol`, must match recipe constants):
`UniV2=0, UniV3=1, UniV4=2, Curve=3, BalancerV2=4, DODOV2=5, TraderJoeLB=6, MaverickV2=7, WOOFi=8,
PancakeInfinityCL=9, PancakeInfinityBin=10`. The last two are **flat-method only**
(`swapInfinityCL`/`swapInfinityBin`) — `SwapParams` can't carry the 6-field `InfinityPoolKey`, so
unified `swap()` does not dispatch them.

**Callbacks vs callback-free** — the key architectural split for "where does swap logic live":
- **V2/Solidly/Curve/DODO** are *callback-free*: `_swapV2` reads reserves, computes out (the V2 LP fee
  is **parameterizable**, read from `params.poolKey.fee` as ppm — 3000 = 0.30%, 2500 = 0.25%; `0`
  defaults to 3000, which reproduces the legacy hardcoded `997/1000` math byte-for-byte, and `>=
  1_000_000` is rejected), transfers tokenIn to the pool, calls
  `pair.swap(...)`. A recipe can replicate this **entirely in SauceScript** (transfer + `pool.swap`),
  bypassing the router — so new callback-free sources need only new SauceScript, no engine change.
- **V3/V4 (and Maverick)** use *callbacks*: the pool re-enters the contract mid-swap
  (`uniswapV3SwapCallback`/`pancakeV3SwapCallback`/`unlockCallback`/`maverickV2SwapCallback`) to pull
  input, reading transient-storage context set by `_swapV3`. A reentrant call during `cook()` hits the
  contract's Solidity dispatcher, **not** the paused bytecode interpreter — so callbacks can only be
  serviced by the router's compiled code. These swaps **must** go through the router (`swapV3`/`swapV4`).

## Publishing

Tag-driven (`.github/workflows/publish.yml`): `git tag v1.2.3 && git push origin v1.2.3` (or manual
`workflow_dispatch`). Builds all areas, runs `prepack` (syncs artifacts), stamps the **root**
`package.json` version, and publishes the single `@eco-incorp/sauce-sdk` to **public npmjs.com only**
(`NPM_TOKEN`). GitHub Packages was dropped deliberately — `publish.yml:12` records why. Only the root
version is published; workspace packages stay `private`.

**The root `publishConfig.registry` pin (npmjs.com) is kept as a defensive, explicit anchor.** It used to be load-bearing: a committed root `.npmrc` mapped the whole `@eco-incorp` scope to `https://npm.pkg.github.com` (to fetch the `@eco-incorp/sauce-compiler-wasm` devDependency), and a scope registry governs PUBLISHING as well as resolution — so without the pin this repo's own `@eco-incorp/sauce-sdk` could have published to GitHub Packages instead of npmjs.com. That `.npmrc` is now GONE, and the wasm compiler is a public npmjs package (`@eco-incorp/sauce-compiler`, imported as `sauce-compiler`) resolved from the default registry — so the pin is no longer strictly required, but it is kept as an explicit npmjs.com anchor. If a scoped `@eco-incorp` registry mapping is ever reintroduced, this pin becomes load-bearing again.
