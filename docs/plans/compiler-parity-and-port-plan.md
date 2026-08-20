# Compiler parity + feature-port plan: TS compiler ⇄ `compiler-rs`

**Companion doc.** `docs/compiler-rs-vs-ts-delta.md` — read it first. Every claim about `compiler-rs`
in this plan is cited there against a real path in the read-only checkout of `eco-incorp/sauce#main`
@ `431f9ce`. The baseline for "the TS compiler" is `/Users/er/Documents/Projects/sauce-sdk/compiler`,
inventoried at `docs/compiler-feature-inventory.md` (114 features, IDs `A1`…`X3`).

**Strategic direction (user, 2026-08-11).**

1. **SauceScript becomes a subset of TypeScript.** Official support for JS-like SauceScript is
   **dropped**. Type annotations are what let the compiler do real work (partial evaluation, kind
   resolution); doing it in untyped JS is painful. This is *why* `compiler-rs` uses OXC — it parses TS
   natively, so partial eval is language-agnostic there, whereas the TS compiler's whole fold family
   is TS-only precisely because it reused the `typescript` library.
2. **Global namespacing for native EVM/SVM opcodes differs and must be pinned down and adopted.**
   `compiler-rs`'s `evm.*`/`svm.*` per-target split (delta §4) is the target shape, not the TS
   compiler's flat `GLOBALS` table with one name branching internally on target.

**Two parts.** **Part 1** makes the current TS compiler *resemble* `compiler-rs` in the design and
syntax decisions that matter, reaching basic parity. **Part 2** is a sequenced worklist of PRs into
`../sauce` porting every TS-compiler feature missing or partial in `compiler-rs`.

**No code changes are made by this doc.** It is the plan; execution is separate work.

---

## Part 0 — Do these first (they gate honest sequencing)

Two of these are audits, the rest are decisions. Every one is cheap relative to the work it unblocks,
and several Part 2 items cannot be scoped without them.

| # | Task | Why it gates | Effort |
| --- | --- | --- | --- |
| **0.1** | **Adversarial audit of `compiler-rs`'s scope-sharing in `fold.rs`.** Port the TS compiler's exact `if`/`while`-scope-sharing fixtures (`const FEE = 100n; function f(cond) { if (cond) { let FEE = 5n; } return FEE; }` and its four documented variants) as tests against `fold.rs`. | This bug family cost the TS compiler **four** separate fix-and-regression-lock cycles across four different passes, each found only by real execution, and each produced a *wrong program*, not a missed fold. `fold.rs`'s shadowing model was not audited (delta §9.5). Every partial-eval port in Part 2 sits on top of whatever `fold.rs` believes about scope. | S |
| **0.2** | **Read-and-classify audit of `codegen.rs` (6,370 lines) + the unread bulk of `lower/assembly.rs` (3,869).** Output: confirmed-present/absent for `A6`–`A8` and `G1`–`G24`. | Those 27 inventory IDs are **unknown**, not absent (delta §9.1). Nothing in Category `G` can be scheduled until this lands. | M |
| **0.3** | **Decide the `ctx.*` question.** Adopt `compiler-rs`'s single `ctx.*` root in the TS compiler (replacing `msg`/`block`/`tx`/`address`), or push back and have `compiler-rs` adopt the four-root split. | Determines whether Part 1's §1.4 or Part 2's PR-1 is the migration, and they are mutually exclusive shapes. Recommendation: **adopt `ctx.*`** — one root, target-neutral naming, and it is the side already shipping. | S (decision) |
| **0.4** | **Decide the reserved-name policy.** `compiler-rs` reserves three identifiers and lets namespace roots be shadowed; the TS compiler reserves every root and global function name. | Recommendation: **converge on `compiler-rs`'s narrower rule**, because its reasoning is mechanical rather than stylistic — a namespace root is only recognized at a static-member-callee position, so a variable by that name can shadow nothing (`lower/mod.rs:1700-1701`). Reserving `emit` in particular actively blocks the library that should own it (`lower/mod.rs:1703-1706`). | S (decision) |
| **0.5** | **Decide the destructuring question.** `compiler-rs`'s frontend rejects `const [a, b] = …` outright; a multi-output call is a `Ty::Tuple` projected by index/field. The TS compiler built a dedicated destructuring lowering (`K10`) for exactly this. | This is the one item where "port the TS compiler's syntax" and "adopt `compiler-rs`'s shape" **actively conflict**. Recommendation: **adopt `compiler-rs`'s tuple projection** — it is the capability that matters, and real TypeScript destructuring is a bigger grammar commitment than the SauceScript-invented `const [a,b] = call()` form. | S (decision) |
| **0.6** | **Decide `emit()`'s home** (`L14`). Builtin (TS compiler today) or library function over `log` + `abi.encode` + a precomputed topic (`compiler-rs`'s stated position). | Recommendation: **library**, per `compiler-rs`'s own reasoning. This *removes* `L14` from the port list rather than scheduling it. | S (decision) |

---

## Part 1 — Make the TS compiler resemble `compiler-rs`

Ordered so no step requires reverting an earlier one. Each item names the `compiler-rs` mechanism it
copies, the concrete change in `/Users/er/Documents/Projects/sauce-sdk/compiler`, and the risk.

### 1.1 — Declare SauceScript a TypeScript subset; demote the plain-acorn path

**`compiler-rs` shape.** One parser, TS grammar always (`frontend.rs:89`), plus a default-deny subset
gate collecting all violations (`frontend.rs:14-24`). `frontend.rs:1`: *"parse SauceScript (a
TypeScript subset)."*

**Changes in `compiler/`.**
- Document in `compiler/README.md` and the repo `CLAUDE.md` that a `.ts`/`.sauce.ts` source (or
  `tsSource: true`) is the **only supported** entry point going forward. `.js`/`.sauce` becomes
  legacy-supported, not removed.
- Flip the *documented default* and consider flipping the actual default of `tsSource` for new call
  sites, so the fold family is the compiler's behavior rather than an opt-in extra.
- Do **not** delete acorn. The ts-frontend's contract is "parse TS, strip types, hand acorn plain JS
  text" (`src/ts-frontend.ts`); acorn stays the bytecode-facing parser. What changes is which entry
  point is supported, not the pipeline internals.

**Risk: LOW-MEDIUM.** The existing SDK corpus is `.js`/`.sauce` — `sdk/src/protocols/*/functions` and
`sdk/src/recipes/` — and `sdk/` tests compile every protocol's `sauceFunctions` through the real
compiler (1,400+ tests). Migrating that corpus is explicitly **out of scope** here; the deprecation
must be additive or the whole SDK test suite is the blast radius. The real risk of flipping the
default is that six transformer stages become newly reachable for sources that never ran them —
mitigate by flipping per call site, not globally.

### 1.2 — Adopt the divergence-resolution rule as written policy, plus a divergence registry

**`compiler-rs` shape.** A normative MUST/MAY (`compiler-rs` `CLAUDE.md:820-830`): reconcile in the
compiler when the meaning is shared and only the encoding differs; namespace as two gated features
only when the construct names a target-specific concept with no counterpart. Plus a living registry
with a disposition per row (reconcile / two features / inherent), `README.md:174-214`.

**Changes in `compiler/`.** Add the rule verbatim to `compiler/README.md`, and start a
`Cross-target divergences` table there seeded from the v12/svm rows the repo `CLAUDE.md` already
documents in prose (the nested-array-literal gap, the `.length`-through-a-parameter silent-32
behavior, the dropped ERC20 bool, the descriptor pointer ceiling).

**Risk: NONE (documentation).** But it is the prerequisite for 1.3/1.4 being principled rather than
cosmetic — without the rule, the namespace split is just a rename.

**Why this comes before the rename:** the rule is what decides *which* names move. `keccak256` and
`Math.*` must **not** be namespaced (shared meaning, reconciled encoding); `sload`/`sstore`/`call`
must be (same opcode byte, divergent semantics).

### 1.3 — Adopt the `evm.*` / `svm.*` namespace split

**`compiler-rs` shape** (delta §4b/4c): six namespace roots recognized structurally
(`lower/contract.rs:807-892`), per-target primitives as *distinct* constructs sharing a bytecode
opcode, each gated by its own `Feature`.

**TS compiler today** (`compiler/src/globals.ts`): one flat `GLOBALS` table — `storage.read/write`
(:401) and `contract.call/static/delegate` (:593) each serve both targets and branch internally on
`ctx.isSvm`/`ctx.target`; plus four **bare** svm-specific globals `uint` (:783), `accountData` (:802),
`writeAccountData` (:814), `accountUint` (:831), namespaced under nothing at all.

**Changes in `compiler/src/globals.ts`.**
1. Add `svm` as a real `GLOBALS` root: `svm.sload`, `svm.sstore`, `svm.call`, and move the four bare
   svm globals under it (`svm.uint`, `svm.accountData`, `svm.writeAccountData`, `svm.accountUint`).
2. Add `evm` as a real root: `evm.sload`, `evm.sstore`, `evm.call`, `evm.static`, `evm.delegate`, and
   (per 1.2's rule) `evm.tload`/`evm.tstore` for transient storage — `compiler-rs` `CLAUDE.md:826`
   already names `evm.tload` as the intended spelling.
3. Keep `storage.*` and `contract.*` as **deprecated aliases** resolving to the same lowering, gated
   on `ctx.target` exactly as today. A hard rename is a repo-wide breaking change across
   `sdk/src/protocols/*` and `sdk/src/recipes/`.
4. `RESERVED_NAMES` (`globals.ts:841`) picks up `evm`/`svm` automatically as new `GLOBALS` keys — but
   see 1.8, which may narrow that set instead.
5. Update the inventory's `L8`/`L13`/`L16` **SOURCE** citations once landed.

**Risk: MEDIUM.** Aliases keep the corpus compiling, but every alias is a second spelling for the
same lowering and each one is a place where a target-gating check can be forgotten on one path and
not the other — which is exactly the failure mode 1.6 exists to close. Land 1.6's single gate
**before or with** this, not after.

### 1.4 — Adopt the unified `ctx.*` context namespace (conditional on 0.3)

**`compiler-rs` shape.** One root, seven methods (`lower/contract.rs:410-419`), dispatching to a flat
`ContextOp` enum.

**Changes in `compiler/src/globals.ts`.** Add `ctx` as a root with `ctx.msgSender()`, `ctx.self()`,
`ctx.chainId()`, `ctx.blockNumber()`, `ctx.timestamp()`, `ctx.selfBalance()`, `ctx.balance(addr)`
mapping to the existing `msg.sender`, `address.self`, `block.chainId`, `block.number`,
`block.timestamp`, and the two balance reads. Keep `msg`/`block`/`tx`/`address` as the deprecated
supersets — the TS compiler has 21 context entry points to `compiler-rs`'s 7, so this is *additive on
the TS side and a port target on the rs side* (Part 2, PR-1).

**Risk: LOW.** Purely additive naming. The one substantive decision embedded here is whether
`ctx.blockNumber()` on the SVM meaning *slot height* is acceptable under one name —
`compiler-rs` classifies that as **inherently divergent, won't-fix** (`README.md:214`), which is a
reasonable position to inherit rather than relitigate.

### 1.5 — Let type annotations settle storage kind; retire the heuristic incrementally

**`compiler-rs` shape.** `lower::annotation_ty` resolves each annotation to a checked `Ty`, and
`is_dynamic`/`ElementTag` are *derived* from it once, during lowering (delta §1/§3).

**Changes in `compiler/`.** This is the highest-leverage item in Part 1, because it is what the nine
documented kind-inference bug generations (`K1`–`K15`) all trace back to.
- Teach the ts-frontend to **read** a `let`/`const`/parameter type annotation (it is currently
  annotation-blind — it strips types via `ts.transpileModule` and hands acorn plain JS) and thread it
  through to the processor as an authoritative kind.
- Where an annotation is present, short-circuit `inferKind`/`inferKindWithContext` entirely.
- **Cross-check, don't just override**: when the heuristic and the annotation disagree, error at
  compile time. An `Array<uint256>` annotation on a binding the heuristic calls `scalar` is precisely
  the shape that produced nine bugs; catching the mismatch is more valuable than trusting either side.
- Keep `inferKindWithContext` as the fallback for unannotated bindings — needed for as long as 1.1's
  legacy path exists.
- Longer-term, tracked not required: once annotations are load-bearing, `analyzeFunctionReturnKinds`'s
  fixpoint (`K4`) does real work only for unannotated code, and can retire as coverage grows rather
  than at a flag day.

**Risk: MEDIUM-HIGH, but the good kind.** Threading a new authoritative kind source into the pipeline
that produced nine descriptor-drop bugs is not risk-free. Mitigate exactly the way this repo already
does: every change in this area gets a real-execution regression test, per the `CLAUDE.md` fix log's
own methodology. The cross-check-and-error design means the failure mode is a *compile error*, never a
silent runtime revert.

### 1.6 — Consolidate target gating into one `Feature` × availability matrix

**`compiler-rs` shape.** One matrix (`targets.rs:64-140`), consulted from exactly two places — the
lowering-time gate (`require_available`) and the pre-codegen pass (`capability::check`) — documented as
*"the single mapping both gates read … so they cannot ask about different cells for one call"*
(`targets.rs:172-176`). The pass reports the **leftmost** unsupported construct in source order.

**Changes in `compiler/`.** Fold today's scattered gating into one declarative table plus one check:
`assertCapability` call sites in `globals.ts`, `assertNoNestedArrayLiteral` (`K12`),
`assertNoDynamicVariableObjectField` (`K13`), `rejectV1ScalarToDynamicReassignment` (`K8`), the
`multiOutputCall` tag (`K9`), and the `ctx.isV12`/`ctx.isSvm` branches through `processor/`.

**Risk: MEDIUM.** These guards were each landed to close a *specific* measured miscompile, and several
have subtle conditions (the `_bytes.length === 2` narrowing in `assertNoDynamicVariableObjectField`
exists because v12's postfix encoding puts `READ_HEAP` first for a genuinely scalar expression). Do
not rewrite the conditions while relocating them — move each guard's predicate verbatim into a matrix
cell, keep every existing test green, and only then simplify.

**Payoff.** New target-divergence work becomes "add a matrix cell + a registry row" instead of "add a
bespoke `assertNo*` function," which is the pattern that produced `K12`/`K13` as one-offs.

### 1.7 — State push/emission order once

**`compiler-rs` shape.** `push_order.rs` is the single statement of codegen's emission order,
consumed by the passes that must agree with it; its own doc records that three consumers had already
drifted before consolidation.

**Changes in `compiler/`.** A single lookup table naming each `Saucer`/`V12Saucer` method's operand
push order and stack effect, consulted rather than restated. The TS compiler has the identical
structural exposure today: this branch's `V12Saucer.store` SSWAP bug (silently returning the
*pre-write* value for a plain scalar parameter write, with no revert) existed because the write path
omitted two terms the read path already accounted for.

**Risk: LOW to state, MEDIUM to enforce.** Adding the table is safe; making every site consult it
touches codegen. Do it before Part 2 ports anything order-sensitive.

### 1.8 — Resolve the reserved-name policy (executes 0.4)

If 0.4 lands on `compiler-rs`'s narrower rule: shrink `RESERVED_NAMES` (`globals.ts:841`) from "every
`GLOBALS` key + every `GLOBAL_FUNCTIONS` key" toward the primitives only, and drop the enforcement in
`compiler/src/context.ts:502,560` / `processor/inline.ts:90` for namespace roots.

**Risk: LOW-MEDIUM, and asymmetric.** *Relaxing* a reservation can only make previously-rejected
programs compile — it cannot break a compiling one. But keep the reservation for anything the compiler
intercepts **before** name resolution, or you reintroduce `compiler-rs`'s own ECO-2011 bug
(`import { transfer as log }` bound a callee no call could reach; the call emitted a bare `LOG` and
`transfer`'s body was never lowered — `lower/mod.rs:1695-1699`). Reserve what is intercepted; release
what is only pattern-matched at a member-callee position.

### 1.9 — Match the remaining syntax decisions

Small, but they are what "basic parity" means at the source level:

- **`break`/`continue` on v12/svm** (`G21`). The TS compiler hard-errors; `compiler-rs` implements
  them (`Stmt::Break`/`Stmt::Continue`, loop-depth-gated). This is the inventory's own Open Question
  #1, and `compiler-rs` has answered it — the TS compiler should follow. **Risk: MEDIUM** (v12 jump
  encoding, `G20`'s wide-jump upgrades).
- **Signed/modular intrinsics** (`L2`, inventory Open Question #2). The opcodes exist in the TS
  compiler's table with no SauceScript surface; `compiler-rs` surfaces `Math.sDiv`, `Math.sMod`,
  `Math.sShr`, `Math.signExtend`, `Math.addMod`, `Math.mulMod` with documented per-target revert
  semantics. Adopt those exact names. **Risk: LOW** (additive; the opcodes are already emitted).
- **Destructuring** — executes 0.5. If the decision is `compiler-rs`'s tuple projection, the TS
  compiler's `const [a, b] = call()` (`K10`) becomes a supported-but-not-preferred spelling, and
  documentation should teach index/field projection. **Do not remove `K10`** — it is load-bearing for
  the existing corpus and it is the only shape that makes one external call for a multi-output read.
- **`emit()`** — executes 0.6. If library, mark `L14` deprecated in the inventory rather than porting.

### 1.10 — Per-function build-artifact cache (follow-up; added 2026-08-19)

**Goal (user).** Cache the per-function *build artifact* (the Saucer / `funcMeta` entry) in memory, keyed
by the function, and clone+reuse it across compiles — so recompiling `main(x)=>a(x)+b(x)+c(x)` reuses
the already-built `a` and `b` artifacts instead of re-walking their ASTs. **This caches the build
output, not bytecode** — bytes are still (re)emitted per compile because args/offsets differ.

**Why it's feasible (the seam already exists).** `compile()` is genuinely two-phase:
- **Build** (per-function): `processFunction`/`processFunctionV12` walk each function's AST into its own
  Saucer artifact; v12 collects them in `ctx.funcMeta` (`context.ts:128`). Cross-function calls are
  emitted as sentinels `0xFF00|funcIndex` (`callPositions`); param reads as SDUP sentinels
  (`refPositions`). This is the expensive part (AST walk + the fold/const-prop/return-kind pre-passes +
  Saucer construction).
- **Post-build** (`compile()`): `patchCalls` (`index.ts:403`), `patchSdup` (`:429`),
  `assembleV12`/`buildMain` resolve sentinels → absolute byte offsets, concrete `SDUPn`, `ALLOCATE`
  prefix, arg-prologue. Cheap; re-runs every compile.

So the build artifact is a discrete object produced *before* the assembler, and offsets/args are
late-bound — exactly what makes clone-and-reuse sound. (The whole-program `cache.ts` is a coarser,
separate layer; its own header rejects caching *bytecode* bodies, which is a different claim.)

**The one caveat.** `patchCalls` resolves the sentinel's *offset*, but the callee's **registry index**
is still baked into the sentinel at build time (`0xFF00|funcIndex`, index from `ctx.addFunc` order,
`processor/index.ts:468`). Two tiers follow:
- **Tier 1 — leaf helpers** (no CALL_FUNCTION, no top-level-const/ABI reads): artifact is a pure
  function of `(functionSource, target)`. Soundly cacheable with **zero architectural change**. Covers
  the `tickArg`/`kyberOut`-shaped arithmetic helpers.
- **Tier 2 — callers**: cacheable only if the key also fingerprints callee registry indices + any
  consts/ABIs/callee-return-kinds the body reads. **Unlock:** make the call sentinel **name-based** and
  resolve `name→offset` in `patchCalls` (instead of `index→offset`) — then no build artifact bakes a
  program-specific index, and the key collapses to pure source. Small change *because* the post-build
  patcher already exists.

**Changes in `compiler/`.** A build-artifact store consulted before `processFunction*`, populated in
the build phase; post-build assembly always runs fresh. Ship Tier 1 first; do the name-based-sentinel
change, then Tier 2.

**Gate on measurement first (do not skip):** (1) classify the real corpus
(`sdk/src/protocols/*/functions`, `sdk/src/recipes`, `../sauce-recipes/ecoswap`) — leaf vs caller
fraction is the cache's ceiling; (2) instrument `compile()` on eco-swap for the build-vs-post-build-vs
whole-program-pre-pass time split. Only commit the tier the numbers justify.

**Risk: LOW (Tier 1) → MEDIUM (Tier 2 / name-based sentinel).** Tier 1 touches no codegen. The
name-based sentinel touches the post-build patcher — keep every offset test green while switching the
resolution key.

---

## Part 2 — Port worklist: PRs into `../sauce` (`compiler-rs`)

Statuses, as established in the delta doc:

- **ABSENT** — the module(s) that would contain it were read/grepped; no equivalent found.
- **PARTIAL** — some of the feature exists; the named remainder does not.
- **DIFFERENT** — same capability, different shape. **Not a port** — a decision (Part 0).
- **MOOT** — v1-only. **Not a port.** See "What NOT to port."
- **UNKNOWN** — read scope did not cover it. **Not schedulable** until 0.2.

PRs are grouped to be individually shippable and reviewable, with dependencies stated. Priorities
inherit the inventory's `P0`–`P3` where they exist, adjusted for `compiler-rs`'s reality (e.g. a
`P0`-in-TS feature whose whole purpose was v1 is not `P0` here).

### Wave 1 — small, additive, no new architecture

| PR | Scope | IDs | Status in rs | Prio | Depends on |
| --- | --- | --- | --- | --- | --- |
| **PR-1** | **Complete the `ctx.*` context surface.** Add the missing reads as `ContextOp` variants plus match arms in `ctx_call`: `msg.value`, `msg.data`, `tx.origin`, `tx.gasPrice`, `block.coinbase`, `block.prevrandao`, `block.gasLimit`, `block.baseFee`, `block.blobBaseFee`, `address.balanceOf/codeSize/codeHash/isContract/isEOA`, `gasLeft`, `blockHash`, `blobHash` — under `ctx.*` names. | `L11` | PARTIAL (7 of 21; `ctx.gasPrice()` rejected by test at `lower/contract.rs:2135-2139`) | P1 | 0.3 |
| **PR-2** | **svm sugar intrinsics.** `uint()`, `accountData()`, `writeAccountData()`, `accountUint()` as `svm.*` methods over the existing `svm.sload`/`svm.sstore` primitives. | `L16` | ABSENT (sugar only — primitive present) | P1 | — |
| **PR-3** | **Transient storage surface.** Wire `evm.tload`/`evm.tstore` to the already-present `Feature::TransientStorage` matrix cell. | `L8` | PARTIAL (matrix cell only, no call surface) | P1 | — |
| **PR-4** | **`CompileOptions.defines`.** One additive field, threaded into `fold.rs`'s existing constant environment alongside its own `known` map. | `D4` | ABSENT | P1 | — |
| **PR-5** | **`.catch(handler)` / try-catch surface.** `Feature::TryCatch` exists but `frontend.rs:956` rejects `try`/`catch` as out-of-subset and `ir.rs` has no `Stmt::Try`. Needs frontend acceptance + an IR node + codegen. | `C4` | ABSENT (matrix cell only) | P1 | — |
| **PR-6** | **Compile cache.** Memoized `(source, options, resolved-import bytes)` → result, defensive clone in/out, bounded LRU. Note `compiler-rs`'s core is I/O-free, so the import-bytes term must key off the `Resolver`'s answers, not the filesystem. | `X1`–`X3` | ABSENT | P2 | — |
| **PR-6b** | **Per-function build-artifact cache** (companion to TS §1.10; added 2026-08-19). Cache the per-function lowered **IR** (the pre-`codegen.rs` artifact), keyed by function, and reuse it across compiles so a new `main` reusing helpers `a`/`b` skips re-lowering them. **Structurally easier than in TS:** `main` already has an IR→`codegen.rs` split, and IR is program-relative — cross-function references and offsets are resolved entirely in codegen, so an IR artifact is index-relocatable **for free** (no name-based-sentinel change needed, unlike the TS Tier-2 caveat). Key on `(functionSource, target)` for leaf functions; add the read-consts/ABIs fingerprint for callers. Land after PR-6's cache infra + the Wave-2 IR-pass foundation exists. | `X1`–`X3` (finer grain) | ABSENT | P2 | PR-6, PR-8 |

**Why these first:** each is bounded, needs no new pass, and PR-1/PR-2/PR-3 are also the items most
likely to be load-bearing for real SDK SauceScript (protocol functions read `msg.value` and
`tx.origin` far more than `blobBaseFee`).

### Wave 2 — partial-evaluation foundation

This is the largest genuine gap (delta §3/§7): `fold.rs` does constant-subtree collapse and
assigned-once propagation; the TS compiler's Categories `TS`/`Unroll`/`Inline` are 26 features. The
inventory's own instruction (lines 48-58) is to treat Category `TS` as *the specification* and
implement it once, language-agnostically — which on `compiler-rs` means **as IR passes**, not as
source-AST transformers.

| PR | Scope | IDs | Status in rs | Prio | Depends on |
| --- | --- | --- | --- | --- | --- |
| **PR-7** | **Scope-model hardening + regression suite.** Land 0.1's fixtures as tests; fix whatever they find. | `TS6` (the discipline) | UNKNOWN → must be settled | **P0** | 0.1 |
| **PR-8** | **Statement-splice infrastructure + iteration cap.** The IR analogue of `U4`: splice N `Stmt`s into a `Vec<Stmt>`, with the 256-iteration cap and a declaration-collision guard. On `compiler-rs` the collision guard is *cheaper* than in TS — there is no text round-trip through `acorn` to crash, but `LocalId` uniqueness still has to hold. | `U4` | ABSENT | **P0** (infrastructure) | PR-7 |
| **PR-9** | **Numeric `for` unrolling + the `while`-counting idiom.** Both are one core (`unrollCountingLoop` in TS). | `U1`, `U2` | ABSENT | P1 | PR-8 |
| **PR-10** | **Local per-function constant propagation, incl. ternary and compound-assignment RHS.** In TS this is a control-flow-sensitive abstract interpreter with an explicit if/else merge rule and a "every name written anywhere in a loop is NAC" rule (deliberately not a fixpoint). On the IR this is a natural pass. | `TS15`, `TS16` | ABSENT as a distinct pass | P1 | PR-7 |
| **PR-11** | **Lookup-table folding** (top-level array/object constant tables, whole-program allowlist safety scan, constant-index read substitution, dead-declaration removal). | `TS12` | ABSENT | P1 | PR-10 |
| **PR-12** | **`for…of` unrolling over a tracked table.** In TS this is *enabling*, not merely optimizing — plain acorn has no `ForOfStatement` at all. Check whether `compiler-rs`'s frontend accepts `for…of` before scoping: `frontend.rs:14-24`'s accepted list names `for`/`while` and not `for…of`, so this may be a frontend-grammar addition too. | `U3` | ABSENT | P1 | PR-11, PR-8 |
| **PR-13** | **Local `new Array(n)` construction folding + the `return arr;` escape fold.** `Expr::ArrayOfLength` already exists in the IR, so the candidate shape is representable. The TS version's forced-BYTE_32 return-width channel exists only because `tsPartialEval` returns *text* that acorn re-parses — on `compiler-rs` the width can ride on the IR node, so **do not port the fingerprint channel**, port the intent. | `TS13`, `TS14` | ABSENT | P2 | PR-10 |
| **PR-14** | **Same-file call folding** (a call to a side-effect-free, single-`return`-expression, non-recursive, zero-nested-call same-file function folds at the call site). | `TS4` | ABSENT | P2 | PR-10 |

**Sequencing note.** `TS1`/`TS2`/`TS3`/`TS5`/`TS7`/`TS8` are **not** rows above on purpose: they are
artifacts of the TS compiler's *seam* (two evaluators, the `ts-evaluator` fallback and its guards,
`getText()` precision, the module-scope fold's own ternary branch). On `compiler-rs` their substance
is already covered — `fold.rs` uses checked `ruint::U256` (no float round-trip to guard),
`eval_order::normalize` lowers `Expr::Conditional` into per-arm `Stmt::If`, and there is no second
evaluator to keep shadow-safe. Porting them by name would be porting scar tissue.

### Wave 3 — inline functions

| PR | Scope | IDs | Status in rs | Prio | Depends on |
| --- | --- | --- | --- | --- | --- |
| **PR-15** | **Inline validation + recursion/cycle detection first.** Bail conditions and a call-graph cycle check over inline *and* real functions (including a cycle routing through an intervening real function), plus a total-expansion cap. Validate-then-splice, never the reverse. | `I2`, `I4` | ABSENT | **P0** *within this feature* | PR-8 |
| **PR-16** | **Declaration convention + splicing.** `const NAME = (params) => body;` marks inline; per-call-site argument binding, alpha-renaming, and return-elimination (a shared result variable plus a `done` flag, with everything after a returning `if` wrapped in a `done === 0` guard). Check first whether `compiler-rs`'s frontend accepts an arrow function at all — grep found no `ArrowFunctionExpression` handling in `frontend.rs`, so this likely needs a grammar addition. | `I1`, `I3` | ABSENT | P1 | PR-15 |

**`I5` and `I6` are not scheduled.** `I5` (dynamic-return placeholder seeding) exists only to work
around v1's `rejectV1ScalarToDynamicReassignment` guard — with kind coming from a checked type, an
inlined callee's return kind is known from its annotation, so the mechanism is moot by construction.
`I6` is a documented known gap in the original (unreachable inline functions validated eagerly),
`P3`, not worth inheriting.

### Wave 4 — blocked on a design decision or an upstream milestone

| PR | Scope | IDs | Status in rs | Prio | Blocker |
| --- | --- | --- | --- | --- | --- |
| **PR-17** | **CREATE family + address prediction.** | `L12` | ABSENT — `Create` is named as future work in `targets.rs:67` | P2 | Upstream milestone. **Do not front-run it** with an ad hoc namespace addition. Also settle SVM applicability first: Solana has no CREATE-family analogue, so this is plausibly `evm.*`-only. |
| **PR-18** | **`eval()` compile-time nested compilation.** | `L15` | ABSENT — `Eval` named as future work | P2 | A **reentrancy design question**: the TS `eval()` recursively calls `compile()` from inside lowering. In `compiler-rs` that means `compile()` reachable from `lower`, with `Resolver` and the arena's lifetimes in play. Resolve deliberately, not by accident. Note also `README.md:207` flags `EVAL` of caller-supplied bytecode as a live route into an EVM/SVM array-slot-kind divergence. |
| **PR-19** | **`` $`…` `` quasiquote bytecode construction.** | `L18` | ABSENT — tagged templates not in the accepted subset | P2 | Frontend grammar addition; low demand. Confirm a real consumer exists before spending here. |
| **PR-20** | **`A6`–`A8` / `G1`–`G24` codegen and arg-encoding parity.** | 27 IDs | **UNKNOWN** | — | **0.2.** Not schedulable. Any estimate before that audit is fiction. |

### Verify-rather-than-port

Not ports; do them anyway, in parallel.

1. **Adversarial audit of `compiler-rs`'s dynamic-kind resolution.** `Ty`-derived `is_dynamic` is
   structurally better than the heuristic that produced nine bugs (delta §1) — but no real-execution
   audit was run for this doc, and `compiler-rs`'s docs cite none. Use this repo's own methodology
   (real anvil / LiteSVM execution, not compile-time reasoning) and the nine documented bug shapes as
   the fixture source. **P0 as verification.**
2. **`K15`'s call-argument shape as a positive test.** The gap is v1-only and confirmed absent on
   v12/svm by real execution on all three engines. Port
   `function h(a){ return a[1]; } function main(){ const arr = new Array(3); …; return h(arr); }` into
   `compiler-rs` as a *passing* test, so a future change cannot reintroduce an analogous split. Cheap.
3. **`C3`'s struct-arg ordering.** Prove `compiler-rs` orders struct/tuple fields by the ABI's
   declared component order and not alphabetically. This exact bug scrambled `SwapParams`'s nested
   `PoolKey` into an empty revert in the TS compiler (repo `CLAUDE.md`, "The swap Router"); the fix
   there is unit-pinned by `compiler/test/struct-arg-order.test.ts`, which is a ready-made fixture.
4. **`K12`'s nested-array-literal shape.** The TS compiler rejects it at compile time on v12/svm
   because the *engines* have no nested-array static encoding. Check whether `compiler-rs` rejects,
   supports, or silently miscompiles it. Confirmed-unknown (delta §9.7).
5. **`manifest.rs` vs the SDK's `accountPlan`** (`A9`/`G22`) — compare field-for-field against the SDK
   consumer, since the SDK is the downstream that must attach accounts correctly.
6. **`TS11` STRETCH.** Confirm whether `fold.rs`'s `assigned_once` covers the `let x; x = <init>;`
   predeclaration pair before committing engineering time. Audit task, not a port.

---

## What NOT to port

Stated explicitly so nobody spends a sprint on legacy. All of these are v1-only, and `compiler-rs`
has **no v1 target** — `Target::{Evm, Svm}` only (`options.rs:6-12`), matching the inventory's own
porting-scope section (lines 39-47).

| ID(s) | Feature | Why not |
| --- | --- | --- |
| `A5` | v1 `main()` args as an appended `CALL_FUNCTION` segment | v12/svm use the arg-prologue instead (`A6`). |
| `G8`, `G10` | v1 memory model, ALLOCATE prefix, 255-slot cap; the v1 prefix builder | Prefix encoding does not exist in `compiler-rs`. |
| `G24` (v1 half) | Out-of-band `ctx.dynamicResult` descriptor model | v12/svm use one in-band 32-byte descriptor word. This is the root of most of Category `K`. |
| `K4`–`K9`, `K11` | Return-kind fixpoint, `localBoundContracts`, `applyDestructuringKinds`, `singleDynamicAbiOutputKind`, the scalar→dynamic reassignment rejection, `multiOutputCall` tagging, ternary kind promotion | All exist because v1 destroys a descriptor stored in a value slot. `V12Saucer.store` ignores its `_kind` argument entirely and derives the kind from the value; `compiler-rs` derives it from a checked `Ty`. Port the **invariant** (a dynamic value must never round-trip through a scalar slot), not the machinery. |
| `K15` | The call-argument gap and the silent `.length`-through-a-parameter bug | v1's `funcHeap`/`funcValues` two-index split. Confirmed absent on v12/svm by real execution on all three engines. See "Verify" #2 — it becomes a positive test, not a fix. |
| `I5` | Inline dynamic-return placeholder seeding | Works around `K8`, which is v1-only. Moot with typed returns. |
| `T1`'s `treeshake: false` | Preserving the v1 function-table index layout | No v1 table. `compiler-rs` computes reachability once, pre-fold, and shares it (`reachability.rs`). |
| `L14` | `emit()` as a builtin | Not v1 — a **design decision**. `compiler-rs` deliberately leaves `emit` unreserved so a library can export it (`lower/mod.rs:1703-1706`). Executes 0.6. |
| `K10`'s syntax half | `const [a, b] = call()` destructuring | `compiler-rs`'s frontend rejects destructuring outright; the capability lives as `Ty::Tuple` index/field projection. Executes 0.5 — a decision, not a gap. |
| `TS1`–`TS3`, `TS5`, `TS7`, `TS8` | ts-frontend seams, the second bigint evaluator, `getText()` precision, the `ts-evaluator` fallback and its guards, module-scope ternary folding | Scar tissue from the acorn+`typescript` seam and from `ts-evaluator@2.0.0`'s inability to evaluate bigint. `compiler-rs` has one frontend, checked `ruint` arithmetic, and lowers ternaries in `eval_order`. Port the *specification* they implement (Wave 2), not the workarounds. |

---

## Honest de-scoping

Where this plan does **not** know enough to sequence work, said plainly:

- **`A6`–`A8` and all of `G1`–`G24` (27 IDs) are UNKNOWN, not absent.** `codegen.rs` (6,370 lines) and
  the bulk of `lower/assembly.rs` (3,869) were not read. Task 0.2 exists precisely for this. No PR in
  Wave 1–3 depends on those IDs, so the rest of this plan is executable meanwhile — but any Category
  `G` estimate before 0.2 is invented.
- **`compiler-rs`'s own correctness is unverified here.** No anvil / LiteSVM execution was run. Every
  "`compiler-rs` is ahead" claim in the delta doc is architectural. "Verify" #1 and #4 exist because a
  cleaner design is not automatically a correct one.
- **`fold.rs`'s scope model is the biggest unknown that matters.** It is not a feature gap; it is a
  possible instance of the bug family that cost the TS compiler four fix cycles. That is why 0.1 is
  first and PR-7 gates all of Wave 2.
- **Whether `compiler-rs`'s frontend accepts arrow functions and `for…of` at all** was not confirmed
  beyond grepping `frontend.rs` (which returned nothing for arrow handling, and whose accepted-statement
  list names `for`/`while` but not `for…of`). PR-12 and PR-16 may each need a grammar addition on top
  of the pass work — scope them after a five-minute confirm, not from this doc's estimate.
- **`abi.rs`'s stale doc comment** (*"nothing consumes a `ContractAbi` yet"*) contradicts working,
  tested calling code in `lower/contract.rs`. Read as doc rot; worth a one-line upstream fix PR, but
  not treated here as evidence of a gap.

---

## Sequencing summary

```
Part 0   0.1 fold.rs scope audit ─┐          0.3 ctx decision ─┐
         0.2 codegen audit        │          0.4 reserved-name │  (decisions, parallel)
                                 │          0.5 destructuring │
                                 │          0.6 emit()        ┘
Part 1   1.1 TS-subset  →  1.2 divergence rule  →  1.3 evm/svm split ──┐
                                                   1.4 ctx.* (needs 0.3)│
         1.6 single capability gate ──── land with or before 1.3 ───────┤
         1.5 annotation-driven kinds (highest leverage)                 │
         1.7 push-order table  →  prerequisite for order-sensitive work │
         1.8 reserved-name policy (needs 0.4)   1.9 syntax decisions ───┘

Part 2   Wave 1  PR-1 … PR-6          (small, additive, independent)
         Wave 2  PR-7 (needs 0.1) → PR-8 → PR-9
                                   → PR-10 → PR-11 → PR-12
                                            → PR-13, PR-14
         Wave 3  PR-15 → PR-16      (needs PR-8)
         Wave 4  PR-17 … PR-19       (blocked)   PR-20 (needs 0.2)
         Verify  1 … 6               (parallel throughout; #1 is P0)
```

**If only three things happen:** 0.1 + PR-7 (the scope-model audit and whatever it finds), 1.5
(annotations settle kind in the TS compiler), and PR-1 + PR-2 + PR-3 (the language surface real SDK
SauceScript actually reaches for). Those are the highest ratio of risk retired to effort spent.
