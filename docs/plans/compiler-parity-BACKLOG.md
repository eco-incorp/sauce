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
- 🆕 ⚠️ **0.7 NEW DECISION (surfaced by T0.1): block-scope vs shared-scope for `if`/`while` bodies.**
  RS **block-scopes** them (a `let` inside a branch is dropped at branch end); base/TS **shares** scope
  (the `let` persists as the same variable). So `const FEE=100n; f(cond){if(cond){let FEE=5n;} return
  FEE}` → RS resolves `100n`; TS keeps a runtime read. This is a genuine **language-semantics
  divergence**, not a bug. **Pending user call:** converge TS→RS block-scoping (cleaner, matches JS/TS
  and RS) or keep the base shared-scope? Recommendation: **converge on block-scoping** (it's real
  TS semantics, and the whole program is "SauceScript = TS subset"). Until decided, TS passes keep
  their shared-scope guards (correct for today's base).

## EPIC-1 — TS backport (Part 1): make TS resemble RS

- ⬜ **1.1** Declare SauceScript a TS subset; demote plain-acorn path (docs + per-call-site default).
- ✅ **1.2** Divergence-resolution rule + cross-target divergence registry in `compiler/README.md`.
  *(c90be5b — normative rule + seeded EVM/SVM/v1 registry, mirrors RS README)*
- ⬜ **1.3** Adopt `evm.*`/`svm.*` namespace split in `globals.ts` (keep `storage.*`/`contract.*`
  as deprecated aliases). Land with/before 1.6. **TDD:** borrow RS namespace tests.
- 🟡 **1.4** Unified `ctx.*` context namespace (additive; keep `msg`/`block`/`tx`/`address`).
  Map: `ctx.msgSender`→msg.sender, `ctx.self`→address.self, `ctx.chainId`→block.chainId,
  `ctx.blockNumber`→block.number, `ctx.timestamp`→block.timestamp, `ctx.selfBalance`→address.balance,
  `ctx.balance(a)`→address.balanceOf. *(in progress fire#2, TDD)*
- ⬜ **1.5** Annotation-driven storage kind (highest leverage; cross-check vs heuristic, error on
  disagreement). **TDD:** the 9 K-bug shapes as real-exec regressions.
- ⬜ **1.6** One `Feature`×availability matrix; fold scattered `assertNo*`/`ctx.isV12` guards in.
- ⬜ **1.7** State push/emission order once (lookup table; borrow RS `push_order.rs`).
- ⬜ **1.8** Reserved-name policy (executes 0.4): narrow `RESERVED_NAMES`.
- ⬜ **1.9** Syntax parity: `break`/`continue` v12/svm (G21); signed/modular `Math.*` (L2);
  destructuring doc; emit()→library.
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
  tstore surface (matrix cell exists) · ⬜ PR-4 `defines` *(smallest clean win, no grammar/engine dep)*
  · ⬜ PR-5 try/catch (grammar-level) · ⬜ PR-6 compile cache · ⬜ PR-6b per-function IR cache.
  PR-1 (`ctx.*` complete) = PARTIAL but 14 missing entries are **engine-dependent**, not pure compiler.
- **Wave 2 (partial-eval — THE real gap)** ⬜ PR-8 splice infra+cap → ⬜ PR-9 numeric/while unroll
  *(representable today, no grammar change — highest leverage)* · 🟡 PR-10 local const-prop **PARTIAL**
  (assigned-once + ternary-to-taken-arm present `fold.rs:205,424`; CFG interpreter absent — deliberately
  declines reassigned locals `fold.rs:1185,1255`) · ⬜ PR-11 lookup tables *(also needs non-scalar
  module const, `ModuleBindingNotLiteral` today)* · ⬜ PR-12 for…of (grammar-level) · ⬜ PR-13 local
  `new Array` fold · ⬜ PR-14 same-file call fold.
- **Wave 3 (inline)** ⬜ PR-15 validation+cycle · ⬜ PR-16 arrow-inline decl+splice (grammar-level).
- **Wave 4** ⬜ PR-17 CREATE (absent) · ❎ PR-18 compile-time-eval — runtime `eval` LANDED (ECO-2090)
  but plan's L15 recursive-`compile()` intent still absent · ⬜ PR-19 quasiquote · ✅ PR-20 audited
  → mostly MOOT/re-architected (see T0.2 table in log).
- **Verify** ⬜ V1 dynamic-kind adversarial audit (P0) · ⬜ V2 K15 positive test · ✅ V3 struct-arg
  order (DONE — lock w/ test) · ⚠️ **V4 nested-array-literal — RS does NOT reject** (unlike TS v12/svm)
  → **confirmed silent-miscompile RISK, needs real-exec check, blocks PR-20** · ⬜ V5 manifest vs
  accountPlan · ⬜ V6 TS11 (`assigned_once` present).

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
