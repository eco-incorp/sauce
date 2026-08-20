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

- 🔍 **T0. Part 2 re-baseline vs `origin/main` RS.** For each PR-1…PR-20: DONE/PARTIAL/ABSENT today,
  with cite. Rewrites Part 2's real worklist. *(launched: audit workflow)*
- 🔍 **T0.1 (0.1). fold.rs scope-model audit.** Port the 5 if/while scope-sharing fixtures as RS
  `#[test]`s; assess `fold.rs`+`scope.rs` shadowing. Gates Wave 2. *(launched)*
- 🔍 **T0.2 (0.2). codegen.rs/assembly.rs classify** for A6–A8, G1–G24 (present/absent). *(launched)*
- ✅ **0.3 ctx.\*** — DECIDED: adopt single `ctx.*` root (RS already ships it).
- ✅ **0.4 reserved-names** — DECIDED: converge on RS narrower rule (member-callee only).
- ✅ **0.5 destructuring** — DECIDED: adopt tuple projection (RS #292), KEEP TS `K10` spelling.
- ✅ **0.6 emit()** — DECIDED: library, not builtin (consistent w/ stdlib-injects-into-globals).

## EPIC-1 — TS backport (Part 1): make TS resemble RS

- ⬜ **1.1** Declare SauceScript a TS subset; demote plain-acorn path (docs + per-call-site default).
- 🟡 **1.2** Divergence-resolution rule + cross-target divergence registry in `compiler/README.md`.
  *(in progress this fire)*
- ⬜ **1.3** Adopt `evm.*`/`svm.*` namespace split in `globals.ts` (keep `storage.*`/`contract.*`
  as deprecated aliases). Land with/before 1.6. **TDD:** borrow RS namespace tests.
- ⬜ **1.4** Unified `ctx.*` context namespace (additive; keep `msg`/`block`/`tx`/`address`).
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

*Real worklist pending T0 re-baseline. Presumed-remaining after known-landed items:*

- **Wave 1** ⬜ PR-4 `defines` · ⬜ PR-5 try/catch surface (`C4`) · ⬜ PR-6 compile cache ·
  ⬜ PR-6b per-function IR cache (needs PR-6+PR-8). *(PR-1/2/3 likely DONE — confirm T0.)*
- **Wave 2 (partial-eval — the big gap)** ⬜ PR-7 scope hardening (needs T0.1) → ⬜ PR-8 splice infra
  + cap → ⬜ PR-9 numeric/while unroll → ⬜ PR-10 local const-prop → ⬜ PR-11 lookup tables →
  ⬜ PR-12 for…of unroll → ⬜ PR-13 local `new Array` fold → ⬜ PR-14 same-file call fold.
- **Wave 3 (inline)** ⬜ PR-15 validation+cycle detection → ⬜ PR-16 declaration+splicing.
- **Wave 4 (blocked/decision)** ⬜ PR-17 CREATE · 🔍 PR-18 eval (likely DONE, ECO-2090 — confirm) ·
  ⬜ PR-19 quasiquote · 🔍 PR-20 A6–A8/G1–G24 (needs T0.2).
- **Verify-rather-than-port** ⬜ V1 dynamic-kind adversarial audit (P0) · ⬜ V2 K15 positive test ·
  ⬜ V3 struct-arg order · ⬜ V4 nested-array-literal · ⬜ V5 manifest vs accountPlan · ⬜ V6 TS11.

## EPIC-3 — Cross-cutting

- ⬜ **T-CACHE.** Cache measurements: corpus leaf/caller classification + eco-swap build-vs-assembly
  profiling. Gates 1.10/PR-6b.
- ⬜ **eco-swap north-star harness.** Compile ecoswap.unrolled through both compilers each fire; diff
  SauceScript-acceptance (not bytecode). Regression tripwire.

---

## Execution Log

- **2026-08-19 fire#1** — Corrected RS baseline (origin/main far ahead of plan pin; much of Part 2
  already landed). Wrote this backlog. Green baseline: TS compiler builds. Launched audit/re-baseline
  workflow (T0/T0.1/T0.2 + Part-1 globals readiness). Started 1.2 (divergence rule + registry).
