# Proposal: source the WASM compiler from `sauce-next` (a second git dep), not a GitHub package

**Date:** 2026-08-10
**Status:** DESIGN — for user confirmation. Nothing implemented; no `package.json`/lockfile edits, no installs, no builds.
**Directive (user, 2026-08-10):** wire `sauce-next: github:eco-incorp/sauce#main` as a SECOND dev dependency to
source the SauceScript WASM compiler, alongside the existing `sauce: github:eco-incorp/sauce#release/beta`
(engine forge artifacts). Two deps, one repo, two branches: `sauce` (release/beta → engine artifacts),
`sauce-next` (main → WASM). This REPLACES pulling the WASM from a GitHub npm package (Sammy's PR #123) —
we bring WASM the same way we already bring engine artifacts.

---

## TL;DR / recommendation

- **Sammy's PR** = `eco-incorp/sauce-sdk#123` (`feat/std-token`, OPEN). It adds `@sauce/token` (SauceScript
  stdlib) under `sdk/src/std/token` and validates it against the **published Rust compiler** WASM package
  `@eco-incorp/sauce-compiler-wasm@0.1.0`, pulled from **GitHub Packages** (`npm.pkg.github.com`). Its CI is
  **red** on a GitHub-Packages auth scope (`ECO_INCORP_TOKEN` lacks `read:packages`). That auth problem is
  exactly what this directive sidesteps.
- **`main` ships NO prebuilt WASM.** The `sauce-wasm` crate on main is Rust _source_ only; its `.gitignore`
  excludes `/pkg` and `/target`. The WASM is produced by `wasm-pack build --target nodejs`, which needs a
  **Rust 1.97.1 + `wasm32-unknown-unknown` + `wasm-pack` + Node** toolchain — heavier than this repo's
  Foundry-only CI.
- Installing `github:eco-incorp/sauce#main` does **not** build anything: like `release/beta`, main has **no
  root `package.json`**, so pnpm just checks out the tree (no lifecycle script runs). So the git dep gives us
  source; a **build step + a vendored, committed WASM artifact** is required — the wasm-pack build is the
  analog of the engine's `forge build` postinstall.
- **Recommended shape:** treat the WASM exactly like the two existing **hand-refreshed committed binaries**
  (`artifacts/svm/engine.so`, `V12RuntimeBytecode.json`) — NOT like the CI-drift-checked forge artifacts.
  Add `sauce-next` as a devDep (source of truth), add a `sync-wasm` script that builds+copies the `pkg/`
  into a committed vendored dir when the Rust/wasm toolchain is present (and cleanly skips when it isn't,
  mirroring `generateV12Runtime`), refresh by hand on repin, and consume the vendored `pkg/` locally via a
  `file:` alias so Sammy's `@eco-incorp/sauce-compiler-wasm` import keeps working with **zero** consumer-code
  change and **no** GitHub-Packages registry, `.npmrc` scope map, or `read:packages` CI auth.
- **Top risk (substantive, not wiring):** the WASM compiles for the **main** engine lineage, but this repo's
  vendored engines (`engine.so`, V12 runtime) are **release/beta**. Sammy measured that beta engines cannot
  execute main-compiled bytecode (different opcodes). So sourcing the WASM alone makes the **compile-only**
  tests runnable, but the **e2e execution** suites still need matching (main-lineage) engines — otherwise they
  stay gated, same as today.

---

## Findings

### 1. Sammy's PR and the @sauce/token / WASM work

**`eco-incorp/sauce-sdk#123` — "feat(sdk): add @sauce/token and validate it against the Rust compiler"**
(author `fish-sammy`, branch `feat/std-token`, OPEN, 2026-08-09). Adds:

- `sdk/src/std/token/` — the `@sauce/token` SauceScript library: two per-target arms `token.evm.js` /
  `token.svm.js` (deliberately no neutral `token.js`), `package.json` (`"name": "@sauce/token"`,
  `"main": "token.js"`), and `erc20.abi.json`. Byte-identical to the sauce repo's conformance fixture
  `compiler/crates/sauce-cli/tests/fixtures/sauce-token/` (drift shows up as a diff).
- `sdk/test/std/token/` — `compile.test.ts` (12 tests, engine-free), `evm.e2e.test.ts` (5, anvil + V12
  runtime), `svm.e2e.test.ts` (6, LiteSVM + real SPL), plus `harness.ts`.
- **`@eco-incorp/sauce-compiler-wasm@0.1.0`** as an **sdk devDependency** — this is the WASM artifact it
  needs: the published Rust compiler. Root `.npmrc` maps `@eco-incorp:registry=https://npm.pkg.github.com`;
  both workflows gain a "Configure GitHub Packages auth" step appending
  `//npm.pkg.github.com/:_authToken=${ECO_INCORP_TOKEN}`; root `publishConfig.registry` pinned to npmjs so
  publish doesn't leak to GH Packages.

**How the harness consumes it** (`sdk/test/std/token/harness.ts`):

```ts
const { compile } = createRequire(import.meta.url)("@eco-incorp/sauce-compiler-wasm") as {
  compile: (options: WasmCompileOptions) => Artifact;
};
```

`compile({ target, entry?, resolve, resolvePackage? }) → { bytecode: Uint8Array, manifest? }`. The package is
`--target nodejs` (CommonJS + a sibling `.wasm` read via `fs`); `createRequire` hands it to Node's CJS loader,
which is the only loader that resolves the `.wasm` sibling.

**Its blocker (from the PR body):** CI `pnpm install` gets `ERR_PNPM_FETCH_403 Forbidden` fetching the wasm
package. The git `insteadOf` rewrite covers the private _git_ dep only; the npm registry is a separate auth
protocol, so `ECO_INCORP_TOKEN` needs `read:packages` added (and possibly per-repo package read grant). **This
GH-Packages auth requirement is precisely what the directive removes** by sourcing WASM from a git dep instead.

Sammy's own PR body also records the engine-lineage mismatch (see Risk #1) and that `sdk/src/std/` is **not** in
the package `files` list — the whole PR is validation-only, nothing ships to consumers yet.

### 2. The WASM package — `eco-incorp/sauce#288` (MERGED, `feat/wasm-npm-package`, ECO-1869)

- Crate `compiler/crates/sauce-wasm` — a thin `cdylib` + `wasm-bindgen` layer over `sauce_core::compile`
  (`crate-type = ["cdylib"]`, deps: `sauce-core`, `wasm-bindgen`, `js-sys`, `serde-wasm-bindgen`,
  `error-stack`, `thiserror`). `src/lib.rs` exports a single `#[wasm_bindgen] pub fn compile(options) ->
Result<JsValue, JsError>`; a compile/resolve error throws a JS `Error` with the rustc-style diagnostic;
  `manifest` is present on the SVM target only.
- **Build** (`compiler/Makefile`):
  ```
  pkg:   wasm-pack build crates/sauce-wasm --target nodejs --out-dir pkg
         node crates/sauce-wasm/scripts/postbuild.mjs
  smoke: pkg → node crates/sauce-wasm/test/smoke.mjs
  ```
  `postbuild.mjs` merges `package.template.json` (`{"name":"@eco-incorp/sauce-compiler-wasm",
"publishConfig":{"registry":"https://npm.pkg.github.com"}}`) onto the wasm-pack-generated
  `pkg/package.json` and stamps `WASM_PKG_VERSION` when set.
- **Toolchain** (`compiler/rust-toolchain.toml`): `channel = "1.97.1"`, `components = ["clippy"]`,
  `targets = ["wasm32-unknown-unknown"]`. Plus `wasm-pack` (`cargo install wasm-pack`) and Node.
- Published tag-driven to `npm.pkg.github.com` via `release-compiler-wasm.yml`. `main` is the compiler-rs
  (Rust rewrite) track; this WASM is that build.

### 3. `main` branch reality (the source we'd vendor from)

`gh api repos/eco-incorp/sauce/git/trees/main?recursive=1` → 397 paths, not truncated:

- **No root `package.json`.** Root = `.github .gitignore .gitmodules .releaserc.js LICENSE.md README.md
compiler docs v12-evm v12-svm`. (release/beta also has no root package.json — 404 — yet installs fine; see §4.)
- **No prebuilt WASM.** No `.wasm`, no `pkg/` anywhere in the tree. `compiler/crates/sauce-wasm/.gitignore` =
  `/pkg` and `/target`. Only source ships: `src/lib.rs`, `Cargo.toml`, `package.template.json`,
  `scripts/postbuild.mjs`, `test/smoke.mjs`, `README.md`.
- **Different layout from release/beta.** main has `compiler/` (Rust), `v12-evm/`, `v12-svm/` — no `engine/`,
  no `engine-v12/`, no `deployments/`. So `sauce-next` cannot feed the _engine_ sync scripts (those read
  `engine/out/...`, `engine-v12/...`, `deployments/v12.json`, which exist only on release/beta). `sauce-next`
  is a WASM source ONLY; `sauce` stays the engine-artifact source.

**Answer to "prebuilt vs must be built": MUST BE BUILT** with `wasm-pack` from Rust source. There is no
prebuilt artifact on main to copy.

### 4. The existing `sauce` dep + sync pattern to mirror

- `compiler/package.json` devDependencies: `"sauce": "github:eco-incorp/sauce#release/beta"`.
- **Install mechanism (verified locally):** the installed dep at
  `compiler/node_modules/sauce → ../../node_modules/.pnpm/sauce@git+...<sha>/node_modules/sauce` has **no
  `package.json`**. pnpm takes the name from the LHS specifier and checks out the tree; **no build/lifecycle
  script runs for the git dep** (there's no package.json to carry one). Lockfile resolves it over **SSH**
  (`git+https://git@github.com:eco-incorp/sauce.git#<sha>`), so git-dep auth is SSH/`insteadOf`-based —
  the same auth that already works, and the same auth `sauce-next#main` would reuse. **This is the crux of the
  directive: git-dep auth already works; the GH-Packages `read:packages` token does not.**
- **Engine-artifact flow (the pattern to mirror):**
  - `compiler` `postinstall` (`integration-test/fetch-engine-libs.js`) + a `forge build` produce
    `engine/out/*.json` inside the installed dep.
  - `sdk/scripts/sync-engine-artifacts.mjs` resolves the dep via a **candidate list** (never the SHA store
    path): `[REPO/compiler/node_modules/sauce, REPO/node_modules/sauce]`, copies 8 REQUIRED forge JSON
    artifacts into committed `sdk/dist/artifacts/` + `sdk/src/artifacts/`, generates
    `src/deployments/v12.generated.ts` + the svm engine-abi, and treats `V12RuntimeBytecode.json` as
    **OPTIONAL** — copied if present, else generated via the huff toolchain if on PATH, else **skipped**
    (committed copy kept).
  - `dev-tools/scripts/sync-artifacts.js` (run at root `prepack`) copies a 5-artifact subset into
    `dev-tools/artifacts/` from the same candidate list.
  - **CI drift check:** CI installs **Foundry only** (grep of `.github/workflows/` finds no
    `rust`/`cargo`/`wasm-pack` — the only "toolchain" comment is that it deliberately does NOT install the
    Solana toolchain), re-runs the sync, and `git diff --exit-status`es the result. This enforces the 8 forge
    artifacts. It **cannot** enforce `V12RuntimeBytecode.json` (no huff toolchain) or `artifacts/svm/engine.so`
    (no Solana toolchain) — those are **hand-refreshed committed binaries**, refreshed on repin per documented
    rituals in CLAUDE.md.
- **Committed-binary precedent:** `artifacts/svm/engine.so` is 264K, committed normally (`.so`/`.wasm` are not
  actually gitignored in this repo today, despite CLAUDE.md's "force-added" phrasing). It ships via root
  `package.json` `files: ["artifacts/svm/engine.so"]`. This is the exact template for a committed WASM binary.

---

## Design / proposal (concrete diff sketch — NOT applied)

The WASM's toolchain (Rust + wasm-pack) is not in this repo's CI, and there are two precedents for a
committed binary refreshed by hand on repin (`engine.so`, `V12RuntimeBytecode.json`). So the WASM follows
**that** precedent, not the forge-artifact CI-drift precedent.

### (a) Add `sauce-next` as a devDep (source of truth)

`compiler/package.json` (mirrors `sauce` exactly — reuses the existing `SAUCE_CANDIDATES` resolution shape;
`sdk/` is equally valid but compiler keeps both git deps together):

```diff
   "devDependencies": {
+    "sauce-next": "github:eco-incorp/sauce#main",
     "sauce": "github:eco-incorp/sauce#release/beta",
     ...
```

Install cost: a ~397-file source checkout into the pnpm store, no build, SSH auth (already works). It does
**not** feed any engine sync script (main has no `engine/`).

### (b) Vendored, committed WASM location

New committed dir holding the wasm-pack `--target nodejs` output, e.g. `sdk/vendor/sauce-compiler-wasm/`:

```
sdk/vendor/sauce-compiler-wasm/
  package.json            # name "@eco-incorp/sauce-compiler-wasm", main "sauce_wasm.js"
  sauce_wasm.js           # CJS glue
  sauce_wasm_bg.wasm      # the binary (committed; measure size on first build — cf. engine.so 264K)
  sauce_wasm.d.ts
  sauce_wasm_bg.wasm.d.ts
```

Size unknown until first build; a Rust compiler compiled to wasm is typically ~0.5–2 MB. Flag if it's large.

### (c) `sync-wasm` script (mirrors `sync-engine-artifacts` + `generateV12Runtime`)

New `sdk/scripts/sync-wasm.mjs`:

- Resolve `sauce-next` via a candidate list `[REPO/compiler/node_modules/sauce-next,
REPO/node_modules/sauce-next]` (same rule as the engine sync).
- If Rust 1.97.1 + `wasm32-unknown-unknown` + `wasm-pack` + Node are on PATH: run
  `wasm-pack build crates/sauce-wasm --target nodejs --out-dir pkg` (cwd = `<sauce-next>/compiler`), then
  `node crates/sauce-wasm/scripts/postbuild.mjs`, and copy `pkg/*` over `sdk/vendor/sauce-compiler-wasm/`.
- If the toolchain is absent: **skip, keep the committed copy, print a notice** — byte-for-byte the
  `generateV12Runtime` fail-soft behavior, so a Foundry-only host/CI is never broken by this script.
- Add a `"sync-wasm"` script to `sdk/package.json`; do **not** wire it into the default `build` (it needs a
  toolchain CI doesn't have). It's a repin-time step.

### (d) Consume the vendored WASM locally (removes the GH package)

Add a `file:` self-alias so Sammy's specifier resolves to the vendored dir with **no consumer-code change**:

`sdk/package.json`:

```diff
   "devDependencies": {
-    "@eco-incorp/sauce-compiler-wasm": "0.1.0",
+    "@eco-incorp/sauce-compiler-wasm": "file:./vendor/sauce-compiler-wasm",
     ...
```

`createRequire(import.meta.url)('@eco-incorp/sauce-compiler-wasm')` in `harness.ts` then resolves to the
committed vendored `pkg/`, which loads its `.wasm` sibling via `fs` exactly as before.

**Deletions this enables** (undo Sammy's GH-Packages wiring):

- root `.npmrc` (`@eco-incorp:registry=...`) — no longer needed for resolution.
- both workflows' "Configure GitHub Packages auth for @eco-incorp" steps — no `read:packages` needed.
- `ECO_INCORP_TOKEN` gets no new scope; the git `insteadOf` rewrite already covers `sauce` + `sauce-next`.
- root `publishConfig.registry = npmjs` — **keep** it regardless (it's a correct release-safety pin,
  independent of where WASM comes from).

### (e) CI drift-check story

Matches `engine.so` / `V12RuntimeBytecode.json`, NOT the forge artifacts:

- CI stays **Foundry-only**; it does **not** build or drift-check the WASM (no Rust/wasm-pack). `sync-wasm`
  run in CI would skip (toolchain absent) → no drift on the committed vendored binary.
- Discipline is the documented repin ritual (below), same as the other two hand-refreshed binaries.
- **Alternative if the user wants full drift parity:** add Rust 1.97.1 + `wasm32` + `wasm-pack` to CI and have
  it re-run `sync-wasm` + `git diff --exit-status`. Cost: a materially heavier CI (Rust build of the whole
  compiler-rs workspace, minutes not seconds) — a real change to this repo's Foundry-only posture. Recommend
  **against** unless byte-drift on the WASM is a live concern; the hand-refresh precedent exists exactly to
  avoid putting a whole toolchain in CI for one artifact.

### (f) Refresh ritual (add to CLAUDE.md, next to the engine.so / V12RuntimeBytecode rituals)

> **Refresh the vendored WASM whenever `sauce-next` is repinned.** From a checkout of the pinned `sauce-next`
> (main) commit, with Rust 1.97.1 (`rustup target add wasm32-unknown-unknown`), `wasm-pack`, and Node on PATH:
> `cd compiler && wasm-pack build crates/sauce-wasm --target nodejs --out-dir pkg && node
crates/sauce-wasm/scripts/postbuild.mjs`, then copy `pkg/*` over `sdk/vendor/sauce-compiler-wasm/` and
> commit. `pnpm --filter './sdk' sync-wasm` automates the copy when the toolchain is present. Nothing in this
> repo re-derives it, so a repin without a refresh silently keeps a stale compiler.

### (g) Shipping

Initially keep it validation-only (Sammy's stance: `sdk/src/std/` not in `files`). If/when `@sauce/token`
ships to consumers, decide separately whether the WASM binary is a runtime dependency of the published SDK or
stays a dev/test-only input — do **not** add `sdk/vendor/sauce-compiler-wasm/**` to root `files` until that's
decided (it would bloat the tarball by the wasm size).

---

## Top risks

1. **Engine-lineage mismatch (the substantive one).** The WASM compiles for **main**; this repo's vendored
   engines (`artifacts/svm/engine.so`, the V12 runtime from `sync-engine-artifacts`) are **release/beta**.
   Sammy measured beta engines cannot execute main-compiled bytecode (SVM: `JUMP/JUMP_I` 0xB0/0xB1 only on
   main, different `NEW_ARRAY` scalar encoding → `InvalidInstructionData`; EVM: 0xB0–0xB5 mean different ops,
   `MLOAD/MSTORE/MALLOC` are `do_unknown` on the pin → empty return / MemoryOOG). So sourcing the WASM alone
   makes the **compile-only** suite (`compile.test.ts`, 12 tests, no engine) runnable, but the **e2e execution**
   suites (`evm.e2e`, `svm.e2e`) still need matching main-lineage engines. Options: keep those e2e suites gated
   (status quo), or a separate repin of the engine artifacts toward main (out of scope here, and a big change
   — main has no `engine/`/`deployments/`, so the whole engine-sync flow would need rework). **This directive
   fixes WASM sourcing + the auth blocker; it does not by itself make e2e execution green.**

2. **Toolchain to refresh.** Producing the WASM needs Rust 1.97.1 + `wasm32-unknown-unknown` + `wasm-pack` +
   Node — not in this repo's Foundry-only CI, and heavier than the huff/solana refreshes (which are a single
   `forge`/`cargo build-sbf` command). The recommended design confines this to a hand-refresh-on-repin step;
   the "add Rust to CI" alternative pays it on every CI run.

3. **Private-repo auth.** `sauce-next#main` reuses the existing SSH/`insteadOf` git auth that `sauce` already
   uses — **verified** the installed `sauce` dep resolves over `git@github.com:` with no npm token. This is the
   directive's whole win: it drops the GH-Packages `read:packages` requirement that has PR #123's CI stuck at 403. (One nit: the user's local `~/.npmrc` maps `@eco:` — not `@eco-incorp:` — to GH Packages; irrelevant
   once we stop resolving the wasm from a registry, but noted since it wouldn't have authed Sammy's dep anyway.)

4. **Committed binary size / drift-by-hand.** The `.wasm` is committed (like `engine.so`); measure it on first
   build and reconsider `files`-inclusion at ship time. Because CI won't re-derive it, a repin that forgets the
   refresh silently ships a stale compiler — mitigated only by the documented ritual, same trap as
   `V12RuntimeBytecode.json`.

5. **`--target nodejs` only.** The vendored WASM is Node/CJS (browser build deferred, ECO-1873). Fine for
   sdk tests/build; not usable in a browser consumer as-is.

---

## Open questions for the user (before implementation)

1. **Vendored path + which package holds `sauce-next`:** `sdk/vendor/sauce-compiler-wasm/` +
   `sauce-next` in `compiler/package.json` (recommended), or somewhere else?
2. **CI posture:** hand-refresh-on-repin (recommended, matches `engine.so`), or add Rust+wasm-pack to CI for a
   byte-drift check (heavier)?
3. **e2e execution:** accept that `evm.e2e`/`svm.e2e` stay gated until engines are repinned to a main-matching
   lineage, or is repinning engines part of this effort too (much larger scope)?
4. **Shipping:** keep validation-only (not in `files`) for now — confirm.
