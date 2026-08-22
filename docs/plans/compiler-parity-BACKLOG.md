# Compiler Parity — Epic Backlog & Execution Tracker

**Autonomous program (user, 2026-08-19, `/loop 30m` + ultracode).** Implement the complete
`compiler-parity-and-port-plan.md`: **Part 1** backport RS→TS (make the local TS compiler resemble
compiler-rs), then **Part 2** forward-port TS→RS (port TS-only features into `../sauce` compiler-rs).
Parallel workflows + git worktrees; build in parallel, **merge only on green** (tests are the gate);
**TDD, borrowing tests from each compiler** to drive the other.

This file is the DURABLE state across cron fires (the `/loop` cron job is session-only in-memory).
Every fire: read this file → pick the next unblocked item(s) → advance → update status + Execution Log.

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

- ⬜ **1.1** Declare SauceScript a TS subset; demote plain-acorn path (docs + per-call-site default).
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
- ⬜ **1.5** Annotation-driven storage kind (highest leverage; cross-check vs heuristic, error on
  disagreement). **TDD:** the 9 K-bug shapes as real-exec regressions.
- ⬜ **1.6** One `Feature`×availability matrix; fold scattered `assertNo*`/`ctx.isV12` guards in.
- ⬜ **1.7** State push/emission order once (lookup table; borrow RS `push_order.rs`).
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
  (v1 byte-exact + v12 self-check + arity); suite green (1811). ⬜ remaining §1.9: `break`/`continue`
  v12/svm (G21 — RS side done), destructuring doc, emit()→library.
- ⬜ **1.10** Per-function build-artifact cache (Tier-1 leaf → Tier-2 name-based sentinel). Gate on
  measurements (T-CACHE).

## EPIC-2 — RS forward-port (Part 2): port TS-only features into RS

**RE-BASELINED (T0 done, fire#2, vs `a8efa59c`).** Governing fact: compiler-rs is a **main-engine
re-architecture** (JUMP/JUMP_I, locals on operand stack, no memory-slots/CALL_FUNCTION/compile-time
args) — NOT a V12Saucer port. This makes fold structurally immune to the TS scope-bug family and
turns most of PR-20 MOOT/re-architected. **CLOSED (already on origin/main):** evm/svm namespace split,
`ctx.*` root, `log()` (ECO-2075), capability matrix, tuple projection (ECO-2056), `bool` (ECO-2109),
libraries+treeshake, narrow reserved-names, **V3 struct-arg order (DONE** `align_argument` — lock w/
a test), **G21 break/continue (DONE** `codegen.rs:1258`).

- **Wave 1** ⬜ PR-2 svm sugar (uint/accountData/writeAccountData/accountUint) · ⬜ PR-3 evm.tload/
  tstore surface (matrix cell exists) · ✅ **PR-4 `defines`** *(RS 90cd112a1, fire#5)* — new
  `options.defines: Vec<(String,Word)>` injected as module-scope consts (caller wins over source const),
  PLUS a genuinely-new constant-`Stmt::If` fold in `fold.rs` (RS previously only folded ternaries, never
  pruned an `if` on a constant condition — the whole feature needed it). 2 tests; RS gate green (1030).
  🟡 **PR-4 deferred:** CLI/wasm `--define` flag (core-only landed); treeshake-of-folded-away-arm not
  narrowed (RS computes reachability PRE-fold by design — same known follow-up as TS); no dead-code-
  after-return elim. · ⬜ PR-5 try/catch (grammar-level) · ⬜ PR-6 compile cache · ⬜ PR-6b per-function
  IR cache. PR-1 (`ctx.*` complete) = PARTIAL but 14 missing entries are **engine-dependent**.
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
  `new Array` fold · ⬜ PR-14 same-file call fold.
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
- **2026-08-22 fire#5** (same session, budget healthy) — Two more parallel lanes, both landed+re-verified
  green by the orchestrator: **RS PR-4 defines** (`90cd112a1`, 1030 — +constant-if fold) and **TS §1.9
  Math.* signed/modular** (`e9d0405`, 1811 — +10 Math members, latent V12 methods wired to parity
  spelling). One stale LSP type-error on context.ts:371 was investigated and DISPROVEN (tsc exit 0 —
  mid-edit snapshot). **Next:** RS PR-2 (svm sugar) + PR-5 (try/catch) or PR-14 (same-file call fold,
  design-first); TS §1.5 (annotation storage kind) or §1.6 (Feature matrix); V4-tuple real-exec check.
