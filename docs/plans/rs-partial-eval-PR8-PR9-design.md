# RS partial-eval: PR-8 (splice infra) + PR-9 (numeric for/while unroll) — design

_Produced by the compiler-parity fire#3 workflow (design agent). File-cited against
`../sauce-compiler-rs/compiler/crates/sauce-core/src/`. This is the build driver for the
next RS Wave-2 fire. Gate: `cd ../sauce-compiler-rs/compiler && cargo test -p sauce-core`
(NOT `make ci`). Commit each PR on green, conventional-commit, no AI attribution._

## Summary

Design-only scoping for the RS compiler-rs partial-evaluation gap (PR-8 splice infra + MAX_UNROLL cap; PR-9 numeric for/while unrolling). Read the RS AST/IR, the fold pass, the loop lowering, the pipeline, and the TS oracle. Key finding: the RS const-fold pass (compiler/crates/sauce-core/src/fold.rs) is an IR→IR pass, and the numeric for/while loop's init/test/step structure is already desugared away by lowering into a single canonical shape — `[Assign(counter, start), Loop{ [If{ Binary{cmp, Local(counter), bound}, then_branch, else_branch: Some([Break]) }] }]` (lower/statement.rs:989-1068, pinned by tests at lines 3092-3181). Recommendation: unroll at the IR level (NOT AST — oxc is arena-borrowed and hostile to in-place splicing), as a NEW module `unroll.rs` running BEFORE `fold`, reusing `fold::eval_binary`. The IR representation makes RS materially SIMPLER than TS in three ways (for+while unify into one recognizer; the IR erases i++/i+=1/i=i+1n into one Add-update shape; and TS's `collidesWithSurroundingDeclarations` guard is entirely unnecessary because IR LocalIds are globally unique per function). No feature code written. Full plan in notes.

RS PARTIAL-EVAL PLAN — PR-8 (splice infra + cap) then PR-9 (numeric for/while unrolling). All paths under compiler/crates/sauce-core/src/. NOTE: the task said fold is at `lower/fold.rs`; it is actually at `fold.rs` (top-level of sauce-core/src). Its content matches the cited line numbers (assigned-once const-prop ~fold.rs:205; ternary-to-taken-arm fold.rs:425-442; declines reassigned locals — tests at fold.rs:1186 and 1256).

============================================================
PART 1 — INVESTIGATION FINDINGS (the four questions)
============================================================

Q1. HOW RS REPRESENTS AST vs IR, AND WHERE AN UNROLL PASS SITS

- Two representations:
  - AST = the oxc TypeScript AST, arena-allocated and BORROWED (`Program<'a>` borrows an `oxc_allocator::Allocator`) — frontend.rs:1-11, imports at frontend.rs:44-58. Produced by `frontend::parse`, gated by `frontend::check` (default-deny subset), then consumed by `lower::program`.
  - IR = the owned `crate::ir` tree. `ir::Program { functions, entry, global_count, contracts }` (ir.rs:868). `ir::Function { name, param_count, local_count, local_dynamic, body: Vec<Stmt> }` (ir.rs:837). `Stmt` enum (ir.rs:709). `Expr` enum (ir.rs:359). Scalars are `value::Word`. `LocalId(u32)` (ir.rs:34), `Expr::Const(Word)`, `Expr::Local(LocalId)`.
- The loop IR is `Stmt::Loop { body: Vec<Stmt> }` — an UNCONDITIONAL loop that exits via `Stmt::Break` (ir.rs ~779-786). The numeric for-loop's clean init/test/update is GONE by IR time.
- Compile pipeline (lib.rs:127-245), in order: `frontend::parse` (141) → `frontend::check` (146) → `lower::program` → ir_program (148-157) → `reachability::reachable_functions` (187, computed BEFORE fold on purpose) → per-function `fingerprints` (190-194) → `reachability::prune_unread_global_initializers` (203) → `fold::program` (208-214) → `eval_order::normalize` (217) → `dead_store::normalize` (228) → fingerprint-alignment check (234-241) → `codegen::emit` (242-245).
- CRITICAL INVARIANT: every IR pass between lib.rs:190 and lib.rs:241 must preserve function indices one-for-one (lib.rs:179-186). BUT `function_fingerprint` is `(name, param_count)` only — it explicitly ignores `body` (lib.rs:114-123). => an INTRA-FUNCTION unroll pass (which only rewrites a body's `Vec<Stmt>`, never adds/removes/reorders functions) is safe with respect to this invariant regardless of where in the IR pipeline it runs.
- DECISION: unroll at the IR level (IR→IR), NOT the AST level. Rationale:
  (a) The oxc AST is arena-allocated and borrowed; splicing N copies means constructing new nodes in the allocator and threading a rebuilt tree through `check`/`lower` — very awkward in Rust. TS gets away with AST rewriting only because JS objects are freely mutable.
  (b) The IR body is an owned `Vec<Stmt>` — trivially cloneable and spliceable.
  (c) `fold::eval_binary`/`eval_unary`/`eval_math` (fold.rs:28/66/80, all already `pub`) give exact 256-bit two's-complement arithmetic for the counter sequence and bound comparison — no second evaluator needed.
  (d) It matches the existing pass architecture (fold.rs / dead_store.rs / eval_order.rs / reachability.rs are all separate IR→IR modules).

Q2. fold.rs ANALYSIS; EXTEND vs NEW PASS; COUNTER-SUBSTITUTION REUSE

- fold.rs is IR→IR (fold.rs:1-4). `fold::program` (118-136) maps each function through `fold_function` (138-162): compute `assigned_once` (205-216) → const-prop via a threaded `known: HashMap<LocalId, Word>` (fold_stmt 249, fold_expr 350) → `prune_propagated_declarations` (176-195).
- It DECLINES reassigned locals because `assigned_once` keeps only slots with assign-count == 1 (fold.rs:205-216). A loop counter is assigned twice (init + the update `Assign`), so it is excluded and NEVER const-propagated — this is exactly why unrolling cannot lean on fold to substitute the counter. Confirmed by tests `does_not_propagate_a_reassigned_local` (fold.rs:1186) and `does_not_propagate_a_conditionally_reassigned_parameter` (fold.rs:1256).
- No CFG interpreter: `fold_stmt` recurses into `If`/`Loop` bodies (fold.rs:293-306) but treats a `Loop` as opaque — it never unrolls, never reasons across iterations.
- DECISION: NEW module `unroll.rs` (one-concern-per-module, matching fold/dead_store/eval_order), running BEFORE `fold`, DEPENDING on fold for the evaluator. Counter substitution is unroll's OWN job: it replaces every `Expr::Local(counter)` with `Expr::Const(value_i)` in each spliced iteration; the existing `fold` pass then runs next and collapses the now-constant arithmetic. This is the RS analog of the TS design note "each unrolled iteration re-enters the fold pass" (ts-frontend.ts:754). Do NOT extend fold.rs itself — keep the concerns separate; unroll only needs to call fold's pure evaluator (and one tiny new helper — see PR-8).

Q3. TS ORACLE — THE ACCEPTED SHAPES RS MUST MATCH (compiler/src/ts-frontend.ts)

- MAX_UNROLL_ITERATIONS = 256 (ts-frontend.ts:45).
- `tryUnrollForLoop` (766-815): single-declarator init `let i = <const>` (776-785); condition `i <cmp> <const>` with the counter on the LEFT (789-795); step via `extractStep` (797). `extractStep` (541-593) accepts `i++`/`i--`/`i += k`/`i -= k`/`i = i + k`/`i = i - k`, yielding the signed per-iteration step.
- `tryUnrollCountingWhile` (825-885): the pairing `let i = <const>; while (i <cmp> bound) { …; i +/- step }` — the increment is the body's own LAST statement (859-865); bails if anything AFTER the loop still reads the counter (867, because TS elides the declaration).
- `unrollCountingLoop` (701-764): direction sanity — forward cmp needs step>0, backward needs step<0, else bail (715-723); `bodyBlocksUnrolling` (725); enumerate values, cap at MAX_UNROLL_ITERATIONS (740-746); substitute counter per iteration (750-755); then `collidesWithSurroundingDeclarations` (763).
- `bodyBlocksUnrolling` (603-621): bail on `break`/`continue`/`return`, or a body redeclaration/shadowing of the counter name.
- `collidesWithSurroundingDeclarations` (644-663): bail if splicing N copies would duplicate a `let`/`const`/function name in the shared textual scope.
- `foldStatementList` (892-933): statement-LIST-level driver (needed because eliding the `[decl, while]` PAIR replaces two entries with N — a single-node visitor can't).

Q4 answer is PART 2/PART 3 below.

--- THREE RS-SPECIFIC SIMPLIFICATIONS vs TS (all consequences of the IR representation) ---
S1. for + while UNIFY into ONE recognizer. Both desugar to the SAME IR shape: a preceding `Assign{counter, start}` immediately followed by `Loop{ body: [If{ condition: Binary{cmp, Local(counter), bound}, then_branch, else_branch: Some([Break]) }] }`. See `while_statement` (lower/statement.rs:989-1005) and `for_desugar` (1021-1068); pinned by `lowers_a_while_loop_to_a_loop_with_a_negating_if` (statement.rs:3092-3111) and `lowers_a_for_loop_to_an_init_and_a_loop_with_the_update_appended` (3146-3181). The only difference — for appends the update as the last then_branch stmt (1053-1056), while it's the user's own last body stmt — is invisible to the recognizer, which just treats "the last then_branch statement" as the update. => RS needs ONE matcher, not TS's two (tryUnrollForLoop + tryUnrollCountingWhile).
S2. The IR ERASES step syntax. `i++`, `i += 1n`, and `i = i + 1n` ALL lower to `Assign{counter, Binary{Add, Local(counter), Const(1)}}` (the update is a plain assignment — for_update at statement.rs:1089-1097; ++ / += desugar in the assignment lowering). => RS's single update-matcher (Add ⇒ positive step, Sub ⇒ negative step) covers every spelling TS's `extractStep` (ts-frontend.ts:541-593) enumerates.
S3. `collidesWithSurroundingDeclarations` (ts-frontend.ts:644-663) is UNNECESSARY at IR level. IR has no names — only `LocalId`s that are globally unique per function (`next_slot` increments monotonically; documented at fold.rs:147-152), and `Stmt::Assign` is "declaration and reassignment alike" (ir.rs:710-711). So N spliced copies of a body containing `Assign{local: 5, …}` produce N valid `Assign{local: 5, …}` — no collision possible. This is the single biggest TS→RS divergence; do NOT port that guard.

============================================================
PART 2 — PR-8: SPLICE INFRASTRUCTURE + MAX_UNROLL CAP
============================================================

Goal: land the mechanism (a statement-LIST splice + a Local→Const substituter + the cap + the pipeline seam) as a proven NO-OP, so PR-9 is a pure recognizer addition.

Files to touch:

1. NEW FILE `unroll.rs`.
2. `lib.rs:39` region — add `mod unroll;` alongside `mod fold;` (module list is lib.rs:32-51).
3. `lib.rs` — wire the pass into the pipeline (see wiring below).
4. `fold.rs` — add ONE small helper (see `try_const`).

New items in unroll.rs:

- `pub const MAX_UNROLL: usize = 256;` (mirrors ts-frontend.ts:45; matches the value fold's neighbors already use).
- `pub fn program(program: Program) -> Program` — mirror `fold::program` (fold.rs:118-136): destructure, map each `Function` body through `unroll_function`, rebuild preserving `entry`/`global_count`/`contracts`. NOTE: returns `Program` NOT `Result` — unrolling never errors (a loop it can't handle is simply left as-is); any overflow validation stays fold's job.
- `fn unroll_function(f: Function) -> Function` → `Function { body: unroll_block(f.body), ..f }`.
- `fn unroll_block(stmts: Vec<Stmt>) -> Vec<Stmt>` — the statement-LIST driver (RS analog of `foldStatementList`, ts-frontend.ts:892-933). Walk indices; at each k, first recurse the child (rewrite `If.then_branch`/`If.else_branch`/`Loop.body` of `stmts[k]` via `unroll_block`), then call `try_unroll_at(&stmts, k)`; if `Some(spliced)`, replace `stmts[k]` and `stmts[k+1]` with `spliced` and re-run `unroll_block` over the spliced region (so nested loops keyed on the now-substituted counter cascade — see PR-9). List-level is required because eliding the `[Assign, Loop]` PAIR replaces two entries with N (same reason TS uses a list-level driver).
- `fn try_unroll_at(stmts: &[Stmt], k: usize) -> Option<Vec<Stmt>>` — PR-8 STUB: always `None` (identity). PR-9 fills it in.
- `pub(crate) fn substitute_local(stmts: &[Stmt], target: LocalId, value: Word) -> Vec<Stmt>` and its `fn substitute_local_expr(expr: &Expr, target: LocalId, value: Word) -> Expr` — the exhaustive Stmt/Expr rewriter replacing every `Expr::Local(target)` with `Expr::Const(value)`. TEMPLATE: copy the exhaustive match arms from `fold_expr` (fold.rs:350-559) and `fold_stmt` (fold.rs:249-333) verbatim in shape — every Expr variant is enumerated there, so this is a mechanical mirror (a missed variant is a compile error, which is the safety net). This is the "substitute the counter" primitive.
- The cap lives inside `try_unroll_at` (PR-9): decline (`None`) once the enumerated value count reaches `MAX_UNROLL` — a declined loop stays a valid runtime `Loop`, so codegen still handles it (graceful fallback, matching ts-frontend.ts:743).

New helper in fold.rs (for PR-9's use, added in PR-8 so the seam is reviewed once):

- `pub(crate) fn try_const(expr: &Expr) -> Option<Word>` = `fold_expr(expr.clone(), &HashMap::new()).ok().and_then(|e| as_const(&e))` (reusing `as_const`, fold.rs:343-348). Keeps ONE evaluator family in the codebase (the CLAUDE.md "one real evaluator" principle). unroll uses this to read start/bound/step and, after substitution, nested-loop bounds.

Pipeline wiring (lib.rs), THE ONE NON-OBVIOUS SUBTLETY — validity must not depend on -O:
The lib.rs invariant (comments at 161-165 and 204-207; tests `an_unreachable_functions_errors_do_not_depend_on_the_optimize_flag` lib.rs:746 and `an_unimported_exports_constant_fold_error_still_fails_the_build` ~lib.rs:727) says a provable constant error must fire at BOTH -O levels. Unrolling REVEALS new constant folds (e.g. `for(i=0;i<3;i++){ x = MAX*i }` folds `MAX*1n` → overflow, a compile error, ONLY once unrolled). To keep validity -O-independent, the UNROLLED program must be fold-validated at both levels, while the REWRITE is applied only when optimizing. Replace the current fold branch (lib.rs:208-214) with:

    // Unroll first; it never errors on its own. Folding the unrolled program is what may reveal a
    // constant overflow/÷0, so — like fold's own validation — that check must not depend on -O.
    let unrolled = unroll::program(ir_program.clone());
    let ir_program = if options.optimize {
        fold::program(unrolled).change_context(Error::Compile)?
    } else {
        // Validate the unroll-revealed folds, then discard the rewrite (validity is -O-independent).
        // Folding `unrolled` validates a superset of `ir_program`'s own consts (unroll only rewrites
        // recognized loops; all other code is present unchanged), so this subsumes the old
        // fold::program(ir_program.clone()) validation call.
        fold::program(unrolled).change_context(Error::Compile)?;
        ir_program
    };

This runs BEFORE `eval_order`/`dead_store` (lib.rs:217/228), so the terminal counter-assign PR-9 emits gets DCE'd by dead_store when the counter is unused. It runs AFTER `reachable`/`fingerprints` (lib.rs:187-194): safe because unroll is intra-function (function count/order/`(name,param_count)` unchanged) and only ever COPIES/DROPS statements — it never creates a new call edge (a `Call` inside a body is duplicated, keeping existing edges), so `reachable` stays a valid superset by the same argument as the fold-edge note at lib.rs:167-170.

PR-8 red→green tests (in unroll.rs `#[cfg(test)] mod tests`, template from fold.rs:680-... test style; build IR with `crate::lower::tests::{local, constant, binary}` at lower/mod.rs:3000-3012):

- `substitute_local_replaces_reads_across_nested_stmts`: build `If{ Binary{Add, Local(0), Const(1)}, [Loop{[Return(Local(0))]}], … }`, assert every `Local(0)` becomes `Const(v)`.
- `program_is_identity_without_the_recognizer`: a program containing a lowered loop (from `crate::lower::tests::lower_main("function main(){ let i=0n; while(i<3n){ i=i+1n; } return i; }")`, lower/mod.rs:3016) is returned byte-for-byte equal (recognizer stubs to None).
- lib.rs test `pr8_wiring_is_a_bytecode_no_op`: `single_module_bytecode` (lib.rs:398) of a loop program is IDENTICAL before/after adding the pass (recognizer None ⇒ no change), at optimize=true and false.
  Gate: `cd /Users/er/Documents/Projects/sauce-compiler-rs/compiler && cargo test -p sauce-core`.

============================================================
PART 3 — PR-9: NUMERIC for/while UNROLLING (CONSTANT start/bound/step)
============================================================

Fill in `try_unroll_at(stmts: &[Stmt], k: usize) -> Option<Vec<Stmt>>` in unroll.rs. Recognize the unified desugared shape (S1) and splice.

Recognizer steps (all `?`-decline to `None`, leaving a valid runtime Loop):

1. `stmts[k]` = `Stmt::Assign { local: c, value: start_expr }`; `start = fold::try_const(start_expr)?`.
2. `stmts[k+1]` = `Stmt::Loop { body }` where `body` is EXACTLY one `Stmt::If { condition, then_branch, else_branch: Some(else_b) }` and `else_b == [Stmt::Break]`. (This naturally rejects `for(;;)` infinite loops, whose condition is `Const(1)` not a comparison — statement.rs:1041, 3218-3232.)
3. `condition` = `Expr::Binary { op, lhs: box Expr::Local(c2), rhs: bound_expr }` with `c2 == c` and `op ∈ {Lt, Lte, Gt, Gte}` (counter on the LEFT, matching TS ts-frontend.ts:789); `bound = fold::try_const(bound_expr)?`. (Literal and module-const bounds are ALREADY `Expr::Const` at IR time — lowering substitutes module consts at use, fold.rs:353-354 — so `try_const` succeeds directly; the general `try_const` additionally handles a nested-loop bound made constant by an outer substitution.)
4. update = `then_branch.last()?` = `Stmt::Assign { local: c3, value: Expr::Binary { op: uop, lhs: box Expr::Local(c4), rhs: step_expr } }` with `c3 == c4 == c`, `uop ∈ {Add, Sub}`; `step = fold::try_const(step_expr)?`, `step != 0`.
5. Direction sanity (ts-frontend.ts:715-723): `(Lt|Lte) ⇒ uop == Add` and `(Gt|Gte) ⇒ uop == Sub`, else `None` (prevents non-terminating enumeration).
6. `body_stmts = &then_branch[..then_branch.len()-1]` (all but the update). Decline if EITHER guard fires:
   - `body_has_own_exit(body_stmts)` — the IR-aware analog of `bodyBlocksUnrolling` (ts-frontend.ts:603-621). IMPORTANT RS DIFFERENCE: because lowering synthesizes an `else_branch:[Break]` for EVERY loop, a naive "any Break in the subtree" scan would wrongly bail whenever the body contains a nested loop. So: recurse into `If.then_branch`/`If.else_branch` but treat a nested `Stmt::Loop` as OPAQUE for `Break`/`Continue` (they bind to that inner loop); a `Stmt::Return` at ANY depth in the body blocks (it exits the function). Accepted shapes still match TS (a user break/continue/return in the loop body blocks in both); only the detection is loop-level-aware, as the desugared IR requires.
   - `body_assigns_local(body_stmts, c)` — the body itself writes the counter (any `Stmt::Assign{local: c, …}` in `body_stmts`, or one nested in an If branch). This is the IR analog of TS's counter-shadowing guard (ts-frontend.ts:606-612): substituting a fixed per-iteration constant is unsound if the body mutates the counter (e.g. a second `i++`).
7. Enumerate: `cur = start`; loop — if `fold::eval_binary(op, cur, bound)? == Word::ZERO` (condition false), stop and record `terminal = cur`; else push `cur` to `values` (decline to `None` if `values.len() == MAX_UNROLL`, ts-frontend.ts:743); advance `cur = fold::eval_binary(uop, cur, step)` and, on `Err` (counter overflow), decline to `None` (leave runtime code). Zero-iteration loop ⇒ `values` empty, `terminal == start`.
8. Build result: for each `v` in `values`, push `substitute_local(body_stmts, c, v)`. Then append `Stmt::Assign { local: c, value: Expr::Const(terminal) }`.
   - WHY the terminal assign: it keeps a post-loop read of the counter correct (the `while … return i` case — statement.rs:3095 ends with `return i`), which lets RS DROP TS's `rest`-references-counter bail (ts-frontend.ts:867) entirely. For a `for`-loop the counter is loop-scoped and out of scope afterward (statement.rs:1010-1016), so the terminal assign is dead and `dead_store::normalize` (lib.rs:228) removes it. Sound and uniform for both loop kinds.
9. Return `Some(result)` — `unroll_block` splices it over `stmts[k..=k+1]` and re-runs, cascading into nested loops (the outer counter is now `Const` inside each copy, so an inner loop's bound folds via `try_const` and gets recognized). Termination: each successful splice strictly reduces the number of `Loop` nodes.

PR-9 red→green tests:
A) unit tests in unroll.rs (build the desugared IR directly with `local`/`constant`/`binary`, or via `lower::tests::lower_main` then `unroll::program`):

- forward `Lt`/`Add` step 1 unrolls to N substituted copies + terminal assign;
- backward `Gt`/`Sub`; inclusive `Lte`; step ≠ 1;
- zero-iteration (start already fails test) ⇒ only the terminal assign;
- cap: a `>256`-iteration loop is returned UNCHANGED (still a `Loop`);
- bail on a body containing `Return`/user `Break`/`Continue`;
- bail on a body that reassigns the counter;
- NON-match when the counter is on the RHS of the condition (`bound < i`) ⇒ left as `Loop`;
- nested-loop cascade: an outer loop whose body is an inner countable loop keyed on the outer counter fully unrolls to straight-line.
  B) end-to-end BYTECODE-EQUALITY tests in lib.rs `mod tests` (the strongest oracle — same technique as the dead-store test lib.rs:382-386 and `optimize_flag_gates_constant_folding` lib.rs:828-852, using `single_module_bytecode` lib.rs:398 / `two_module_bytecode_for` lib.rs:404):
- assert `compile(for-loop source)` bytecode == `compile(hand-unrolled straight-line source)` at optimize=true;
- the `while` analog;
- assert the loop program emits a back-jump/loop opcode at optimize=FALSE but NONE at optimize=true (the -O gate);
- a provably-overflowing unrolled iteration is a COMPILE ERROR at BOTH -O levels (locks the validity-independence wiring above; sibling of lib.rs:727/746).
  Borrow the exact source strings from statement.rs:3092-3181 (`lowers_a_while_loop…`, `lowers_a_for_loop…`) as the canonical shapes the recognizer targets. There is no TS FIXTURE FILE to import directly (TS unroll is tested under compiler/test/ts-frontend*.test.ts, a different harness) — mirror the SHAPES, not the files.
  Gate for both PRs: `cd /Users/er/Documents/Projects/sauce-compiler-rs/compiler && cargo test -p sauce-core` (do NOT run `make ci`). Commit each PR only on green, conventional-commit message, no AI attribution.

OPEN ITEMS / DEFERRED (call out in the PR-9 description, not implemented here):

- The `for...of`-over-array-table and lookup-table folds (TS ts-frontend.ts:2674+) are a separate, later PR — they need grammar/collection support and are not part of PR-8/9.
- Local (per-function) reassigned-scalar const-prop and effectively-const let/var (TS features) are out of scope; PR-9 only substitutes the loop counter, then leans on the existing fold pass.
- The `try_const`-based nested-cascade is included via unroll_block recursion, but if a reviewer wants PR-9 minimal, the recognizer already works with `Expr::Const` bounds alone (the primary literal/module-const deliverable); cascade is the free bonus from recursion.
