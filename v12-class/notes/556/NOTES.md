# #556 port (compile a program for its arguments) — notes (v12-556r)

Old: backup/feat-compiler-args-20261005 (3b9a0d14), old base backup/feat-compiler-specialization-20261005
(b931269c). Own commits: 94204408 feat, 96c9e778 fix (SVM Address = whole word), e175effe fix (assigned
param starts at its argument). Old tests: compiler/crates/sauce-core/tests/entry_args.rs (375 lines).
NEVER port from local rewrite/556 at 3d44424c (junk file `lower/alk(element, roots)),|XX|`).

## Phase 1 (2026-10-07): plan sent; lead APPROVED incl. SVM proposal (args = entryParams order; docs say so).
## Phase 2 (2026-10-07): branched rewrite/556 from 2155102e (#555 final; push held by GH error, same sha).
Commits: b8b13061 feat, fe306203 test, ad2b74f9 docs. entry_args.rs 15 tests green; engine ARGS cases green;
base_bytecode green. GATES GREEN at ad2b74f9: ci 3722, conformance 743, smoke 88 ok. (were run chained via gate.sh, logs scratchpad 556-*.log,
status scratchpad 556-gates.txt. PR-BODY-DRAFT.md written (fill gate counts + sha). Then report
"#556 ready for review at <sha>" to main (team-lead). NO PUSH until main says push.

## Plan
- Rust `CompileOptions::args: Option<Vec<Word>>`; npm `args?: Array<bigint | boolean | string>`.
- lower_at: entry gets `known = args` through lower_function's existing `known` param (#555 copy path):
  declare_constant + mark_known; Specializations::rewrite specializes run-time calls; decided ifs prune.
- New code: assigned param -> mutable local + `Stmt::Assign` first; bound_argument (ArgNotWord /
  ArgOutOfRange: bool > 1, EVM Address/Account > 160 bits via entry_params::is_address, SVM Address whole
  word); ArgsCount; entry_params [] ; compact off (no schema); cache context specialized_context(function_context(ctx,true), known).
- SVM: args = exactly the entryParams params; Account params stay manifest slots (None in known).
- Drop: Known::bound(), ty.without_host(), Depot host test (replace with program(closure, scope)).
- Probed on #555 binary: (A) const-form == `return 6` at -O (16 B evm), (B) const capture == literal (13 B).
  At -O0 both differ from the literal; they equal the const-written main.

## Phase 2 checklist
- fetch; `git checkout -B rewrite/556 <#555 final sha>` in this worktree.
- gates via gate.sh with CARGO_BUILD_JOBS=2; base_bytecode green.
- PR-BODY-DRAFT.md (untracked): lead with intent file main args bound into intents; ## Interface.
- report "#556 ready for review at <sha>"; no push until main says push.

2026-10-07: lead heads-up: #555 gets a size fix (copies bake only decisive known params). On "#555 final at <sha>":
merge it, rerun entry_args (A)/(B) + gates. Entry must still bake ALL bound args (no prologue); if the fix lives in
lower_function's param handling, add an entry flag. Told lead.
2026-10-07: reported "#556 ready for review at ad2b74f9". Lead agreed: #555 fix goes in request/mask/rewrite, entry exempt
(v12-555r adds a test). WAITING for "#555 final at <sha>": then `git fetch` / merge that sha into rewrite/556, rerun
entry_args (A)/(B), gates via gate.sh, update PR-BODY-DRAFT sha/counts, report again. No push until "push".
2026-10-07: review-550 MEDIUM on ad2b74f9: param assigned only in an arrow / `.catch()` handler is bound const ->
ConstReassignment. Root cause shared `reassigned_in` (statement.rs), v12-555r fixes it in the coming #555 head.
UNCOMMITTED repro tests (fail until merge): entry_args.rs `a_parameter_assigned_in_an_arrow_starts_at_its_argument`
(bound == written with let) and try_conformance.rs `a_program_compiled_for_its_arguments_assigns_them_in_an_arrow_and_a_catch`
(v12: arrow 5->6; catch REVERTS->0, SUCCEEDS->1). After merging #555 final: run them, commit as test(compiler), gates, report.
2026-10-07: merged #555 final 68ddccf5 (cd272ef1, conflict in lower_function param loop resolved with
Knowing::{Decides, Constants}); repro tests committed 4b30767b (pass). (A)/(B) green. Gates running (556-*2.log,
556-gates2.txt). Then: fill PR-BODY-DRAFT counts/sha, report "#556 ready at <sha>".
2026-10-07: gates GREEN at 4b30767b: ci 3725, conformance 745, smoke 88. Merged #555 final 750357f3 (docs-only) ->
54f7edde; rerunning ci + smoke (556-*3.log, 556-gates3.txt). Then fill CI_COUNT in PR-BODY-DRAFT and report ready at 54f7edde.
2026-10-07: lead: one more #555 head coming (each copy takes the smaller of bake-all and decide-only). HOLD.
On "#555 final at <sha>": merge, check Knowing::Constants path untouched, run entry_args + specialization +
base_bytecode, then full gates once (ci, conformance, smoke), report "#556 ready at <sha>". No push.
2026-10-07: 54f7edde green: ci 3725, smoke 88. Holding for next #555 final.
v12-555r heads-up: next #555 adds `Knowing { Decides, Constants }` in lower_function (my names), Constants for copies
(skip param, declare_constant + know_constant); specialized_context(function, known, constants: bool) gets 3rd arg
(entry passes true); nested::Compilation gains optimize; Lowering::lower takes specialize::Form. On merge: keep
their enum, add entry-only bits (bound_argument, assigned -> let init, compact off).
2026-10-07: merged #555 final 6dd0e358 (226b7a35), af3a7e2e test derived const, f68cf828 docs. Full gates running (556-*4.log). Amended docs commit -> 1140a536 (CLAUDE.md wording only; gates run on f68cf828 tree). Report ready at 1140a536.
2026-10-07: merged #555 final 6b2dff83 -> 65e92404; targeted green; timing in scratchpad 556-timing.txt (ratios 0.25-0.67, specialized call 1.27x = 57us). Full gates running (556-*5.log).
2026-10-07: HOLD: #549 merged into v12 main (squashed); main cascading up the stack; #555 gets phantom-program-report fix. Next '#555 final' carries both: merge, regate (full), report ready. No push.
2026-10-07: lead: NO new gate runs until cascade's '#555 final' (lock needed by cascade). Current checkpoint (556-*5) may finish.
2026-10-07: 65e92404 checkpoint green (ci 3734, conf 745, smoke 88). Merged #555 final 9f0cd9c5 (cascade + phantom fix) -> 62aa1e3c, targeted green. Full gates started (556-*6.log, summary 556-gates6-summary.txt); waiting on lock.
2026-10-08: 62aa1e3c green (ci 3735, conf 745, smoke 88). Merged #555 final c553e59c -> c0309041, targeted green; full gates running (556-*7.log). Then report ready at c0309041; push only on lead's word.
2026-10-08: c0309041 GREEN: ci 3736, conformance 745, smoke 88. Reported ready; waiting for 'push'.
2026-10-08: PUSHED c0309041 to feat/compiler-args (lease 3b9a0d14), tag backup/feat-compiler-args-20261008 pushed, title/body rewritten, comment posted. Waiting CI -> gh pr ready 556 -> send '#556 final at c0309041' to v12-557r, sdk-class, main.
2026-10-08: CI 15/15 green; lead ran gh pr ready 556. Sent '#556 final at c0309041' to v12-557r and sdk-class. DONE; stand by for review threads.
