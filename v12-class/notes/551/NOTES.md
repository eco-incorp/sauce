# v12-551 notes (rewrite of #551 as `program(closure, scope)`)

Branch: rewrite/551 in /Users/er/Documents/Projects/v12-class/551, base #549 head ca0302eb.
Old #551: backup/feat-compiler-program-arguments-20261005 (old #550 = backup/feat-compiler-host-declarations-20261005).
Do NOT push. Lead = `main`. #550 owner = `v12-550` (branch rewrite/550, repo /Users/er/Documents/Projects/v12-class/repo).

## Phase 1 (now): core onto #549, no host machinery
Salvage (category C) from old #551:
- lower/nested.rs: Programs trait, Request, Compiled, CaptureSource, Compilation, Captures (minus record),
  Lowerer::{capture_read, capturable, read_name, read_module_let, program_argument}, program_value.
- lower/reach.rs (passes_closures; trigger no longer needs a host).
- assembly.rs: Place, ProgramArgument, ParseCache, lower_reached, unlowered, initialize_captures,
  load_graph `frame`, Loader parse cache, ModuleLowering refactor.
- lib.rs: emit() split + ProgramCompiler.
- frontend.rs: program_argument_main, entry_function, check_program_closure.
- errors: CaptureNotScalar, CapturedAssignment, ProgramArgumentContainsItself, WithoutChain, UnknownChain, ...
DROP (category B): Param::Program/NestedValue/Inline, nested(site), ProgramSite, bind/View/Splice/Record,
recording, rest, CaptureHostType, Expr::Let/LetValue.

Trigger in Phase 1: builtin `program(<closure literal>, <constant scope>)` -> run-time tuple {code, args}.
Phase 2: closure is a static value (#550), result a static object with holes.

## Status log
- 2026-10-05: plan sent to main (name `program`, callback `program_options`/`programOptions`).
- Commit 22412681 core (sauce-core): programs.rs (ScopeValue, ProgramOptions, ProgramOptionsFn, ProgramReport),
  lower/nested.rs, lower/reach.rs, assembly Place/ProgramEntry/ParseCache/lower_reached, lib.rs emit split +
  ProgramCompiler, Reserved::Program, CAT_PROGRAM (never cache a fn that compiles a program), anchor guard
  (no double render). tests/closure_programs.rs 32 tests.
- Commit 4e41c834 wasm: programOptions callback (scope as bigint), result.programs; smoke checks added.
- Uncommitted: sauce-cli tests/common/programs.rs + v12/svm conformance tests; docs (CLAUDE.md, README,
  wasm README, language-reference "Closures as Programs", builtins-reference program()).
- Gotcha: frontend refuses `a.b.method(x)` (member-of-member call): write `const code = p.code; code.concat(p.args)`.
- Gotcha: ProgramWithoutChain dropped: unset chain = compile's chain (root refuses profiles w/o chain).
- Conformance: `make test-conformance` needs PATH with ~/.foundry/bin ~/.huff-neo/bin solana active_release/bin.
- Agent names: I am v12-551-2; #550 owner is v12-550-2 (NOT v12-550). Requirements sent to v12-550-2.
- main approved plan; CHANGE: `program` NOT reserved — shadowable by fn/import alias/ambient export/local/module
  binding (Lowerer::is_program_builtin). Done in fixup 54c6bdea (autosquash into core before review).
- main: per-chain names are ambient modules; nested ambient resolves closure globals; captured local wins.
  Test a_closures_globals_are_its_own_programs_ambient_modules added.
- Conformance fix: `eval(...).toBe()` refused by frontend (method on call result): bind `const out = eval(..)`.
- Pending: wasm lib.rs chainProfiles doc + wasm README -> fixup of 4e41c834; docs commit; conformance commit.
- make ci GREEN on phase 1 head 73c0cd7e (before rebase onto #550 ff1e24c5).
- PHASE 2 (2026-10-05): rebased onto rewrite/550 ff1e24c5 (#550 usable). Old phase-1 head kept as branch phase1-551.
  Commits now: 2dfa4adb core (+phase 2 wiring), b5d06620 wasm, 6b9e5981 conformance, 8b1412f7 docs.
  Design: Compilation lives in statics::Context (Context::new takes functions list + compilation);
  Lowerer.captures: Option<Rc<Captures>>; Closure.captures + Callee.captures carry them lexically;
  program() hooked in statics/call.rs call_value Identifier branch (is_program_builtin);
  Capture shapes (Scalar/Constant/Bytes/Object/Array/Contract/Class/Undefined/Refused); classes mapped by
  (module path, name); captured objects Frozen; words spilled at program() (snapshot);
  relocate + anchor skip already-rendered reports; raised_in attaches Origin at closure.
  closure_programs.rs 42 tests; engine CASES incl. class Errand, static captures, snapshot: all green.
- TODO: wasm smoke scope string/object; docs rewrite (lead with SDK use); core commit msg reword; make ci/smoke/conformance.
- 2026-10-06: rebased onto rewrite/550 74ef63f2 (after 1ff57274). Commits: fea1e006 core, fe246f2e wasm,
  05bf6aee conformance, 21e233db docs. Branch phase2-on-ff1e = previous phase-2 head.
  Reported to v12-550-2: `p.code.concat(p.args)` inside a frame materializes p (156B vs 69B); class test
  compares only nested bytes until fixed. Gates running (ci3/conf4/smoke3 logs in scratchpad).
- GATES GREEN on 21e233db (base 74ef63f2): make ci 0, test-conformance 0, smoke 0. Next: captured closures (lead: library arrow calling user arrow in one program).
- 2026-10-06 later: captured ARROWS supported (lead's library-arrow case): Capture::Closure, Step paths,
  referenced_names (first-mention order), Captures::roots → load_graph loaded roots (ParseCache; root
  entry registered via register_entry; entry key → index 0 for roots). Class modules loaded as roots too.
  Rebased onto rewrite/550 19fb80e6 (their fix made root byte-equality hold again).
  Commits: 1edc85a0 core, ec1bcc78 wasm, 6de96317 conformance, b4d4589a docs. Gates running (gates4.txt).
  closure_programs.rs 47 tests.
- Rebased onto rewrite/550 fc289592 (review fixes: plain-data const literals are run-time tuple locals again).
  Added Capture::Tuple/List (run-time tuple / known-length array captured per field/element),
  refuse_captured_store (CapturedAssignment for field/element stores into a capture).
  Commits: eedbda37 core, b4ea7cde wasm, 9cdbf337 conformance, bac7059a docs. Gates running (gates5.txt).
- Rebased onto rewrite/550 4c6cfedc (const literals static again). Tests updated (static literal leaves fold;
  run-time tuple via make(), new Array(3) via List). Commits e84aedb5 core, dd03874a wasm, b8810bfe conf, de9a8c2e docs.
  NOTE: I ran `pkill -f 'make ci'` once (2026-10-06) which may have hit other agents' gate runs — never again; use TaskStop.
- 2026-10-06: READY FOR REVIEW sent to main at 61fb568c (base #550 6ff5502e). Gates: ci 0 (3578), conformance 0 (700), smoke 0 (80).
  Sent "#551 usable at 61fb568c" to v12-552r. Next: wait for main's review; on "push": force-push
  `git push --force-with-lease origin rewrite/551:feat/compiler-program-arguments`, rewrite PR body (lead with SDK Intent
  example), one comment; then "#551 final at <sha>" to v12-552r. Use gate.sh + CARGO_BUILD_JOBS=2 for heavy gates.
- PR-BODY-DRAFT.md written (untracked) with ## Interface section per user rule; sent to main. Waiting on review-550 / main 'push'.
- 2026-10-06 REVIEW ROUND 1 (review-550 on 61fb568c, via main): fixing on top, NOT pushed.
  (1) cycles crashed (stack overflow) → identity capture: Capture::Shared(id) + Shape{Object,Array,Closure},
  numbered by Rc ptr in `Shapes` (top closure = shape 0, so self-compile via a method hits ProgramContainsItself);
  rebuild makes each shape empty + registers, then fills (`make`/`fill`, pending list) so cycles share one value;
  closure's `this` made first (object shell). Cyclic scope → new Error::ProgramScopeHoldsItself.
  (2) poisoned/unreadable const literal → captured from its run-time copy (`run_time_copy` = !view_readable),
  leaf reads Expr::Field on mirror.read (marks used). (3) `this` in the program closure: THIS pseudo-capture,
  `captured_this` hooked in members.rs effect_value + closure_value, statements.rs static_root.
  (4) dedupe by binding: Capture::Scalar(ty, Option<Source{Local,Global,Capture}>), Captures::take dedupes by source.
  Reviewer probes copied untracked to sauce-cli/tests/zz_review.rs + zz_p551.rs (git-excluded) — all as expected.
  Tests: closure_programs.rs 53 (6 new), CASES +9 execution cases (v12+SVM).
- Round-1 fixes committed on top of 61fb568c: c9b1503a fix(core), 97a2da9c test, 0a1d9231 docs (+CLAUDE.md).
  GATES GREEN at 0a1d9231: ci 0 (3584), conformance 0 (700), smoke 0 (80). PR-BODY-DRAFT updated
  (Identity / this / run-time copy bullets, ProgramScopeHoldsItself row, test list). Reported to main. NOT pushed.
  q3f (`const f = () => { ... f ... }`) "f is not a declared variable" is #550's (same without program) — told main.
- Dedupe by identity extended (Source::Part for tuple/array fields + copies, Source::Outer for nested): byte tests
  (library two arrows == one written-out arrow, byte-equal) + engine case args.length=128. Fixups squashed.
  Backup of pre-rebase head: branch backup-551-r1-on-6ff5 (cbc55f35).
- REBASED onto rewrite/550 8a5c74f1 (.catch on static = method): HEAD ee1f0e67 (33ce26c0 core, b71f06e3 wasm,
  002c31ef conf, cef091c3 docs, a171d854 fix, ce49dcfb test, ee1f0e67 docs). sauce-core tests green.
- NEXT: when v12-550-2 announces the dotted-path commit (f3e54781 local, Artifact::absent_paths / AbsentPath /
  npm absentPaths): rebase onto it, add ProgramReport::absent_paths (+ wasm programs[i].absentPaths, smoke check,
  closure_programs test: nested program folds its chain's absences), Interface section row, then 3 gates, report.
- TRIAL branch `trial-absent` = rewrite/551 rebased onto f3e54781 (unannounced #550 dotted-path commit) + 3 commits:
  2e9f6381 feat ProgramReport::absent_paths (+wasm absentPaths), 52b81fdc test (closure_programs 55, smoke +1),
  b67569c1 docs. Conflicts resolved: lib.rs (Artifact both fields, emit 5-tuple), assembly.rs (lower_at keeps
  absent truncate for held fns), context.rs (both fields), wasm lib.rs/README (both). Asked v12-550-2 if f3e54781 final.
  When announced: if same sha → `git branch -f rewrite/551 trial-absent`; else redo rebase. Then 3 gates, report.
  PR-BODY-DRAFT: absent_paths row + TS example done; update test counts after gates.
- GATES GREEN on trial-absent b67569c1 (base f3e54781): ci 0 (3588), conformance 0 (700), smoke 0 (82). PR body counts updated.
- v12-550-2: f3e54781 NOT settled (awaiting main on two guardrails: no fold vs `undefined`; only module-rooted paths).
  API shape stable (Artifact::absent_paths, AbsentPath{name,path,start,end}, Context::absent, 5-tuple). Wait for
  "#550 usable at <sha>", then rebase rewrite/551 (base 8a5c74f1) onto it, re-apply trial-absent's 3 commits, gates, report.
- main: f3e54781 approved as is. rewrite/551 MOVED to trial-absent head b67569c1 (old rewrite/551 kept as backup-551-on-8a5c).
  Reported ready at b67569c1; main sends it to review-550 for re-check. One more #550 commit (SDK gaps) coming:
  rebase onto it before the push when main says.
- v12-550-2: #550 f3e54781 PUSHED (guardrails approved). rewrite/551 b67569c1 already sits on it. Next #550 commit
  (G1–G9 SDK gaps) coming: rebase onto it when announced + main says.
- Re-review of b67569c1 (main): ONE defect — captured roots looked undeclared to #550's absent-path rule
  (names_anything ignored captures) → `cfg.a != 0` folded to 0. Fixed in statics/members.rs absent_path
  (capture = declared + never looked into, like a local): ef5b39e8 fix, b2208857 test (closure_programs 56, +1 engine
  CASE 12111). Reviewer probes q12–q14 all correct after fix. Gates r3 running at b2208857.
- GATES GREEN at b2208857: ci 0 (3589), conformance 0 (700), smoke 0 (82). Reported to main.
- TRIAL `trial-g19` = rewrite/551 (b2208857) rebased onto #550 4ec8ce00 (G1–G9, NOT pushed/approved yet).
  Conflicts: statics/mod.rs (+members::unparenthesized), statements.rs declare_named_closure needs `captures`,
  v12_conformance.rs (both tests). Also fixed my old doc misplacement (raised_in between relocate's doc and fn).
  + test: self-compile through own name → ProgramContainsItself (named closures now exist in #550).
  When v12-550-2 says "#550 at <sha> (pushed)" and main says rebase: branch -f rewrite/551 trial-g19 (if sha same).
- GATES GREEN on trial-g19 87c984f9 (base 4ec8ce00): see r4 counts. Waiting for #550 push + main.
- main: keep trial-g19; one more #550 commit (G10 contract imports as values, G11 once-read arg substitution, G12 unset-field error) on top of 4ec8ce00; both pushed together after review. Rebase onto that final head when v12-550-2 announces pushed; combined review then runs on my rebased head.
- TRIAL `trial-g12` = trial-g19 rebased onto #550 b1175679 (G10–G12, unpushed). Conflicts: walk.rs (first_read +
  referenced_names), v12_conformance.rs, nested.rs (took fix version + re-added Capture::Abi for Static::Abi in core
  and fix commits). + test commit (contract import captured as value; Unset error in closure). closure_programs 58.
  FOUND #550 gap: `const kind = Courier; kind.at(h).probe(g)` with module-let (global) operands is 1 byte larger
  than `Courier.at(h).probe(g)` (arg order + swap) — reproducible in a root program; reported to v12-550-2 + main.
- GATES GREEN on trial-g12 388a16f7 (base b1175679): ci 3599, conformance 702, smoke 82.
- main: b1175679 is #550's final candidate. Sent 388a16f7 (trial-g12) for the combined final review. On go (after #550 pushes): branch -f rewrite/551 trial-g12, force-push rewrite/551:feat/compiler-program-arguments, body, comment, DRAFT, then '#551 final at <sha>' to v12-552r.
- main: combined review found G11 regressions in b1175679; #550 makes one more commit (conservative substitution + my alias 1-byte fix). Rebase trial-g12 onto it when announced; reviewer re-checks G11 + my head; then both push.
- trial-final = trial-g12 rebased onto #550 6fbb5dc7 (alias fix); contract-import test now also byte-equal to by-name import. GATES GREEN at 8d3d5a27: ci 3599, conf 702, smoke 82.
- main: 6fbb5dc7 = alias fix only; conservative G11 rule = one more #550 commit. Rebase trial-final onto it when announced, gates, send sha; then reviewer G11 re-check + zz_p551 rerun; both push.
- trial-final rebased onto #550 b67d8080 (G11 conservative): 2b74137a. Conflicts: v12_conformance (both), language-reference absent paragraph (took #550's + my sentence). GATES GREEN: ci 3600, conf 703, smoke 82. Next: #550 G11b/G13/G15 commit = final rebase.
- G16 (SDK): closure programs didn't see entry contracts/inline_contracts. Fixed: pass them + ProgramEntry::contracts_at → contracts_module (module of root entry path). Commits on trial-final: fix/test/docs. closure_programs 59, smoke +1.
- Reported G16 fix to main at 3f9ed4cd (trial-final on b67d8080). Full gates deferred to after the G11b/G13/G15 rebase.
- trial-final rebased onto #550 FINAL candidate be24a885 (clean, no conflicts): b66550e8. GATES GREEN: ci 3605, conf 703, smoke 83. Sent to main; reviewer reruns zz_p551. On go (after #550 pushes): branch -f rewrite/551 trial-final; push.
- main: b66550e8 clean (no findings). #550 pushing 137f2ec8. Rebased trial-final onto 137f2ec8 → 0e59032e (backup-551-b665 = b66550e8). Gates r10 running. If green + #550 pushed: branch -f rewrite/551, force-push, title/body, comment, DRAFT, '#551 final' to v12-552r, reply main with sha+URL. If red: stop+report.
- PUSHED 2026-10-06: rewrite/551 = 0e59032e force-pushed to feat/compiler-program-arguments (on #550 137f2ec8). Gates: ci 3606, conf 703, smoke 83. Title/body updated from PR-BODY-DRAFT.md, comment posted (rewritten for class design), PR stays DRAFT. Sent '#551 final at 0e59032e' to v12-552r. Reported to main.
- v12-550-2 confirmed #550 final at 137f2ec8 (pushed) — #551 0e59032e already sits on it. Done; idle until new instructions.
- main: fix captured-field-write code (was StaticConstantWritten via Home::Frozen). Added Home::Captured + Compilation::captured (ptr→path) + require_writable → CapturedAssignment (new msg names path + closure). Commits 0da240c3 fix, 5e84bc82 test on 0e59032e. Gates r11 running. Then FAST-FORWARD push (no force), tell v12-552r + main.
- PUSHED fast-forward 5e84bc82 (CapturedAssignment fix). Gates ci 3606, conf 703, smoke 83. PR body diagnostics row updated. Told v12-552r + main.
- Body-only update: intent syntax → Optimism.hop({reward, receive, refundee}).then(...) / await form; chain 10. gh pr edit done, no comment. (PR shows isDraft=false — main marked it ready.)
- main marked #551 READY after CI 15/15 on 5e84bc82. Standing by for review threads (fix requested changes as fast-forward commits; never merge/close/retarget/approve).
- main: docs fixup pending: after v12-550-2 pushes #550 docs commit → MERGE (merge commit, no rebase/force) feat/compiler-host-declarations into rewrite/551, then docs(compiler) commit switching Closures-as-Programs example (~l.537) to Optimism.hop/await; FF push; tell v12-552r + main.
- Merged #550 6bed847f (merge 825cadcf) + docs(compiler) 2e9a25af (Closures as Programs → Optimism.hop/await). FF pushed. Told v12-552r + main.
- Stack absorbed v12 main by merges: feat/compiler-program-arguments = 9933577a. Local rewrite/551 reset to it (backup-551-2e9a). Local closure conformance (v12+svm, with #558 Pot.eval) green. Watching CI.
- CI on 9933577a: all 15 checks pass (incl. v12 + SVM conformance harnesses). Reported to main.
- Stray-file request: file NOT on origin/feat/compiler-program-arguments (9933577a) nor any remote branch; 688e12fe is an old local pre-fixup commit. Only local rewrite/555-557 (at stale 3d44424c) + backups have it. No commit made; told main.
- main confirmed: no stray copy on #551/#552/#553; no cleanup commit. Standing by on #551 (head 9933577a, ready for review).
- main: capture-keyed ProgramContainsItself. nested::ProgramKey{module,span,arrows:BTreeSet} replaces (String,Span) in Compilation::closures/Request; guard after shapes. Commits 61630013 fix, f27d9fed test (a–d), 10fbe7cb docs on 9933577a. Gates r12 running. Then FF push + one PR comment + body guard text + '#551 final' to v12-552r & main.
- PUSHED FF 10fbe7cb (capture-keyed guard). Gates ci 3609, conf 704, smoke 83, base_bytecode 0 movers. PR body + comment updated. Told v12-552r + main. Standing by.
- Captured-let fix: Compilation::captured_cells + is_captured_cell hooks in static_assignment and store_to_local → CapturedAssignment on both paths (=, +=, ++). ProgramKey::new added. Kept my pushed guard (10fbe7cb, equivalent to v12-554r's 505e49ad Written) + added their test. Commits 7c8df5a8 fix, d9de0a90 test. Gates r13 running.
- PUSHED FF d9de0a90 (captured-let CapturedAssignment + v12-554r's test + ProgramKey::new). Gates ci 3611, conf 704, smoke 83, base_bytecode 0 movers. PR body + comment. Sent '#551 final at d9de0a90' to v12-552r, review-550, main. Standing by.
- PUSHED FF d7dce3b4: CapturedAssignment names user's written path (written param through rebuild/make/fill). Targeted tests green (closure_programs 63, static_values 40, base_bytecode). PR comment. Told v12-552r + main.
- main: cascade: #549 squash-merged into v12 main; v12-550-2 merging main into #550. On '#550 final at <sha>': merge into feat/compiler-program-arguments (merge commit), gates, FF push, comment, '#551 final' to v12-552r + main. Report problems promptly.
- Merged #550 b73446ab (main incl #549 squash) → 750a2bdb, no conflicts; gates ci 3611 conf 704 smoke 83; pushed FF; comment; told v12-552r + main.
