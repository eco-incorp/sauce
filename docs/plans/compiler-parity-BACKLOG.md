# Compiler Parity — Epic Backlog & Execution Tracker

**Autonomous program (user, 2026-08-19, `/loop 30m` + ultracode).** Implement the complete
`compiler-parity-and-port-plan.md`: **Part 1** backport RS→TS (make the local TS compiler resemble
compiler-rs), then **Part 2** forward-port TS→RS (port TS-only features into `../sauce` compiler-rs).
Parallel workflows + git worktrees; build in parallel, **merge only on green** (tests are the gate);
**TDD, borrowing tests from each compiler** to drive the other.

This file is the DURABLE state across cron fires (the `/loop` cron job is session-only in-memory).
Every fire: read this file → pick the next unblocked item(s) → advance → update status + Execution Log.

---

## 🚀 EPIC-P — PLUGIN SERIES (USER "make it all happen", fire#47) — EXECUTING as atomic stacked PRs

Design: `docs/plans/ambient-import-chain-scope-design.md` + `shared-stdlib-dsl-plugin-architecture.md`. Option B
confirmed (chain regions = separate atomic programs = the nest cascade). Flow per PR: opus design (where needed)
→ sonnet build → opus review → gate green → stacked branch → PR.

**⚠️ BASE CORRECTION (fire#48, 2026-08-22 — supersedes "RS PRs off origin/main").** The RS plugin PRs (P1–P3)
CANNOT base on bare `origin/main`: they build on the parity foundation (`CompileOptions.defines`,
`entry_arg_types`, `contracts` + `inject_defines`/`assign_global_ids`) which lives ONLY on the unmerged local
branch `feat/compiler-parity-port` (235902bbf) — verified absent on `origin/main` this fire (options.rs on main
has none of them). So the RS plugin stack is **based on the parity branch tip**, in worktree
`/Users/er/Documents/Projects/sauce-plugin-stack`. Consequence — a real **SEQUENCING GATE**: to actually SHIP
(push/merge) the plugin epic, the parity foundation must land on `main` FIRST (its own atomic PR series, still a
SEPARATE deliverable awaiting the user's explicit merge go-ahead). Until then the plugin PRs are BUILT + gated
green LOCALLY, stacked on parity, ready to push the moment parity lands. This does not merge anything outward.
A prior background workflow (`w16mpr0xo`) died mid-run and had gone off-scope re-porting `defines` onto bare
main (redundant with parity) — discarded fire#48; worktree re-anchored onto the parity tip.

- ✅ **P1 [RS]** expose `defines` + `entry_arg_types` on the wasm surface — **DONE fire#48**, commit
  `68ecd5b6e` on branch `plugin-wasm-surface` (parity-based, NOT pushed). Wasm marshalling + TS decls ONLY,
  no core changes (both `Word`/`ArgShape` already re-exported). `defines?: Array<[string,string]>` (value via
  `Word::FromStr`, decimal/`0x`-hex); `entryArgTypes?: Array<ArgShape|null>` with a new exported recursive
  `{kind}` TS union + a `arg_shape()` recursive marshaller; dedicated `DefineValue`/`UnknownArgShapeKind`
  errors. Two new text-parity tests read the CORE `ArgShape` enum source (drift guard, stronger than a
  self-check). Gate GREEN (clippy -D 0, nightly-fmt no drift, sauce-wasm 4/4, wasm32 target builds w/ RUSTC
  override = known env-only PATH issue); sonnet-built (`plugin-p1`), opus-reviewed CONFIRMED-SOUND + gate
  re-verified by orchestrator. NO AI attribution.
- ✅ **P2 [RS]** inline-ABI `contracts` variant — **DONE fire#49**, commit `52d1547bf` on
  `plugin-inline-contracts` (stacked on P1, NOT pushed). New `CompileOptions.inline_contracts:
  Vec<(String,String)>` = `(name, abi_json)`, applied to module 0 only; `resolve_contracts` calls
  `abi::parse(name, "<inline:{name}>", …)` DIRECTLY (no resolver), through a refactored shared
  `check_contract_name_available` collision helper (imports/manifest/inline all collide identically). Wasm:
  `inlineContracts?: Array<[name,abi]>` + `optional_inline_contracts`. 6 new red-first tests incl. an
  expectation-less-MockResolver proof that `resolver.resolve` is never called for inline. Sonnet-built
  (`plugin-p1`), opus-reviewed CONFIRMED-SOUND, gate RE-VERIFIED by orchestrator with real exit codes
  (clippy 0, **sauce-core 1110/1110**, wasm 4/4, nightly-fmt no drift). Caught+fixed 17 call sites (not 6 —
  `lower_program_full` has 11 more in the NS-1/8/10 test module). NO AI attribution.
- ✅ **P3 [RS]** ambient-import primitive — **DONE fire#50**, commit `6f81b9039` on `plugin-ambient` (stacked
  on P2, NOT pushed). `CompileOptions.ambient: Vec<String>`; ambient specifiers = extra `load_graph` roots
  (same `Loader::visit`, diamond-deduped); two `.entry().or_insert()` broadcasts (`inject_ambient_consts` →
  every module's `own` value table, `inject_ambient_functions` → every module's own fn table), run in the
  `inject_defines` window before `resolve_module_scopes` freezes tables — **insert-if-absent so USER CODE
  WINS** (reverse of `inject_defines`); `reject_ambient_main` (fast-fail) + `reject_duplicate_ambient_names`
  (unified fn+const namespace, `other != module` diamond guard). Wasm `ambient?: Array<string>`. 9 red-first
  tests incl. shadowing (fn/const/param), cross-channel dup, `main`-reject, and a byte-identical `ambient:[]`
  negative control. Sonnet-built (`plugin-p1`), opus-reviewed CONFIRMED-SOUND, gate RE-VERIFIED real exit
  codes (clippy 0, **sauce-core 1119/1119**, wasm 4/4, fmt no drift). NO AI attribution. **P5 CHECK:**
  `ambient_module_indices` keys `index_by_path.get(raw_specifier)` + `.expect()` — verify a BARE package
  specifier (`@sauce/token`) keys identically (else panic) when P5 makes it the first ambient module.
- ⬜ **P4 [TS]** ambient-import parity — symmetric `ambient?: string[]` option. **SEAMS VERIFIED fire#50**
  (all exist as the design claims): `CompileOptions` (compiler/src/index.ts:150) already carries
  `defines?`/`contracts?`/`tsSource?` → `ambient?: string[]` slots in; `compile()` already calls
  `ctx.setDefines` (index.ts:328) + `collectImportedFunctions(program, ctx, …)` (:407). **Mechanism (mirrors
  P3):** for each ambient specifier, resolve + run `collectImportedFunctions` (processor/index.ts:148 —
  registers exported fns into the compile) and register exported consts via **`ctx.addDefine`
  (context.ts:610), which is ALREADY insert-if-absent (`if (!this.defines.has(name))`)** = the exact
  user-shadows-ambient precedence P3 decided (contrast `setDefines`, which overrides — used for
  `CompileOptions.defines`). NB ambient FUNCTIONS ride `collectImportedFunctions` (dynamic, per-compile),
  NOT the static `GLOBAL_FUNCTIONS`/`RESERVED_NAMES` merge (that's for built-in intrinsics like `emit`).
  Dispatch once P3's final contract (option name, fixture, precedence) lands, reusing P3's fixture as the
  parity test. *(core new TS feature)*
  **DISPATCH-READY fire#50** (P3's contract now final). **Parity fixture (from P3's headline test):** ambient
  module `./ambient.js` = `export function double(x) { return x * 2n; }`; entry `function main() { return
  double(21n); }`; `ambient: ["./ambient.js"]` → `double` resolves with NO import line. P4 must compile this
  on TS with the same shadowing precedence (user fn/const/param shadows ambient) + a byte/AST-identical
  `ambient: []` negative control. **Base:** sauce-sdk `origin/main` @ `897d488` (P4 needs only globals.ts
  seams that are on main — independently mergeable, NOT dependent on the TS parity branch). **Setup note:**
  build in a DEDICATED sauce-sdk worktree off main (`pnpm install` needs the private `sauce` dep auth +
  Foundry postinstall — a general-purpose agent must handle/ report that); gate = `pnpm --filter './compiler'
  typecheck + test + lint`. TS `CompileOptions.ambient?: string[]` (index.ts:150); ambient fns via
  `collectImportedFunctions` over the specifiers, consts via an insert-if-absent define registration.
  **CORRECTION fire#51:** `ctx.addDefine` is NOT on origin/main (it's parity-branch-only) — on main there is
  only `setDefines` (override) + `getConstant`; so P4 ADDS a small insert-if-absent `addDefine` itself
  (`if (!this.defines.has(name)) this.defines.set(name, value)`). Fresh TS-scoped sonnet agent (plugin-p1 is
  RS-scoped — released after P3).
  **IN PROGRESS fire#51** (`plugin-p4`, worktree `/Users/er/Documents/Projects/sauce-sdk-ts-plugin` off
  origin/main@897d488). ENV VERIFIED by orchestrator: pnpm install clean, compiler typecheck green, engine
  libs fetched by hand (`node integration-test/fetch-engine-libs.js` — the pnpm-v10 `approve-builds` skip
  meant the postinstall didn't auto-run), and `pnpm --filter './compiler' test` runs green with its
  anvil+forge globalSetup. **TS JEST GOTCHA (durable, future TS lanes):** the pnpm store has BOTH jest 29 and
  jest 30 — `pnpm exec jest` picks 29 → dies `clearMocksOnScope is not a function`. ALWAYS use the package
  script `pnpm --filter './compiler' test -- <path>` (compiler's own jest-30 bin). Not a code bug.
  **✅ DONE + verified fire#51**, commit `77109ad88` on `plugin-ts-ambient` (base main@897d488, NOT pushed).
  `CompileOptions.ambient?: string[]`; refactored `collectImportedFunctions`→ shared
  `collectFunctionsFromSpecifier` (drives the same resolve+register from a bare specifier), + new
  `collectAmbientExports` (fresh ambient-scoped `seen`/`visited` → ambient-vs-ambient dup throws,
  ambient-vs-user filtered silently via a `userNames` set → USER WINS) + `registerAmbientConsts` (routes
  through existing `registerConstant` = insert-if-absent; `addDefine` didn't exist on main, agent correctly
  reused `registerConstant`). Added `ambient` to the compile cache key. **Precedence verified by orchestrator**
  (`registerTopLevelConsts` at :549 runs BEFORE the ambient block at ~:557, so `defines > user const >
  ambient const`; user-const-wins is genuine, not accidental). Headline fn is byte-identical to a real
  import; headline const byte-identical to a `defines`. 11 cases × {v1,v12} = 22 tests. Gate RE-VERIFIED with
  correct invocation (typecheck/lint/format 0, **ambient 22/22**, **full unit 1682 passed / 67 suites, 0
  FAIL**, 2 env-gated skips = baseline). Sonnet-built (`plugin-p4`), opus-reviewed CONFIRMED-SOUND. NO AI
  attribution. **Orchestrator verification lesson:** `pnpm -C <dir> --filter './compiler'` prints "No projects
  matched" and exits 0 = a VACUOUS false-green; must `cd <worktree> && pnpm --filter './compiler' …`.

**🎉 AMBIENT-IMPORT PARITY COMPLETE (fire#51):** the core plugin mechanism is now a real, SYMMETRIC feature on
BOTH compilers — RS P3 (`6f81b9039`) + TS P4 (`77109ad88`), same fixture, same precedence, verified. P5–P8
(shared plugin skeleton + SDK wiring + registries→Layer B) remain.
- 🔄 **P5 [plugin]** shared skeleton — `@sauce/token` as first ambient module + Layer-C manifest. **DESIGN-READY
  fire#52** → `docs/plans/P5-plugin-skeleton-design.md`. Proves the plugin mechanism end-to-end: BOTH compilers
  compile a `@sauce/token`-using program with NO import line (via P3/P4 ambient), driven by a declarative
  Layer-C manifest (`{ambient:["@sauce/token"], nameParity:{emit:"log",throw:"revert"}}`). **P3 bare-specifier
  CHECK RESOLVED fire#52:** RS `Loader::visit` keys `index_by_path` by the raw specifier (assembly.rs:480), so
  `ambient_module_indices.get("@sauce/token")` hits — a package ambient specifier works, the `.expect()` panic
  worry was unfounded. **USER FORK (flagged, reversible default chosen):** where the plugin ultimately lives /
  how it's packaged — P5 default = DON'T relocate `@sauce/token` (it's the byte-identical sauce conformance
  fixture), add only a manifest + ambient proof; promote-to-package deferred to user confirmation. Build:
  manifest + TS token-ambient proof (P5a) + RS token-ambient proof (P5b) + a manifest↔compiler name-parity
  drift test. Dispatching P5a to the ready TS worktree.
  **⚠️ MAJOR FINDING fire#52 (plugin-p5a caught it; my P5 design was flawed):** there are TWO compilers with
  DIFFERENT target vocabularies, and the design conflated them. (1) The SDK token harness (`sdk/test/std/token`)
  compiles through **`sauce-compiler-next` = the PUBLISHED Rust/WASM compiler** (npm `@eco-incorp/sauce-compiler`,
  ≤0.4.1) — which has **NO `ambient`** (P3 is unreleased, only on the local `plugin-ambient` branch). (2) The
  LOCAL TS compiler (`compiler/`) targets **`v1|v12|svm`** and probes `token.v1.js`/`token.v12.js`, but
  `@sauce/token` ships only `token.evm.js`/`token.svm.js` (evm/svm = the RS/WASM vocab) — so the LOCAL TS
  compiler **cannot resolve `@sauce/token` at all**, import OR ambient. So "prove real `@sauce/token` ambient on
  BOTH compilers" is NOT achievable as designed. **CORRECTED split:**
  - **P5a (TS, unblocked, proceeding):** manifest+loader; name-parity test vs the LOCAL compiler's REAL aliases
    (`emit`→`s.log` globals.ts~734; `throw`→`OPS.REVERT`); + a bare/package-specifier ambient proof on the LOCAL
    compiler via the EXISTING TOY `@sauce/token` fixture (`compiler/test/node-modules-fixture.ts`), byte-identical
    import≡ambient — closes P4's "package-specifier ambient" gap (P4 tested only relative specifiers). NO real
    `@sauce/token` (vocab mismatch); do NOT add v1/v12 arms (byte-identical constraint + user's call).
  - **P5b (RS):** the REAL `@sauce/token`-as-ambient proof belongs here — the RS `plugin-ambient` branch has P3
    ambient + evm/svm vocab + the byte-identical sauce-token fixture already at
    `compiler/crates/sauce-cli/tests/fixtures/sauce-token/`. THIS is the genuine plugin demonstration.
  - **SHIPPING DEPENDENCY (surface to user):** the SDK's real payoff (ambient `@sauce/token` through the SDK's
    compile path = the published WASM compiler) requires **P3/ambient to be RELEASED to npm** — beyond building
    the plugin PRs, it needs a compiler-rs release. The TS compiler's ambient (P4) is generic-parity/legacy;
    `@sauce/token` is fundamentally an RS/WASM-target library. This reframes P6–P8 (SDK wiring) as RS/WASM-side.
  - ✅ **P5a DONE + verified fire#52**, commit `b2b3a7e16` on `plugin-token-ambient` (stacked on P4, NOT
    pushed). Manifest `sdk/src/plugin/manifest.json` + `loadPlugin()` (skills-loader convention); name-parity
    test (compiles `emit`/`throw` → asserts LOG/REVERT opcodes tied to the manifest, v1+v12); ambient
    bare/scoped-PACKAGE-specifier proof in `compiler/test/node-modules-resolution.test.ts` (toy `@sauce/token`
    fixture, `ambient:['@sauce/token']` byte-identical to import on v1+v12, per-target arm still wins, real
    negative control) — closes P4's package-specifier gap (P4 tested only relative). Gate RE-VERIFIED real
    exit codes (compiler 47/47, sdk 27/27, sdk typecheck 0). NO AI attribution. FOLLOW-UPS: (i) **P4 committed
    `compiler/dist` is stale** (P4 didn't rebuild it; harmless now since the SDK uses the published WASM
    compiler, not local dist — rebuild+commit when preparing the stack for PRs); (ii) real-`@sauce/token`-via-
    LOCAL-TS-compiler proof is a documented vocab-mismatch gap, NOT faked.
  - 🔄 **P5b [RS] IN PROGRESS fire#52** — the REAL `@sauce/token`-as-ambient proof. RS `plugin-ambient` branch
    has P3 ambient + evm/svm vocab + the byte-identical fixture at
    `compiler/crates/sauce-cli/tests/fixtures/node_modules/@sauce/token/`; `token_conformance.rs` = the
    import-based template. P5b = ambient variant (`CompileOptions.ambient=["@sauce/token"]`) byte-identical to
    import on evm+svm. Dispatched to `plugin-p1` (re-engaged, RS-scoped).
    ✅ **P5b DONE + verified fire#53**, commit `d1680d51f` on `plugin-token-ambient-rs` (stacked on P3, NOT
    pushed). `compile_token_ambient` + `strip_import` (derives the ambient entry from the import CASES entry —
    no hand-duplication drift) + `every_method_compiles_ambient_byte_identical_to_the_import` (all 7 methods ×
    evm+svm = 14 full-`Artifact` equalities: bytecode AND svm account manifest) + a real negative control.
    Makefile: both tests added to `TOKEN_TESTS_EVM` (the `check-token-split` guard caught them). Directly
    confirmed the bare/package ambient specifier works (no panic, no special-case). Sonnet-built (`plugin-p1`,
    who also built the REAL engines + ran the full conformance suite: svm 168, v12 188, token 10/10, …).
    Gate RE-VERIFIED real exit codes (clippy 0, fmt no drift, token_conformance 10/10). NO AI attribution.
    **🎉 P5 COMPLETE — the plugin epic's core is proven end-to-end: a real stdlib library (`@sauce/token`) works
    as an ambient plugin module on the RS compiler, byte-identical to explicit import.**

---

## 🧭 EPIC STATE (fire#53): provable work COMPLETE; remainder is DECISION-GATED

**DONE + verified, all local/stacked/gated-green/UNPUSHED:**
- RS: P1 `68ecd5b6e` (wasm defines+entry_arg_types) → P2 `52d1547bf` (inline contracts) → P3 `6f81b9039`
  (ambient primitive) → P5b `d1680d51f` (real `@sauce/token` ambient, byte-identical).
- TS: P4 `77109ad88` (ambient parity) → P5a `b2b3a7e16` (manifest + loader + name-parity + ambient-package proof).
- Ambient-import parity exists SYMMETRICALLY on both compilers; the shared plugin skeleton (Layer-C manifest)
  + the real-library ambient proof are in place.

**REMAINDER = decision-gated, NOT effort-gated (needs the USER):**
- **P6/P7 (SDK wiring)** feed `ambient`/`defines`/inline-contracts to the SDK's compile path = the PUBLISHED
  WASM compiler, which LACKS ambient (P3 is unreleased). → **needs a compiler-rs RELEASE with the ambient
  primitive** (my `plugin-ambient` branch is the source, unpushed). Building SDK wiring against a not-yet-
  released API would be speculative/wrong.
- **P8 (registries → Layer B)** + the plugin's ultimate home/packaging → the plugin-structure fork (user's call).
- **Stack landing:** shipping ANY of this needs the user's go-ahead to land the parity foundations on `main`
  first (still deferred).
- **Deferred cleanup (pre-PR):** rebuild+commit P4's stale `compiler/dist`.

**Autonomous build work is complete pending those decisions.** Absent user redirect, further fires = hold +
light maintenance, NOT speculative gated building.

**fire#54 — HARDENING (unblocked, non-speculative):** launched an opus ADVERSARIAL AUDIT of the RS ambient
primitive (`ambient-audit-rs`) before it ships — the byte-identical `@sauce/token` proof is strong but that
module is simple/self-contained; the audit probes UNCOVERED edge cases (transitive ambient imports,
cross-ambient-module const refs, ambient⇄`defines` collision precedence, module-both-imported-and-ambient
dedup, ambient-fn-vs-transitively-imported-fn collision, cyclic ambient, `main` reached transitively,
unresolved-specifier `.expect()` panic-vs-clean-error, all-options-together). Throwaway probes, report
CONFIRMED-SOUND vs CONFIRMED-BUG; real bugs → fix + regression-lock next.

**fire#56 — AUDIT FOUND A REAL BUG (fix dispatched).** `ambient-audit-rs` ran 16 probes (14 pass, 2 fail).
**CONFIRMED-BUG (P3, fail-closed — never wrong bytecode, but rejects legal programs):** a user's explicit
`import { X } from "./m"` where `X` is ALSO ambient-broadcast is spuriously `Error::DuplicateFunction`,
violating "user code wins." Root cause: `inject_ambient_functions`/`inject_ambient_consts` populate
`own_tables`/`values.own` BEFORE `resolve_module_scope` resolves imports, so the import collides with the
ambient-injected name (assembly.rs ~1682-1694). Real impact: harness injects `@sauce/token` ambiently AND a
user also `import`s `transfer` → confusing compile error. The byte-identical `@sauce/token` proof couldn't
catch it (those tests never ALSO import the ambient name). **11 CONFIRMED-SOUND** (transitive-ambient-imports
not broadcast=correct; cross-ambient const ref; ambient⇄defines precedence=defines wins; cyclic=clean
ImportCycle; unresolved specifier=clean error, `.expect()` provably unreachable; dup specifier; reserved-name;
re-export rejected; …). **1 intentional-limitation:** transitive `main` through an ambient module loads as
dead code (fail-open, harmless — left as-is). **FIX DISPATCHED to `plugin-p1`** (branch
`plugin-token-ambient-rs`, squash into P3 at PR-prep): make ambient a fallback AFTER import resolution (inject
into the resolved `ModuleScope`, so a DECLARED or IMPORTED name wins), + promote probes 4/5 + a
different-module import-wins case as regression tests, remove the throwaway probe file. **This is exactly the
payoff of the plateau-hardening audit.**

- ⬜ **P6 [SDK]** compiler-selector seam (TS compiler *or* the #131 compiler-rs npm dep) feeding erased source +
  defines + inline contracts + ambient.
- ⬜ **P6 [SDK]** compiler-selector seam (TS compiler *or* the #131 compiler-rs npm dep) feeding erased source +
  defines + inline contracts + ambient.
- ⬜ **P7 [SDK]** chain-bundle activation (chain-scoping, Option B; nested Base/Optimism = nest cascade).
- ⬜ **P8 [SDK]** move address/token registries + ABIs → Layer-B data; both loaders derive defines/contracts.
- Stops at P8 with full DSL parity + ambient imports + chain-scoping; Rank-2 (`Ty::Named`) deferred.

---

## 🧭 NEW DIRECTION (USER, fire#42, 2026-08-22) — parity via a SHARED stdlib/DSL PLUGIN, not reimplementation

**User redirect (supersedes "port the DSL into RS"):**
- The cross-chain intent DSL **stays in the SDK repo** (TS source); it is NOT reimplemented in Rust.
- The SDK now **imports compiler-rs as an npm package** (#131/#344, recently released).
- Real parity lever = make **compiler-rs extensible with EXTENSION TYPES + a plugin stdlib**, then refactor
  the **standard library + the DSL into ONE plugin that BOTH compilers consume** → parity by construction,
  one source of truth, no duplicated Rust reimplementation. Builds on the standing `stdlib-injects-into-globals`
  constraint + the already-shared `@sauce/token` fixture.
- The base-language parity already landed (ctx/namespaces/Math/entry-decode/etc.) remains valid; this is the
  DSL/stdlib layer on top.
- **Design investigation IN FLIGHT (fire#42, opus):** characterize both compilers' current stdlib/type/import
  extensibility + the exact DSL extension-type surface → synthesize the shared-plugin architecture + a phased
  ATOMIC STACKED-PR plan (team preference). `wgnt0u4fj`.
- **PLUGIN-FORMAT CRITERION (USER, fire#43): "whatever is best for Rust/wasm."** compiler-rs ships as a
  wasm npm module, so the format must be wasm-friendly: favor a **DECLARATIVE, serde-deserializable manifest**
  (extension types + globals + signatures/lowerings, host-computed constants like keccak sigs / address
  registries BAKED IN at plugin-build time) over executing plugin code inside wasm. Pure-SauceScript stdlib
  fns (the `@sauce/token` model) can ride alongside as source each frontend compiles. Likely a hybrid LEANING
  declarative. I finalize the format on this criterion when the design lands (not on the synthesis's default).
- **REFINEMENT (USER, fire#45): "SDK-driven but integrated as an IMPORT feature."** The stdlib/DSL surface =
  SauceScript deps whose exports **inject into the GLOBAL namespace** ("ambient imports"), + a genuinely new
  capability: **CHAIN-SCOPED globals that ADD/REMOVE on entering/exiting a chain context** (`Base(() => {…})`
  → Base's USDC/UniswapRouter/addresses ambient inside the block, removed outside). Lands as a MIDDLE PATH:
  still SDK-driven for host logic + the fluent builder, but ambient-import + chain-scoping is a real COMPILER
  feature on BOTH sides (TS already injects stdlib→globals; RS needs a small "ambient import" addition on its
  Resolver). **Lighter than Rank-2: chain globals are consts + `Contract.at` wrappers, NOT `Ty::Named` nominal
  types.** Design IN FLIGHT (fire#45, `w4aqx9s5v`) — resolving the fork: (A) compiler parses+scopes the chain
  block vs (B) SDK fluent-builder erases each chain region into that chain's defines+ambient-imports before
  compile(). Chain ≈ a named BUNDLE of (defines + ambient-imports) the manifest declares, activated by name.
- ✅ **DESIGN DONE (fire#46, `docs/plans/ambient-import-chain-scope-design.md`): Option B, decisively.**
  Decisive runtime fact: a Sauce program is atomic on ONE chain in ONE tx → a single `main()` CANNOT execute
  cross-chain, so A's distinguishing case **has no runtime**; cross-chain = separate programs = the DSL's
  existing nest cascade. **The real NEW compiler feature = ambient imports** (`CompileOptions.ambient:
  Vec<String>` — exported consts ride the existing `inject_defines` channel, functions ride `assign_global_ids`;
  local/param shadows ambient; NOT new syntax). Chain-scoping = SDK per-region bundle selection (B). **No
  `Ty::Named`, no namespace registry, no grammar — entirely Rank-1.** FINALIZED 8-PR stacked plan:
  1.[RS] wasm expose defines+entry_arg_types · 2.[RS] inline-ABI contracts variant · 3.[RS] ambient-import
  primitive (NEW core) · 4.[TS] ambient-import parity (NEW core) · 5.[plugin] skeleton (@sauce/token as first
  ambient module + name-parity manifest) · 6.[SDK] compiler-selector seam · 7.[SDK] chain-bundle activation
  (chain-scoping, B) · 8.[SDK] registries→Layer B. Stops at PR8 with full DSL parity + ambient imports +
  chain-scoping; Rank-2 (Ty::Named/namespace registry) stays deferred. Confirm crux: each chain region = a
  SEPARATE atomic program (how the DSL already works) → validates B. **Awaiting go-ahead to start PR-1.**
- **PR-slicing note (from the fire#42 inventory):** TS `feat/compiler-parity` (73 commits) is tangled — 12
  inherited `routes:` DSL commits (stay SDK-side per this redirect) + ~8 TS-code + ~49 docs; based on
  `feat/xchain-intent-dsl`, needs isolating onto main. RS `feat/compiler-parity-port` (31 commits) is clean
  code-only (drop the V4 reject→revert pair; group fixtures with features) → ~15 atomic PRs.

## 🧭 (history) fire#41 — base-language parity COMPLETE, GREEN, CI-CLEAN, FULLY OPUS-REVIEWED

**fire#41: verification discipline COMPLETE.** NS-10 opus-reviewed **CONFIRMED-SOUND** (8 real-engine hostile
probes: two-level offset math correct, 5 guards correctly ordered, wrap→OOG/inverted-SLICE-revert never OOB,
offset-aliasing bounded, Array<Array<ScalarTuple>> decodes, Array³/Array<Bytes> rejected). **Now EVERY
compiler-code change this session is opus-reviewed CONFIRMED-SOUND** (V4 fix+revert, PR-8/9, PR-4, PR-2, PR-3,
PR-11, PR-14, NS-1/2/3/5/7/8/10, .catch, ArgShape, + the regression fixes). Optional non-blocking hardening
noted by the review (shared with NS-8/fixed-stride, not NS-10-specific): make the wrap-to-OOG defense an
explicit pre-cap magnitude check; cap aggregate nested allocation. Not actioned (would touch all three decode
arms; out of scope).

**FINAL DELIVERABLE:** two clean feature branches, both `make ci`-clean (branch-introduced fmt+clippy drift
fixed), UNMERGED:
- `feat/compiler-parity` (TS) — Part 1 complete, suite green.
- `feat/compiler-parity-port` (RS) — Part 2 complete, full workspace 0-failed (20 binaries) + every feature
  opus-reviewed; unrolled eco-swap north-star compiles + real-EVM-verified.
Full-recipe stretch at its sound boundary: NS-7/.catch/ArgShape/NS-8/NS-10 done+reviewed; NS-9 (last blocker)
DEFER-ARCHITECTURAL with a ready 3a/3b build sketch. All divergences in the compiler/README registry.
**The program is DONE. Open moves are the user's: open PRs / merge · mandate NS-9 · pivot.**

## 🧭 (history) fire#40 — full-recipe stretch at its sound boundary; branch make-ci-clean

**fire#40 CONCLUSION — full-recipe stretch taken as far as is sound; NS-9 is the principled STOP.**
- ✅ **NS-10 landed** (nested-array entry decode, 8/8 real-engine) → routing decodes; full recipe now blocks ONLY on NS-9.
- ⏸️ **NS-9 = DEFER-ARCHITECTURAL** *(opus design fire#40, `docs/plans/rs-NS9-helper-tuple-param-design.md`)*. NS-10
  cleared the TYPE side (the arg is now a concrete monomorphic `Ty::Tuple(12)` from `qlv[v]`), but the residual
  is a **signature-resolution phase inversion** (RS resolves all signatures before any body; the call-site arg Ty
  only exists during body lowering). Every SOUND fix needs a two-pass-discovery or caller-first-reorder restructure
  of the central all-target pipeline (L, regression-risky vs a fully-green workspace, for ONE fixture); the tempting
  M shortcut (AST arg-tracer) is **silently unsound** (`qd` aliases `Tuple(12)` and `Tuple(24)` across scopes).
  Per fire#37's stop-if-untenable rule, this crosses the line. Ready 3a/3b sonnet sketch documented for a future
  hard product requirement. `full_ecoswap_sauce_ts_compiles_on_the_evm` stays `#[ignore]`d (the honest tracker).
- ✅ **Branch make-ci-clean (all BRANCH-INTRODUCED CI issues fixed):** clippy 6→0 (`0ada5c9ca`, allow
  too_many_arguments on pipeline fns + collapsible_if), nightly fmt 67→0 (`235902bbf`; origin/main was clean →
  drift was branch-introduced by agent hand-edits). test 0-failed; cargo-sort clean-by-construction (Cargo.toml/lock
  byte-identical to main); check-wasm fails LOCALLY only on third-party deps (identical deps to main = env, not
  branch). Residual env caveats (not branch defects): nightly rustfmt here skips `imports_granularity`/`group_imports`
  (verify import order in CI); sort-derives unverifiable locally. **LESSON (locked): the RS gate is `make ci`
  (fmt+clippy+test+sort+wasm), NOT `cargo test` alone — this session found fmt+clippy branch drift the unit gate missed.**

## 🧭 (history) fire#37 — pursuing full-recipe stretch (ultracode)

**fire#37: RESUMING the full-recipe stretch (NS-10 → NS-9) under ultracode + the standing eco-swap-north-star
directive.** The plan is complete + green + opus-reviewed (below), but the FULL non-unrolled `ecoswap.sauce.ts`
is the named top target and ultracode says pursue exhaustively. opus had scoped NS-9/NS-10 as DEFER (build
only if a hard requirement); treating the repeated standing directive as that signal. Discipline preserved:
**design-first** (opus) each — if a design shows genuinely untenable architectural risk (esp. NS-9's
signature-resolution phase inversion), STOP with it documented rather than force it. Order (per opus scope):
**NS-10 first** (nested-array `Array<Array<Scalar>>` entry decode — reuses NS-8's offset-table skeleton;
prerequisite for NS-9's typed rows) → **NS-9 monomorphic** (call-site param-shape propagation; skip true
generics — the recipe is monomorphic). 📐 **NS-10 DESIGNED (fire#38 opus, `docs/plans/rs-NS10-nested-array-design.md`):
BOUNDED — smaller than NS-8** (M). Reuses NS-8's offset-table skeleton + the existing fixed-stride array arm one
level in — NO new IR node/codegen/ArgShape variant (recursive `ArrayOf`+`to_ty` already build `Ty::Array{Array{Scalar}}`);
read side already lowers. Work = 1 `entry_collection_decode` branch + 3-line `require_decodable_entry_param` widening
(narrow escape hatch; fails closed for Array³/Array<Bytes>) + flip the `an_array_of_arrays_is_still_not_yet_decodable`
test to admission + a real-engine conformance vector. Scope: **only `routing` needs it** (runtime inner index
`rt[1+5*L]` + variable inner length); pools/netCache/segs/qlv stay ScalarTuple. ✅ **BUILT** *(RS 165c3661c,
fire#39 sonnet)* — 1 decode branch + admission hatch (fails closed for Array³/Array<Bytes>); **8/8 real-engine
conformance** (runtime `x[i][k]`, per-row+outer `.length`, cap/missing-table/truncated-row/truncated-len reverts);
full workspace 0-failed. **Full-recipe re-probe: routing now decodes** — the recipe progresses PAST NS-10 and
fails ONLY on NS-9 (`eulerNeedsLive(qd: Tuple)`, the last blocker), as predicted. 🔎 opus review pending.
- 🆕 ⚠️ **CI-lint gap (fire#39): `cargo clippy -D warnings` (part of `make ci`) has 6 errors** — `too_many_arguments`
  on `program` (9/7) + `lower_function` (8/7) (pushed over by the parity `defines`+`entry_arg_types` threading =
  branch-introduced) + a `collapsible_if`. Test-green ≠ CI-green. **sonnet clippy-fix lane → `make ci` lint clean.**
  LESSON extended: the true RS gate is `make ci` (fmt + clippy + test + cargo-sort), not just `cargo test`.

## 🧭 (history) fire#36 — ✅ COMPLETE, GREEN, & OPUS-REVIEWED

**Regression audit CLOSED (fire#36): the 3 compiler-code fixes are opus-reviewed CONFIRMED-SOUND** (no
defects). V4-revert verified by real-engine execution of every nested-array shape (multi-element/deeply-nested/
`.length`/nested-set-index/replace-whole-inner all correct; ragged + call-arg fail closed); call-fold two-phase
is convergent/terminating/idempotent and perturbs no other bytecode; swap_supply 1624 is a bisect-confirmed
sound NS-5 dead-local drop. Divergence registry updated (`eaf498f`, nested-array = engine-lineage). Optional
non-blocking hardening noted: a swap_supply execution harness (currently canary-only) + tightening NS-5's CI
scope so a canary-program byte change can't pass a suite excluding example_programs.rs.

**FINAL STATE:** ✅ plan complete (Part 1 + Part 2) · ✅ unrolled north-star compiles + real-EVM-verified on
BOTH compilers · ✅ full RS workspace `cargo test --workspace --no-fail-fast` 0-failed (20 binaries) +
opus-reviewed · ✅ decisions 0.3–0.7 resolved · ✅ dynamic-kind correctness locked · full-recipe stretch
explored to its architectural boundary (NS-7/`.catch`/ArgShape/NS-8 ported+reviewed; NS-9+NS-10 deferred
with scope) · all divergences in the compiler/README registry. **Absent new user direction, the program is
DONE — further fires = optional hardening/maintenance only.**

## 🧭 (history) fire#35 — full workspace green (regression audit resolved)

**✅ RESOLVED (fire#35): the full RS workspace suite is 0-failed across all 20 test binaries** (orchestrator
re-verified `cargo test --workspace --no-fail-fast`: no result line has non-zero failures; tree clean at
`5b5497c54`). All 19 branch-introduced failures the audit found are fixed: 14 obsolete fixtures updated to
the NAC idiom (7 v12 `2cec056e` + 7 svm `e188d17e`; PR-14 call-fold correctly folds the old helper trick),
V4 nested-array rejection reverted on RS (`33d67a571`; RS engine supports them), call-fold made symmetric
(`69211f071`; ECO-2076 byte parity), swap_supply byte count 1872→1624 (`5b5497c5`; NS-5 balancing-drops
legitimately shrink it — bisect-confirmed, not a miscompile). 🔎 **opus review of the 2 compiler-code fixes
(V4 revert + call-fold symmetry) IN FLIGHT.** README divergence registry: V4 → engine-lineage (TS rejects
nested arrays / RS accepts). *Below: the audit history that got here.*

## 🧭 (history) fire#32 — ⚠️ CONFORMANCE-REGRESSION AUDIT

**⚠️ CORRECTION (fire#32): "complete/all-green" was premature.** The agreed gate (`cargo test -p sauce-core`)
is green, but the BROADER real-engine suite **`make test-conformance-evm` has 11 failures in `v12_conformance.rs`**
(10 "source compiles: compilation failed" on tests that expect COMPILE+runtime-revert — `arithmetic_overflow_reverts`,
`division_by_zero_reverts`, `exponentiation_overflow_reverts`, `math_{addmod/mulmod,muldiv_by_zero,muldiv_overflow,
signed_division_by_zero}_reverts`, `array_length_evaluates`, `set_index_stores_an_array_element`,
`nested_set_index_mutates_the_inner_array`; + 1 bytecode mismatch `an_imported_module_const_compiles_to_the_same_bytes`).
**opus diagnosis DONE (fire#33):** all 11 are **branch-introduced** (verified: 11/11 PASS on origin/main via
temp worktree; test bodies byte-identical). Verdict **MIXED — 7 fixture-updates + 4 GENUINE REGRESSIONS**:
- **7 arithmetic/math = FIXTURE-NEEDS-UPDATE** (culprit PR-14 call-fold `cdb734536`): fixtures routed the
  overflow/÷0 operand through a pure helper to keep it "runtime"; call-fold now correctly inlines it → the
  fold guard correctly rejects the provably-constant ÷0/overflow. Compiler right; update fixtures to the
  declare-then-reassign (NAC) idiom so the operand reaches the runtime guard.
- **3 array = GENUINE REGRESSION** (culprit **V4 `c861b09d`, landed fire#3**): nested array literals
  `[[..],[..]]` EXECUTE CORRECTLY on RS's real Huff v12 + SVM engines (empirically probed; both conformance
  twins green on origin/main). V4 imported a TS-pin-specific limitation that does NOT apply to RS's newer
  engine. **FIX: revert V4 on RS only** (remove the guard + enum variant + rejection test; restore the
  fixture) — keep TS's V4 (correct for its release/beta pin) → an ENGINE-LINEAGE divergence, not a shared bug.
- **1 imported-const byte mismatch = GENUINE REGRESSION** (culprit PR-14): call-fold folds a module-const
  callee but not a function-local-const callee (2-stmt body), breaking the ECO-2076 byte-parity invariant.
  **FIX: make call-fold symmetric** — fold bodies FIRST, then build the foldable-callee table from folded
  bodies (a local `const x; return x/2` collapses to single-return and becomes foldable too).
- **sonnet fix lane (fire#33): v12_conformance now 188/0** (`2cec056e` fixtures + `33d67a571` V4-revert-RS +
  `69211f071` call-fold symmetry); svm nested-array twins 3/3 on a fresh engine.so. **BUT a full workspace
  `cargo test --no-fail-fast` (fire#34) found 8 MORE branch-introduced failures NOT in v12_conformance:**
  (a) **7 svm_conformance arithmetic** = the SAME obsolete-fixture class (PR-14 call-fold) in the svm copy
  CLASS A didn't touch → mechanical NAC-idiom fix; (b) **`swap_supply_compiles`** (example_programs.rs /
  FAST_INTEGRATION) byte drift 1872→1624 — passes on origin/main, failed ~3 commits before the fix work, so
  a branch commit made it compile SMALLER (more folding); execute-verify → update the byte-count fixture if
  the smaller output is functionally correct, else it's a regression. Fixing both (sonnet) → full-workspace
  gate. **Lesson: gate on the FULL suite (`cargo test --workspace --no-fail-fast`), not per-suite subsets.**



**CONCLUSION (fire#31):** The parity **plan is complete** (Part 1 + Part 2, no open ⬜ plan items), the
**designated unrolled north-star compiles + real-EVM-verifies on both compilers**, and the self-chosen
**full production `ecoswap.sauce.ts` stretch is explored to its architectural boundary** — 4 of its 6
blockers ported + opus-reviewed CONFIRMED-SOUND (NS-7 destructuring, `.catch`, ArgShape::Struct, NS-8
bytes[]); the last 2 (NS-9 call-site param inference + NS-10 nested-array decode) are **interlocking
architectural features beyond the plan**, DEFERRED with an opus-scoped build recipe (build only if full
non-unrolled parity becomes a hard product requirement). Every landed unit is green + gate-verified; all
divergences are in the compiler/README registry. **Absent new user direction, the substantive program is
done** — further fires are hardening/maintenance only.



**🎉 North-star CLOSED:** `ecoswap.unrolled.sauce.ts` (verbatim) compiles on BOTH compilers — TS
(v1/v12) and compiler-rs (EVM) — from the same SauceScript. RS acceptance test green.

**✅ Part 1 (RS→TS backport) — COMPLETE.** §1.1–1.9 all landed (ctx.*, evm/svm namespaces incl.
tload/tstore, annotation storage-kind, reserved-name narrowing, Math.* signed/modular, emit()→library,
divergence registry, target-gate matrix, push-order parity table, TS-subset docs). §1.10 cache =
❎ investigated, not worth building (T-CACHE data).

**✅ Part 2 (TS→RS forward-port) — MAJOR FEATURES DONE.** V4 nested-array guard, PR-8/9 loop unrolling,
PR-4 defines, PR-2 uint(), PR-3 evm.tload/tstore, PR-11 lookup tables, PR-14 same-file call fold; the
north-star series NS-1 (Tuple params) / NS-2 (address.*) / NS-3 (Math.neg) / NS-5 (codegen liveness).

**✅ Decisions 0.3–0.7 all resolved.** (0.7 = keep base shared-scope, in the divergence registry.)

**UNROLLED north-star: COMPLETE.** The designated parity target `ecoswap.unrolled.sauce.ts` compiles on
both compilers; every gap IT needs is closed (through PR-13), decisions resolved, dynamic-kind locked.

**⚠️ CORRECTION (fire#20 capstone): "all gaps closed" was premature for the FULL recipe.** Probing the
full `ecoswap.sauce.ts` (non-unrolled) on RS/EVM found it aborts at frontend lowering with 147 unsupported
constructs = 36 multi-output-call destructurings + 111 `.catch()`. The unrolled variant AVOIDED destructuring
(used indexed `call()[0]` reads), so this GAP was invisible until the capstone. Remaining for the FULL recipe:
- ✅ **NS-7 multi-output-call destructuring** *(RS 8853a075b, fire#21)* — `const [a,b]=call()` frontend
  carve-out + declarator desugar to a fresh Ty::Tuple temp + N constant `Expr::Field` projections (ONE call).
  Confirmed "Shape B" (temp-bind + index) round-trips on RS with no v1-style raw-temp workaround. Rejects
  non-call/object/nested/rest destructures + single-output + over-arity cleanly. 7 tests incl. end-to-end
  getReserves(); RS gate 1080. First full-recipe blocker CLEARED.
- ✅ **PR-5 `.catch()` EVM half — LANDED + REAL-ENGINE VERIFIED** *(RS 16bac1983, fire#23; sonnet build)*.
  `Opcode::Catch`=0xB7 + `Stmt::TryCall{call,handler}` through all ~11 exhaustive Stmt passes + frontend
  carve-out (zero-param arrow, block body, discarded stmt) + lowering (handler in enclosing scope = closure
  capture) + codegen (`<call> CATCH <len:1> <handler> DROP`, in-place length patch, stack-neutral assert).
  **Real-EVM conformance ACTUALLY RAN (orchestrator re-verified): 2/2 green on the real Huff runtime** —
  reverting call runs handler (ok=0), succeeding call skips it (ok=1), stack reconciled. Core gate 1090+
  (4 catch integration + 2 conformance in sauce-cli). SVM = clean compile-time refusal (locked). ✅ **opus
  adversarial review (fire#24): CONFIRMED-SOUND** — attacked from the engine side (Calls.huff), verified the
  load-bearing invariant (CATCH must directly follow the CALL op; `strip_to_evm_call`+`eval_order` both
  preserve it) and single-DROP stack discipline for scalar/dynamic/multi-output calls + probe-then-branch +
  sequential catches + empty handler, all on the real engine. No defect. 🟡 Flagged a COVERAGE gap (not a
  bug): the committed conformance only executes the scalar handler — the 99× probe-then-branch idiom + 12×
  empty handler aren't execution-tested → sonnet test-hardening lane. ✅ **HARDENED** *(RS 1142c7275, fire#27
  sonnet)* — +8 real-engine conformance tests (probe-then-branch both paths, empty handler both paths,
  dynamic-return + multi-output both paths, using the real forge-built MockTarget), 10/10 green on the real
  Huff runtime. **Also fixed a genuine CI gap:** `catch_conformance.rs` was never in the Makefile's
  `EVM_INTEGRATION_TESTS` (ran in NO CI job) — now wired. **`.catch()` EVM is DONE: built → opus-reviewed
  CONFIRMED-SOUND → hardened → CI-locked.** Deferred: handler param `(e)=>`, stack-changing handlers, `.catch`
  on svm.call/raw calls (clean errors). *(was: DESIGNED fire#22 — bounded M, no novel primitive needed:)*
  RS's forward-emit +
  fixed-width-placeholder-patch (the `if`-arm mechanism) already emits an inline handler; `CATCH` (0xB7)
  + a 1-byte length patched in place is the whole codegen. Handler surface is trivially narrow (all 111
  sites = zero-param arrow, discarded statement; 99× `() => { local = 0; }`, 12× empty). Work = 1 opcode +
  wire `Feature::TryCatch` (EVM-only) + `Stmt::TryCall` through ~11 exhaustive-match passes (shallow) +
  frontend carve-out + narrow lowering. **The one real risk (CATCH stack contract) MUST be verified on the
  real EVM engine** — build lands it behind a real-engine conformance gate; if unverifiable, ignored (not
  trusted), like NS-5's acceptance test was. SVM = compile-time refusal (permanent divergence, more honest
  than TS's laxer svm CATCH which only catches pre-flight CPI failures — recorded in the registry).
- 📐 **NS-1 extension: nested/named `ArgShape` — DESIGNED (fire#26 opus, `docs/plans/rs-argshape-nested-design.md`).**
  Confirmed from source: `Ty::Tuple` already carries field names + the read side (named `.field`, nested
  `Expr::Field`) already works — the gap is ONLY the public `ArgShape` descriptor. TWO sub-fixes: (a)
  **ArgShape::Struct(Vec<(String,ArgShape)>)** variant + one `to_ty` arm [S]; (b) **nested-tuple entry
  decode** — `element_words`/`require_decodable_entry_param` must recurse [M]. Design gives cfg's exact
  15-field shape (14 scalars + `chain` nested 7). ✅ **DONE + verified** *(RS 35c20200e, fire#30 sonnet)* —
  `ArgShape::Struct` variant + recursive nested-tuple decode (element_words recurses; entry decode flattens
  nested tuples with an offset-correctness test); nested Field-by-name resolution unit-verified. ✅ opus review CONFIRMED-SOUND (fire#31, real-engine-probed the nested decode itself).
- 📐 **NS-8 `rfqSigs: bytes[]` entry decode — DESIGNED (fire#28 opus, `docs/plans/rs-NS8-bytes-array-design.md`):
  revised M (not L), BUILD IT.** No `ArgShape` change (`ArrayOf(Bytes)` already lowers to `Ty::Array{Bytes}`);
  the recipe only INDEXES a bytes element + forwards it verbatim (no `.length`/`abi.decode`/`ecrecover`), so
  the element value is ONE `Expr::Slice` and the read side already works. Fix = 3 fns in `assembly.rs`:
  admit `Array{Bytes}` in `require_decodable_entry_param`, + a `bytes[]` OFFSET-TABLE decode branch in
  `entry_collection_decode` (reusing the array-of-tuple `ArrayOfLength`+`Loop`+`SetIndex` skeleton). Caveat:
  dynamic-element decode → **real-engine verification required**. ✅ **BUILT** *(RS fc4cde882, fire#29 sonnet
  — DONE + REAL-ENGINE VERIFIED)* — `Array{Bytes}` admission + offset-table decode branch. **Conformance 4/4
  on the real EVM engine** (unequal-length elements byte-exact by constant AND runtime index; cap revert;
  table-present guard), CI-wired. ✅ opus review CONFIRMED-SOUND (fire#31; admission correctly narrow — Array{Bytes} does not leak to Array{Array}).
- ⏸️ **NS-9 + NS-10 — DEFER-ARCHITECTURAL (opus scope, fire#31): the full-recipe stretch STOPS here.**
  These two are INTERLOCKING architectural features, not port-bounded cleanups, and both are needed to move
  the full recipe: **NS-10** (nested-array `Array<Array<Scalar>>` entry decode + runtime `.length`/index →
  Tuple rows; routing/pools/segs/qlv are arrays, route rows runtime-indexed `rt[1+5*L]`) is a NEW entry-decode
  + array-ops feature (M-L), and is a **hidden prerequisite of NS-9** (a helper's `qd: Tuple` only types if
  `qlv[v]` yields a Tuple row); **NS-9** (call-site param-shape propagation for a non-entry `Tuple` param —
  the known "no per-call-site parameter-kind inference" gap CLAUDE.md documents) is a **signature-resolution
  phase inversion** (L). Recipe is monomorphic (skip true generics). **Recommendation ACCEPTED: do NOT chase
  full-recipe green as part of this parity effort** — build only if full non-unrolled ecoswap parity becomes
  a hard product requirement (then NS-10 first, NS-9 monomorphic on top). Captured; `#[ignore]`d acceptance
  test (RS `3d454f996`) is the tracker.
- 📌 **SDK-lane note (opus review F3):** if the full recipe is ever RUN (not just compiled) on RS, the SDK's
  `buildSolverArgs` must OFFSET-INDIRECT the fully-static `cfg` tuple (RS entry decode gives every main param
  one head word read as a collection offset; a plain `encodeAbiParameters` would inline a static tuple → the
  first word would be a value, not an offset → garbage decode). Not a compiler bug; an SDK-encoder contract.

Long-tail detail (unrolled-north-star items):
- ✅ V1 dynamic-kind adversarial audit *(RS 20957d1ab, fire#16)* — all 7 K-bug shapes verified
  STRUCTURALLY IMPOSSIBLE on RS (dynamism = a structural `Ty::is_dynamic` property + annotation-authoritative
  return types + `same_shape` reassignment rejection; no scalar/heap-slot decision exists). 11 lock-tests
  (incl. shape 6, the v1-only call-arg revert — clean on RS's uniform one-word calling convention). No defect.
- **TRIAGED (fire#17, `docs/plans/rs-longtail-triage.md`):** ➡️ **PR-13 `new Array(n)` = PORT (S)** — NOT
  big: it's frontend-only SUGAR onto RS's EXISTING `Expr::ArrayOfLength`+`SetIndex`+`Index` runtime primitive
  (already conformance-tested for entry params). The FULL eco-swap recipe (`ecoswap.sauce.ts`, not the unrolled
  variant) uses it 96× → real parity value. ✅ **DONE** *(RS 94e11b03a, fire#18)* — pure frontend sugar
(new `check_new` + `new_array` lowering to `Expr::ArrayOfLength{Scalar, len}`), no new IR/opcode/gate;
RS accepts a RUNTIME len (strict superset of TS's const-only fold). EVM golden executes (returns 2n on
the real Huff runtime); 5 unit + 2 conformance tests; RS gate 1075. · ❎ **PR-15/16 inline = DIVERGENCE** (RS
  real functions + PR-14 call-fold cover the semantics + perf; splicer is TS-only ergonomics). · ⛔ **PR-5
  try/catch = DEFER** (L; needs frontend closure carve-out + new IR node + `CATCH`-opcode inline-handler
  primitive; **SVM half is a HARD divergence** — `Feature::TryCatch` is EVM-only by construction). · ❎
  **PR-12 for…of = DIVERGENCE** (indexed `for` + the PR-9 unroller cover it). All three registered in the
  compiler/README cross-compiler divergence table.
- ⬜ V2/V5/V6 verification lock-tests (extra hardening).
- ⬜ PR-4 SDK/wasm arg-encoder (to RUN, not just compile, eco-swap on RS) — optional, downstream.
- ⬜ account-model reconciliation (svm accountData trio freestanding) — a documented divergence.
- 🟡 CAPSTONE (fire#18): probe whether the FULL `ecoswap.sauce.ts` (non-unrolled, 96 `new Array`)
  compiles on RS now that PR-13 landed — a bonus beyond the stated north-star (the unrolled variant).

---

## Working agreements

- **Branches.** TS work → `feat/compiler-parity` (in `sauce-sdk`, off `feat/xchain-intent-dsl`).
  RS work → `feat/compiler-parity-port` (worktree `../sauce-compiler-rs`, tracks `origin/main`).
  Per-feature sub-branches; merge to the lane branch **on green**.
- **Gates.** TS: `pnpm --filter './compiler' test` (43 unit + 31 integration). RS: `make ci`
  (fmt-check, clippy, test, cargo-sort, sort-derives, wasm check) in `../sauce-compiler-rs/compiler`.
- **TDD / test-borrowing.** RS→TS: port compiler-rs `#[test]`s + fixtures into TS jest. TS→RS: port
  TS jest fixtures into RS `#[test]`/conformance. A ported test drives the feature red→green.
- **North-star fixture.** `../sauce-recipes/ecoswap/ecoswap.unrolled.sauce.ts` must keep compiling
  through BOTH compilers (same SauceScript; different bytecode is expected). OK to modify eco-swap as
  the TS compiler evolves (user-authorized).
- **Standing constraints.** [[no-ai-attribution]] · [[commit-incrementally-directive]] (commit each
  unit on green) · **stdlib-injects-into-globals** (plan intro) · engine pin stays `release/beta`.
- **Model routing (USER, fire#23 + ultracode ON).** Workflow lanes: **opus = design + review/verify**,
  **sonnet = implement** (pass `model:'opus'` / `model:'sonnet'` in `agent()` opts). Ultracode: Workflow
  on every substantive task, exhaustive, **adversarially verify** — every sonnet implementation gets an
  opus review lane before it's trusted (esp. anything with a real-engine/soundness risk).
- **Status keys.** ⬜ TODO · 🟡 WIP · ✅ DONE · ⛔ BLOCKED · 🔍 AUDIT-NEEDED · ❎ WON'T (out of scope).

## ⚠️ Corrected baseline (2026-08-19)

The plan/delta pinned RS at `431f9ce`; **`origin/main` is far ahead** (`a8efa59c`, dir renamed
`compiler-rs/`→`compiler/`). From the RS README divergence registry + CLAUDE.md, the RS compiler has
ALREADY shipped much of Part 2. **Do not port what already exists** — the re-baseline (EPIC-0 T0)
must confirm per-PR status against `origin/main` before any Part 2 coding. Known-landed in RS:
`ctx.*` (M3.6), `evm./svm.sload/sstore` (ECO-1866), `evm./svm.call/static/delegate` (ECO-1969/2022),
one-builtin `log(data,…topics)` (ECO-2075), `eval` (ECO-2090≈PR-18), capability/Feature gates, `bool`
type (ECO-2109), libraries + external contracts, `@sauce/token` both arms, tuple projection
(#292≈0.5). ⇒ Part 2's real remaining gap is concentrated in **partial-eval (Wave 2)** + **inline
(Wave 3)** + a few Wave-1 stragglers + the per-function cache (PR-6b). Confirm via T0.

---

## EPIC-0 — Audits & decisions (Part 0) — *gates everything*

- ✅ **T0. Part 2 re-baseline vs `origin/main` RS.** DONE (fire#2) — folded into EPIC-2 above.
- ✅ **T0.1 (0.1). fold.rs scope-model audit.** DONE — RS fold **structurally immune** (no name
  resolution; runs on IR keyed by `LocalId`; scope resolved once in lowering with nested block scoping;
  `known` map sound by assigned-once + no-slot-reuse invariants, `fold.rs:138-159`). ⇒ **PR-7 reduced**
  to (a) land 5 immunity-lock fixtures, (b) surface the divergence below as a parity decision.
- ✅ **T0.2 (0.2). codegen classify.** DONE — A6/A7/A8 = PARTIAL-diff-mechanism / ABSENT / ABSENT
  (no compile-time args). G1–G24 mostly PARTIAL-re-architected or MOOT (G8/G10 v1-only). No pure
  "port me" gaps; genuine remaining work is engine-lineage-independent only.
- ✅ **0.3 ctx.\*** — DECIDED: adopt single `ctx.*` root (RS already ships it; RS = 7 methods).
- ✅ **0.4 reserved-names** — DECIDED: RS narrower rule. Oracle: **function-names** reserved =
  `{revert,require,log,eval}` (NOT emit); **binding-names** reserved = 6 roots `{abi,crypto,ctx,Math,
  evm,svm}` (`lower/mod.rs:2106-2208`).
- ✅ **0.5 destructuring** — DECIDED: adopt tuple projection (RS #292), KEEP TS `K10` spelling.
- ✅ **0.6 emit()** — DECIDED: library, not builtin (consistent w/ stdlib-injects-into-globals).
- 🟡 ⚠️ **0.7: block-scope vs shared-scope for `if`/`while` bodies** — **PROVISIONALLY RESOLVED (fire#6,
  autonomous, fail-safe, REVERSIBLE on user call).** RS **block-scopes** them (a `let` inside a branch
  is dropped at branch end); base/TS **shares** scope (the `let` persists as the same variable). So
  `const FEE=100n; f(cond){if(cond){let FEE=5n;} return FEE}` → RS resolves `100n`; TS keeps a runtime
  read. A genuine **language-semantics divergence**, not a bug. **Autonomous ruling: KEEP base
  shared-scope; record the divergence in the cross-target registry** (§1.2 mechanism) rather than
  converge. Rationale: converging TS→block-scoping would change the semantics of EXISTING SauceScript
  across the whole SDK protocol registry + recipes (a wide, risky base-language change), which is
  exactly the kind of outward-facing/hard-to-reverse change to defer to explicit approval. Every TS
  pass already guards for shared-scope correctly (this session's fixes), so the status quo is sound and
  costs only the (documented) divergence. **User can still choose convergence** — my standing rec is
  converge (real TS semantics) — but nothing in Parts 1/2 is blocked by keeping the status quo (§1.5
  annotations are orthogonal to scope). Flagged in the divergence registry as a KNOWN, INTENTIONAL diff.

## EPIC-1 — TS backport (Part 1): make TS resemble RS

- 🟡 **1.1** Declare SauceScript a TS subset; demote plain-acorn path. *(250efd8, fire#12)* — landed the
  normative "SauceScript is a strict subset of TypeScript" statement in compiler/README.md (ts-frontend =
  primary path; plain-acorn = legacy core everything lowers to; `tsSource` = per-call-site opt-in, default
  false — a bare `compile(src)` deliberately keeps byte-stable acorn behavior). The plain-acorn-default
  FLIP was audited (verdict with the round result) — NOT flipped (bytecode-pinned callers). Docs-only, no
  code/gate risk.
- ✅ **1.2** Divergence-resolution rule + cross-target divergence registry in `compiler/README.md`.
  *(c90be5b — normative rule + seeded EVM/SVM/v1 registry, mirrors RS README)*
- ✅ **1.3** `evm.*`/`svm.*` namespace split in `globals.ts`. *(8e1b7ad, fire#4)* — `gatedAlias(feature,
  targetDef)` asserts capability FIRST then delegates to the existing `storage.*`/`contract.*`/`accountData`
  lowering → byte-identical, target-gated. `evm.{call,static,delegate,sload,sstore}` (EVM-only),
  `svm.{sload,sstore,call}` (svm-only; `svm.call` reorders RS's `(program,accts,data)` → TS's
  `(target,data,accts)`). 8 new capability rows; storage.*/contract.* kept UNCHANGED as aliases. +26
  tests (byte-equality + RS-borrowed target-mismatch rejections); suite green (1789). 🟡 **§1.3 deferred:**
  `svm.remainingAccounts`/`remainingAccount` (need ECO-1860 typed-Account model TS lacks); `svm.call`
  Account[]-shape parity; `evm.tload/tstore` (RS has none yet — TS keeps `storage.tRead/tWrite`).
- ✅ **1.4** Unified `ctx.*` context namespace (additive; keep `msg`/`block`/`tx`/`address`).
  *(7bd13ff, fire#3)* — matched the RS oracle exactly: **7 CALL-form methods** (`ctx.msgSender()`,
  `ctx.self()`, `ctx.chainId()`, `ctx.blockNumber()`, `ctx.timestamp()`, `ctx.selfBalance()`,
  `ctx.balance(addr)`); `self` is a METHOD (not the `address.self` property), and `gasPrice`/`origin`
  are excluded (RS raises CtxUnknownMethod). Each aliases the existing spelling → byte-identical on
  v1/v12/svm. Nullary members carry the ignored args param so `compile.length!==1` (routes via the
  call path; bare `ctx.foo` fails closed). Adds `ctx` to `RESERVED_NAMES` (executes part of 0.4).
  15 tests; full suite green (1738). *NB: the earlier fire#2 "property spelling" map was superseded
  by the RS audit — RS is call-form.*
- ✅ **1.5** Annotation-driven storage kind *(e955d79, fire#7)* — opt-in explicit scalar/dynamic
  annotation on the `.ts`/`.sauce.ts` path, captured in the ts-frontend from the PRE-strip tree and
  threaded out-of-band (same channel shape as `wideReturnArrays`), with a heuristic cross-check that
  errors on disagreement. Vocabulary borrowed from RS `annotation_ty` (Uint256/Address/Account/bool/
  number→scalar; bytes/string/T[]/`{...}`→dynamic). Byte-identical when no annotation present; ambiguous
  same-name bindings dropped from cross-check. 8 tests; suite green (1819). *(CI format:check drift in 3
  earlier-fire test files fixed in 96614bc.)*
- 🟡 **1.6** One `Feature`×availability matrix. *(05d2360, fire#8)* — consolidated the PURE target-gates
  (class A: unconditional "feature X unavailable on target Y") into `capabilities.ts` + one assertion
  helper (touched capabilities.ts + collection.ts). Value-shape-conditional K-guards (class B:
  `assertNoDynamicVariableObjectField`, `rejectV1ScalarToDynamicReassignment`, …) deliberately left
  separate + documented — they are NOT target gates; moving them would risk the K-bug family.
  Behavior-preserving (suite byte-identical, 1819). ⬜ class-B unification remains out of scope by design.
- ✅ **1.7** State push/emission order once. *(3e10367, fire#8)* — a clean emitter consolidation wasn't
  possible without bytecode risk (v1 prefix vs v12 postfix, fused sentinel/stackEffect bookkeeping), so
  per the conservative directive landed the blessed fallback: `test/push-order.parity.test.ts` — a single
  18-row ORDER table + 56 tests that read operand order back out of finished bytecode (can't silently
  drift) and pin it against RS `push_order.rs` rules. Confirms v12 agrees with RS except `setIndex`
  (release/beta-vs-main engine wire divergence, documented). Suite 1875.
- ✅ **1.8** Reserved-name policy (executes 0.4): narrow the BINDING rule. *(bb4fb0b, fire#3)* —
  split into `RESERVED_BINDING_NAMES` = {abi,crypto,ctx,Math,evm,svm} (the RS narrow set, used at
  `setVar`) vs the broad `RESERVED_NAMES` (kept for CALLABLE decls — TS's freestanding-builtin surface
  is wider than RS's, so `function gasLeft(){}` etc. must still be blocked to avoid silent shadowing).
  Closes the RS→TS binding compat gap (`let block = 1n;` now compiles). +25 tests; suite green (1763).
  🟡 **§1.8 follow-up:** narrowing the FUNCTION-name set to RS's {revert,require,log,eval} is deferred
  (needs TS call-resolution analysis; low value — `function msg(){}` shadowing).
- 🟡 **1.9** Syntax parity. ✅ **Math.* signed/modular** *(e9d0405, fire#5)* — added 10 members to
  `GLOBALS.Math` (addMod, mulMod, sDiv, sMod, sShr, signExtend, sLt, sGt, sLte, sGte) matching RS's
  12-member `MathOp` set; implemented on v1 `Saucer` + wired the latent (unused, mis-named) V12Saucer
  methods to the parity spelling (sAr→sShr, sgt→sGt…, signExtend param order fixed, SIGN_EXTEND out of
  SWAPPED_OPS for source-order parity w/ RS `math_operand_order`). All Saucer ops pre-existed. +22 tests
  (v1 byte-exact + v12 self-check + arity); suite green (1811). ✅ **emit()→library** *(8bd6a8c, fire#9)*
  — moved `emit` from the hardcoded builtin table into `STDLIB_FUNCTIONS` merged into `GLOBAL_FUNCTIONS`
  (stdlib-injects-into-globals, decision 0.6); byte-identical LOG lowering; still callable-reserved
  (ECO-2011 safety) + binding-shadowable; the one real caller (erc20) verified (SDK gate 2536). Suite
  1879. ⬜ remaining §1.9 tail: `break`/`continue` v12/svm (likely already-supported — eco-swap compiles
  on TS v12), destructuring doc.
- ❎ **1.10** Per-function build-artifact cache — **INVESTIGATED (fire#10, T-CACHE done): NOT worth
  building** for the actual workloads. Data: SDK 1400+ suite compiles in ~13ms total (0.046ms each, each
  fn compiled ONCE, 99.7% single-main leaves sharing nothing); POST-BUILD (what the cache reuses) is
  ≤2.3% everywhere; the only expensive+recurring case (eco-swap under many defines/args) is dominated by
  `main()` — a CALLER Tier-1 can't cache, and once defines+args enter main's key Tier-2 collapses into the
  whole-program `cache.ts` that already exists (~9× on re-runs). Tier-2 also carries MEDIUM risk (post-build
  patcher + Saucer deep-clone correctness). **Recommendation: don't build; if latency ever matters, attack
  PARSE (12–49%) + the whole-program PREPASS (15–46%), not per-fn reuse.** *(User asked for this early on —
  the data answers "will it speed up?": no, for real workloads. Reversible if a future many-distinct-mains-
  sharing-expensive-leaves workload appears.)* Same verdict applies to RS PR-6b.

## EPIC-2 — RS forward-port (Part 2): port TS-only features into RS

**RE-BASELINED (T0 done, fire#2, vs `a8efa59c`).** Governing fact: compiler-rs is a **main-engine
re-architecture** (JUMP/JUMP_I, locals on operand stack, no memory-slots/CALL_FUNCTION/compile-time
args) — NOT a V12Saucer port. This makes fold structurally immune to the TS scope-bug family and
turns most of PR-20 MOOT/re-architected. **CLOSED (already on origin/main):** evm/svm namespace split,
`ctx.*` root, `log()` (ECO-2075), capability matrix, tuple projection (ECO-2056), `bool` (ECO-2109),
libraries+treeshake, narrow reserved-names, **V3 struct-arg order (DONE** `align_argument` — lock w/
a test), **G21 break/continue (DONE** `codegen.rs:1258`).

- **Wave 1** 🟡 **PR-2** svm sugar — ✅ freestanding **`uint()`** cast (RS `180604748`, fire#6; svm→CAST_LE,
  evm→CAST_BE, reserved name, 1034 green). 🟡 **deferred:** `accountData`/`writeAccountData`/`accountUint`
  freestanding — RS models svm accounts as `Ty::Account` main params (ECO-1860), TS uses string-ref
  interning; a genuine **account-model cross-compiler divergence** (RS already covers the ops via
  `svm.sload/sstore` + `uint(svm.sload(...))`). Route account-model reconciliation as its own item.
  · ✅ **PR-3 evm.tload/tstore** *(RS aa8e26d2c, fire#12)* — transient storage (EIP-1153), EVM-gated on
  `Feature::TransientStorage` (was a matrix cell with no source surface), mirrors evm.sload/sstore byte-for-byte
  (Opcode::Tload 0x80 / Tstore 0xC4). 9 tests; RS gate 1058. 🆕 **TS parity follow-up:** RS now accepts
  `evm.tload/tstore` but TS only has `storage.tRead/tWrite` — §1.3 deferred the evm.* spelling *because* RS
  lacked it; now add `evm.tload/tstore` to TS's evm namespace (alias storage.tRead/tWrite) so the same source
  compiles on both. ✅ **DONE** *(TS a96484b, fire#13)* — gatedAlias to storage.tRead/tWrite, EVM-gated,
  byte-identical v1/v12, svm-rejected; 4 tests; suite 1883. **evm.*/svm.* namespace parity now complete.**
  · ✅ **PR-4 `defines`** *(RS 90cd112a1, fire#5)* — new
  `options.defines: Vec<(String,Word)>` injected as module-scope consts (caller wins over source const),
  PLUS a genuinely-new constant-`Stmt::If` fold in `fold.rs` (RS previously only folded ternaries, never
  pruned an `if` on a constant condition — the whole feature needed it). 2 tests; RS gate green (1030).
  🟡 **PR-4 deferred:** CLI/wasm `--define` flag (core-only landed); treeshake-of-folded-away-arm not
  narrowed (RS computes reachability PRE-fold by design — same known follow-up as TS); no dead-code-
  after-return elim. · ⛔ **PR-5 try/catch — BLOCKED, needs a dedicated design pass** *(fire#12 audit)*: no
  bounded slice exists — even `x.method().catch(()=>{})` requires ALL of (a) a frontend arrow/closure carve-out
  (against SauceScript's no-closures design, frontend.rs:593), (b) a NEW IR node for call-with-catch, (c) a NEW
  inline-handler codegen primitive (RS has none — functions are separate table entries, EVAL takes a runtime
  descriptor), (d) catch-param binding + per-target (SVM pre-flight-only) semantics + Feature::TryCatch gating.
  Design-first later. · ❎ PR-6 compile cache / PR-6b per-function IR cache — SUPERSEDED by §1.10's "not worth
  building" verdict (same T-CACHE data). PR-1 (`ctx.*` complete) = PARTIAL but 14 missing entries are
  **engine-dependent**.
- ✅ **PR-11 module lookup-table folding** *(RS 4b6877e9d, fire#14)* — new `ModuleValue::Table` (const array/
  object of literals, no runtime word); `TABLE[k]`/`TABLE.field` (constant index/field) fold to the element at
  lower time; bare table ref / element write / whole-table reassign / alias all rejected (clean errors:
  `ModuleTableNotIndexed`/`ModuleTableIndexNotConst`/`ArrayIndexOutOfRange`) — strict allowlist mirroring TS
  `checkTableSafety` with better diagnostics. 8 tests; RS gate 1070. Deferred (fail-closed parity boundaries):
  element referencing another const, `.length`, string-computed key, mutable `let` table, non-literal-but-
  foldable index.
- **Wave 2 (partial-eval — THE real gap)** 📐 **PR-8/PR-9 DESIGNED** (fire#3, full file-cited plan in
  `docs/plans/rs-partial-eval-PR8-PR9-design.md`): unroll at IR level in a NEW `unroll.rs` before
  `fold` (reusing `fold::eval_binary`/`try_const`); for+while UNIFY into one recognizer; IR erases
  step syntax; NO `collidesWithSurroundingDeclarations` needed (LocalId, no names). Key wiring subtlety:
  fold the UNROLLED program at BOTH -O levels so validity stays -O-independent. ✅ **PR-8** splice infra+cap
  (proven no-op) *(RS 5b2eca0)* → ✅ **PR-9** numeric/while unroll *(RS 0512402, fire#4)* — new
  `unroll.rs` (IR→IR, before `fold`); unified for+while recognizer, direction sanity, body-exit +
  counter-reassign guards, cap+overflow-decline, terminal-assign, nested cascade. 15 unit + 4 e2e
  bytecode-equality tests (incl. the -O gate + overflow-at-both-levels). RS gate green (**1028**).
  · 🟡 PR-10 local const-prop **PARTIAL**
  (assigned-once + ternary-to-taken-arm present `fold.rs:205,424`; CFG interpreter absent — deliberately
  declines reassigned locals `fold.rs:1185,1255`) · ⬜ PR-11 lookup tables *(also needs non-scalar
  module const, `ModuleBindingNotLiteral` today)* · ⬜ PR-12 for…of (grammar-level) · ⬜ PR-13 local
  `new Array` fold · ✅ **PR-14 same-file call fold** *(RS cdb734536, fire#13)* — IR-level fold mirroring TS
  `tsEvalCall`: a `Call` to a same-file function whose body is exactly `return <expr>` with NO nested call
  and ALL-Const args is substituted with its evaluated constant (params bound as LocalId→Word, re-folded via
  the existing evaluator). No-nested-call rule guarantees termination; callee never removed; byte-identical
  for non-foldable calls; composes with the `known`-map local const-prop. 4 tests; RS gate 1062.
- **Wave 3 (inline)** ⬜ PR-15 validation+cycle · ⬜ PR-16 arrow-inline decl+splice (grammar-level).
- **Wave 4** ⬜ PR-17 CREATE (absent) · ❎ PR-18 compile-time-eval — runtime `eval` LANDED (ECO-2090)
  but plan's L15 recursive-`compile()` intent still absent · ⬜ PR-19 quasiquote · ✅ PR-20 audited
  → mostly MOOT/re-architected (see T0.2 table in log).
- **Verify** ⬜ V1 dynamic-kind adversarial audit (P0) · ⬜ V2 K15 positive test · ✅ V3 struct-arg
  order (DONE — lock w/ test) · ✅ **V4 nested-array-literal — FIXED** *(RS c861b09d, fire#3)*: the
  P0 was CONFIRMED empirically (RS accept-and-miscompiled on BOTH targets — `NEW_ARRAY`+`INDEX`,
  reverts on v12 EVM / rejected on svm; an existing RS test was *locking the bug in*). Fix mirrors TS
  `assertNoNestedArrayLiteral` — new `Error::NestedArrayLiteral` in `array_literal` (lower/expression.rs),
  syntactic, rejects on both targets (RS has no v1). RS gate green (1009). 🟡 **V4-followup:** RS test
  `a_tuple_can_hold_a_nested_array_and_it_stays_dynamic` implies an array-in-TUPLE path may be a
  sibling sub-risk — needs a real-exec check on v12/svm (does it round-trip, or same silent drop?).
  · ⬜ V5 manifest vs accountPlan · ⬜ V6 TS11 (`assigned_once` present).

## EPIC-N — 🌟🎉 NORTH-STAR CLOSED (fire#11): eco-swap compiles on BOTH compilers

**DONE 2026-08-22.** `ecoswap.unrolled.sauce.ts` (verbatim) compiles on **TS** (v1 2229B / v12 2175B)
AND on **compiler-rs** (EVM) — same SauceScript, both compilers. RS acceptance test
`tests/ecoswap.rs::ecoswap_unrolled_compiles_on_the_evm` PASSES; RS gate 1049, 0 ignored, byte-identical
for all prior tests. Path taken: NS-2 address.* + NS-3 Math.neg + NS-1 Tuple param model (infer-wildcard
+ entry_arg_types) + NS-5 codegen liveness (balancing drops at inner-if merge, `20e1e140c`). svm eco-swap
is out of scope (Contract.at is EVM-only by design). Remaining north-star follow-up: PR-4 (SDK/wasm
arg-encoder to RUN, not just compile, eco-swap on RS) — downstream, optional.

**TS half DONE** — `ecoswap.unrolled.sauce.ts` compiles green on TS (v1 2229B / v12 2175B; svm is a
deliberate EVM-binding rejection). **RS half = exactly 4 blockers**, ALL surface/type-vocabulary ports
(RS codegen already handles every STRUCTURAL feature eco-swap emits: runtime for/while loops, `.at()`
bindings, multi-output indexed call reads `slot0()[0]`, single-named JSON ABI imports, nested
struct-literal ABI args ordered by component, `.length`, ternary, `Math.sqrt`/`mulDiv`, `abi.encode().slice()`).
Ranked, source-grounded:
- ⬜ **NS-1 [BLOCKER, deepest]** compile-time `args` + a `Tuple` param type in RS. `CompileOptions`
  (options.rs) has no `args`; `Tuple` raises `UnknownType` (mod.rs:2048/3591). eco-swap's
  pools/routes/brackets are `Tuple`. No as-written RS representation for dynamic tuple-of-tuples params
  baked from compile-time args (the RS analog of TS `args`/`mainArgTypes`). **DESIGN-FIRST next fire.**
- ✅ **NS-2 [BLOCKER]** `address.*` namespace in RS *(RS 0a958c5da, fire#7)* — added `address` as a 7th
  namespace root (recognized + binding-reserved); `address.self`/`address.balance` PROPERTIES + `address.
  balanceOf(a)` METHOD, aliasing the same ops as `ctx.self()`/`ctx.selfBalance()`/`ctx.balance(a)`. Full
  spelling parity for the must-haves (eco-swap's `address.self`-as-arg compiles). 🟡 deferred: `codeSize/
  codeHash/isContract/isEOA` — RS lacks those 4 opcodes (clean `AddressUnknownMember` error; not needed by
  eco-swap). RS gate green (1044).
- ✅ **NS-3 [BLOCKER]** `Math.neg` in RS *(RS 627ee17c6, fire#7)* — `MathOp::Neg` (arity 1) reusing
  `Opcode::Neg` (0x29), byte-equivalent to `-x` by construction. Tests lock the byte-equivalence.
- ⬜ **NS-4 [verify after NS-1]** v12 deep-param REF/stack window (hit TS #374, fixed in-source by hoisting).
- 📐 **NS-1 [BLOCKER, deepest] — DESIGNED (fire#8), building next.** Full plan:
  `docs/plans/rs-NS1-tuple-params-design.md`. **KEY FINDING (source-grounded): RS already decodes
  `Array<Tuple<scalar>>` entry params at runtime** (green test `assembly.rs:2266-2275`) — it must NOT
  copy TS arg-baking. Gap is narrow: bare `Tuple` isn't in the type vocabulary (`type_by_name`,
  mod.rs:2056 → `UnknownType`), at 3 entry params + 4 local bindings in eco-swap. **Decision B1
  (autonomous, reversible): caller-supplied `entry_arg_types` shape hint (types only, no baking)** —
  NOT B2 (body-inference, unsound: an unread field under-sizes the tuple → wire-layout shift). Build:
  PR-1 (`Tuple` infer-wildcard at local binding) → PR-2 (`entry_arg_types` option) → PR-3 (eco-swap RS
  driver test). PR-4 (SDK/wasm arg-encoder for RUNTIME) is downstream, out of NS-1 core.
  **✅ NS-1 DONE + PROVEN SUFFICIENT (fire#9-10):** PR-1 (`9d9f98ef1` Tuple infer-wildcard) + PR-2
  (`52c6547d7` `ArgShape`/`entry_arg_types`, no Ty leak) + PR-3 harness (`a6a4e0a68`, `#[ignore]`d).
  eco-swap now **lowers past EVERY type/shape stage** on RS — the 3 `Tuple` params take their shapes,
  the 4 `Tuple` locals infer, tuple-index/`.length`/runtime-index all resolve. RS gate green (1048, 2
  ignored). PR-4 (SDK/wasm encoder, RUNTIME) still deferred.
- 📐 **NS-5 DESIGNED (fire#10) — CONFIRMED LAST BLOCKER, building next.** Full design:
  `docs/plans/rs-NS5-codegen-liveness-design.md`. Fix = a STRUCTURAL "symmetric-arm consume" in
  codegen.rs (widen the occurrence tag to 3-state + a `container==IfArm` gate in `collect_statement_locals`;
  `read_local` unchanged) — **NOT** a global precise-liveness rewrite. **ZERO blast radius / byte-identical
  for all currently-compiling programs** (a lingering branch-local ALWAYS diverges today, so every matching
  program currently ERRORS — no baseline bytes to preserve). NS-6 probe: **every other eco-swap feature
  already compiles on RS/EVM** (abi.encode().slice, multi-output tuple index, Math.*, nested swap struct) —
  NS-5 is the ONLY gate. One open unknown: full-file stack pressure (deep swap(SwapParams)), checkable in
  the eco-swap test run right after the fix.
- ✅ **NS-5 DONE (fire#11, `20e1e140c`) — NORTH-STAR CLOSED.** Landed "balancing drops at inner-if
  merge" (a generalization of the designed symmetric-arm consume — the real file needed it: r0/r1 at
  ecoswap.unrolled:119-120 are read in DIFFERENT arms of SEPARATE inner ifs, so consuming alone can't
  reconcile; a balancing DROP on the non-reading arm does). SAME zero-blast gate (block-scoped local,
  declared in the current if-arm, read in an inner if, dead after, non-diverging arm — all currently-
  erroring shapes). codegen.rs only; `last_use_flags`→`(flags, per-if drop sets)`, `drop_dead_locals`
  at each non-diverging arm end. **1049 passed, 0 ignored, byte-identical**; the flagged stack-pressure
  unknown never materialized (drops REDUCE pressure). eco-swap acceptance test un-ignored + PASSES.
- ~~🆕 ⛔ NS-5 [BLOCKER] codegen liveness / `DivergentBranches`~~ — RESOLVED above. (history:) eco-swap failed
  ONLY in codegen (`codegen.rs:1155`, `Error::DivergentBranches`): a local declared in an `if` arm whose
  only reads are in a NESTED branch is force-COPIED by the linear-liveness approximation (`last_use_flags`,
  codegen.rs:3028, documented TODO) → lingers live → diverges from the empty sibling arm. Hit via
  `cl = zeroForOne === 1 ? sr4 : Q192 / sr4;`. Proper fix = per-branch backward liveness (scope.rs already
  computes per-local `LiveRange`s; they're just not threaded into codegen's consume decision — Codegen holds
  only `last_use: Vec<bool>`). **HIGH regression risk** (consume decisions → bytecode → 1000+ pinned tests).
  Minimal repro + acceptance test both `#[ignore]`d, flip green together. **DESIGN-FIRST (fire#10).**
- ✅ **NS-6 [CLEARED, fire#10 probe]** — every downstream eco-swap feature already compiles on RS/EVM:
  `abi.encode().slice(0,0)`, multi-output-call tuple indexing (`getReserves()[0]`/`slot0()[0]`),
  `Math.mulDiv/sqrt/neg`, nested `swap(SwapParams)` struct args. NS-5 was the only gate — confirmed by the
  post-NS-5 full-file compile (no downstream error surfaced).

NOT needed by eco-swap (deprioritize for the north-star): `new Array`, `for...of`, destructuring,
try/catch, defines, lookup tables, inline arrow-const, same-file call fold.

## EPIC-3 — Cross-cutting

- ⬜ **T-CACHE.** Cache measurements: corpus leaf/caller classification + eco-swap build-vs-assembly
  profiling. Gates 1.10/PR-6b.
- ⬜ **eco-swap north-star harness.** Compile ecoswap.unrolled through both compilers each fire; diff
  SauceScript-acceptance (not bytecode). Regression tripwire.

---

## Execution Log

- **2026-08-19 fire#1** — Corrected RS baseline (origin/main far ahead of plan pin; much of Part 2
  already landed). Wrote this backlog. Green baseline: TS compiler builds. Launched audit/re-baseline
  workflow (T0/T0.1/T0.2 + Part-1 globals readiness). Landed 1.2 (divergence rule + registry, c90be5b).
- **2026-08-19 fire#2** — Audit workflow done: full Part-0 re-baseline. Key findings: RS = main-engine
  re-architecture; fold structurally immune (PR-7 shrinks); much of Part 2 already CLOSED; V4/K12 =
  confirmed silent-miscompile RISK in RS; NEW decision 0.7 (block vs shared scope). RS baseline build
  GREEN (29s). Folded re-baseline into EPIC-2. Started §1.4 ctx.* (TDD) + launching parallel RS lane.
- **2026-08-22 fire#3** — Loop restarted (cron `010d9719`, 30m). State assessment: TS branch is
  5 parity commits + 12 inherited `routes:` commits ahead of main → **full rebase deferred** (12
  unrelated xchain-DSL commits, high churn, zero value for parity coding which lives in `compiler/`
  TS + `../sauce` RS). **#131 = SDK takes RS from npm; does NOT affect the RS-source port work.** RS
  worktree fast-forwarded to `fd529240e` (current origin/main; 5 RS-native commits incl. `account.owner`
  #342 — nothing to port). **Landed §1.4** (`7bd13ff`, RS-parity ctx.*, 15 tests, suite green 1738).
  Dispatched parallel Workflow `w7sdrxsm7`: (a) RS V4 nested-array-literal risk verify+fix/lock,
  (b) TS §1.8 reserved-name narrowing (executes 0.4), (c) RS Wave-2 PR-8/9 design (context-preserving).
  **All 3 landed + independently re-verified green:** V4 = confirmed P0 + fixed (RS `c861b09d`, 1009);
  §1.8 = narrowed (TS `bb4fb0b`, 1763); PR-8/9 = full design → `rs-partial-eval-PR8-PR9-design.md`.
  Then launched the RS PR-8→PR-9 BUILD from that design (Workflow, background). **Next fire:** land
  PR-8/9 if not done; V4-tuple sub-risk real-exec check; TS §1.3 (evm.*/svm.* namespace split).
- **2026-08-22 fire#4** (cron tick) — RS build (`w9bs3q7ni`) still running on PR-9 → stayed OUT of the
  RS worktree, advanced an independent TS lane. **§1.3 landed+verified** (TS `8e1b7ad`, evm.*/svm.*
  namespaces, +26 tests, suite 1789). Then the RS build completed: **PR-8 (`5b2eca0`) + PR-9
  (`0512402`) both landed+re-verified green (1028)** — loop unrolling done, the biggest Wave-2 gap.
  Both lanes independently gate-verified by the orchestrator (not just agent reports). **Next:** RS
  Wave-2 PR-11/13/14 (lookup tables / local new Array / same-file call fold) + Wave-1 stragglers
  (PR-2/3/4/5); TS §1.5 (annotation storage kind) or §1.9 (Math.* signed/modular); V4-tuple check.
- **2026-08-22 fire#8** — **§1.6** (`05d2360`, pure target-gate consolidation) + **§1.7** (`3e10367`,
  push-order parity table, 1875) landed+verified. NS-1 design (schema-cap failure first) succeeded on a
  plain-text retry: **RS already decodes `Array<Tuple<scalar>>` at runtime — the gap is just the `Tuple`
  type-vocabulary spelling.** Decided **B1** (entry_arg_types hint, not unsound body-inference); saved
  `rs-NS1-tuple-params-design.md`. **TS Part-1 now essentially complete** (only §1.1 docs + §1.9 tail
  left). **Next: BUILD NS-1 (PR-1→PR-2→PR-3) = eco-swap compiles on RS = north-star done.**
- **2026-08-22 fire#11 — 🎉 NORTH-STAR CLOSED.** **NS-5** landed (`20e1e140c`, balancing drops at
  inner-if merge) → **eco-swap.unrolled compiles on compiler-rs (EVM)**, same source as TS. RS gate
  1049, 0 ignored, byte-identical (only the 2 ignored acceptance/repro tests flipped to pass); stack
  pressure never surfaced. Verified by the orchestrator. Also (fire#10): §1.10 cache declined-with-data,
  NS-5/NS-6 designed. **Remaining for FULL parity (none block the north-star):** RS Wave tail — PR-3
  evm.tload/tstore, PR-5 try/catch, PR-11 lookup tables, PR-13 local new Array, PR-14 same-file call
  fold, PR-15/16 inline; V-series verification; TS §1.1 docs; PR-4 (SDK/wasm arg-encoder to RUN eco-swap
  on RS). **Next fires: grind the Wave tail.**
- **2026-08-22 fire#7** — Round `wjqk95oz0`, both lanes landed+re-verified green: **RS NS-2 address.***
  (`0a958c5da`) + **NS-3 Math.neg** (`627ee17c6`), 1044 — **2 of 4 north-star blockers cleared**
  (eco-swap's `address.self`/`Math.neg` now compile on RS); **TS §1.5 annotation storage kind**
  (`e955d79`), 1819. Also fixed CI `format:check` drift in 3 earlier-fire test files (`96614bc`).
  **Only NS-1 (args + Tuple param model) + NS-4 (verify) remain for the eco-swap north-star.**
  **Next: DESIGN NS-1** (the deepest blocker — RS `args` option + dynamic tuple param type), then build.
- **2026-08-22 fire#6** — Resolved decision **0.7** (autonomous fail-safe: keep base shared-scope +
  cross-compiler divergence-registry entry, `1e4d5c4`) while a round ran. Then round `wedfaleea`
  landed: **RS PR-2 `uint()`** (`180604748`, 1034; account-trio deferred = account-model divergence)
  and the **eco-swap north-star probe** (read-only). Probe = strategic pivot: **TS compiles eco-swap
  green**; RS needs exactly **4 surface/vocab blockers** (NS-1 args/Tuple, NS-2 address.*, NS-3
  Math.neg, NS-4 v12 deep-param) — RS codegen already does every structural feature. Created EPIC-N
  (north-star roadmap). **Next:** build NS-2 + NS-3 (small) in one RS lane; design NS-1 (args/Tuple);
  TS §1.5 in parallel.
- **2026-08-22 fire#5** (same session, budget healthy) — Two more parallel lanes, both landed+re-verified
  green by the orchestrator: **RS PR-4 defines** (`90cd112a1`, 1030 — +constant-if fold) and **TS §1.9
  Math.* signed/modular** (`e9d0405`, 1811 — +10 Math members, latent V12 methods wired to parity
  spelling). One stale LSP type-error on context.ts:371 was investigated and DISPROVEN (tsc exit 0 —
  mid-edit snapshot). **Next:** RS PR-2 (svm sugar) + PR-5 (try/catch) or PR-14 (same-file call fold,
  design-first); TS §1.5 (annotation storage kind) or §1.6 (Feature matrix); V4-tuple real-exec check.
