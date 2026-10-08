# #555 specialization port — notes (v12-555r)

Base: #554 usable 78c0a9eb (rewrite/554, worktree ../554). Branch rewrite/555 reset onto it 2026-10-07.
Old: backup/feat-compiler-specialization-20261005 (b931269c), old base backup/feat-compiler-await-20261005.
Old own commits: d48563ff..e66f90be (15, non-merge). Old specialize.rs = 1018 lines.

## Plan (keep / drop)
Keep: lower/specialize.rs (Known, known_value, Specializations::rewrite, LIMIT 64, may_decide),
Copying impl of Lowering in assembly.rs, trial lowering + rollback, CAT_PARAM keys (fn_cache specialized_context),
nested-program/try-holder cache key, "called only through copies is checked as its copies", map_exprs (ir.rs).
Drop: host constants as known, reach_host / SpecializationAbandoned / Mentions, rollback of host contexts/sites/reports.
Reconcile with #550: static arg -> compile-time execution, not specialization.

## State
2026-10-07: plan sent to main, OK in principle. Lead STOPPED implementation: wait for "#554 final at <sha>" from the
lead, then branch from that PUSHED head (not local rewrite/555). Early ir.rs/unroll.rs edits (map_exprs/map_leaves
moved from unroll's substitute walk into ir.rs) stashed: `git stash list` -> "v12-555r early start".
Before starting: re-read REBASE-BRIEF.md #555 addenda (Token(X).balanceOf(ctx.self()) 1-byte gap; decided
`=== undefined` guard treated as clean; `undefined` to an annotated param -> Unset at the argument), fold into the
plan, and send the lead the delta. Until then read code only.
Design notes: Known lives in FunctionState (shared with compile-time frames). Productive also when an executed
call's arguments read a known value, and when names_read captures a known local (program()/try fold).
Rollback = globals count, compilation.ids, compilation.reports, context.absent, compilation.captured.
2026-10-07: v12-554r says "#554 final at daed46d1" (origin/feat/compiler-await). Sent lead the addenda delta:
(1) walk.rs first_read gets a decider from the call's args: `p ===/!== undefined` on a known param is decided,
clean, walks only the taken arm (fixes 84 vs 82 / Token 66 vs 65); (2) call_function: no-run-time-form arg to an
ANNOTATED param -> materialize refuses at the argument (Unset naming the path, else StaticAtRunTime).
WAITING for the lead's go before any change. Then: fresh branch from origin/feat/compiler-await (daed46d1).
2026-10-07 GO from lead. rewrite/555 reset to daed46d1; commits: c0a21eb9 refactor (ir::map_exprs/map_leaves, unroll uses it),
cd6b4c57 feat (specialize.rs + assembly Copying/Changes/Held/Stands + hooks). sauce-core tests + base_bytecode green.
General const-arith folding GROWS corpus/ecoswap-route-brackets -> derived consts known only when they read a known value.
Next: tests/specialization.rs (port old, generic), boundary tests vs #550, conformance (v12/svm), try-holder cache key,
docs (compiler/CLAUDE.md, docs/saucescript/language-reference.md), addenda (WAIT for lead OK), gates, PR-BODY-DRAFT.md.
2026-10-07 commits: 2721d31e test, 3cedb22d test(await), 764f74f4 perf (CAT_BLOCK try-holder cache key: Compilation.options/block_key,
compile_block -> (bytes, compiled_programs)), docs commit. Next: gates via gate.sh; addenda after lead OK; PR-BODY-DRAFT.md.
2026-10-07: gates GREEN at 93812c2d (pre-addenda): make ci 3704 passed, test-conformance 741 passed, smoke OK.
Lead GO on addenda with constraint: item 2 refuses only REQUIRED annotated params (no `?`, no default); optional b?: Uint256
must keep working with item 1 (f(1) with `if (b === undefined)` compiles the taken arm only, byte-identical). Defaults are
rejected by the frontend ("a default parameter value") - tell lead. Order: addenda fix commits FIRST, then specialization.
Specialization commits saved on branch spec-555 (+ tag local/555-spec-before-addenda = 93812c2d). rewrite/555 reset to daed46d1
to commit addenda, then `git cherry-pick daed46d1..spec-555`.
2026-10-07: addenda done. New history on rewrite/555: 736132f1 fix(guards) 5de1922d fix(required param) ea3f915b docs,
then cherry-picked spec: 0ec2a55f refactor 761cf85e feat a9bd3e93 test da38d862 test 74... perf 745745d3 docs 2155102e docs(programOptions).
Running ci+conformance+smoke chained in background (logs scratchpad 555-*2.log). Then report "#555 ready for review at <sha>".
Defaults (`b = 5`) are refused by the frontend -> told nothing yet; mention in ready report.
2026-10-07: GATES GREEN at 2155102e (ci 3707, conformance 741, smoke 86 ok). base_bytecode: only the 8 pre-existing SMALLER movers.
Reported "#555 ready for review at 2155102e" to team-lead. review-550 reviews next; WAIT for "push".
On push: git tag backup/feat-compiler-specialization-20261007 origin/feat/compiler-specialization (old head b931269c);
git push --force-with-lease origin rewrite/555:feat/compiler-specialization; update PR title/body from PR-BODY-DRAFT.md;
one short comment (rewritten for the class design); leave DRAFT. Not told v12-556r "usable" yet (lead coordinates).
2026-10-07 ~15:10Z: lead said push. Backup tag backup/feat-compiler-specialization-20261007 -> b931269c CREATED via API (git push 500s).
git push to eco-incorp/v12 fails with Internal Server Error (ssh+https). Retry loop bt2j21cft pushes explicit sha 2155102e5de17b9ec1c8d65561adf77e3725b297
with --force-with-lease=feat/compiler-specialization:b931269c. NEVER push HEAD while detached. t4 probe equal at 44c42d89 and 2155102e (eval behaviour from merged engine #558).
After push: gh pr edit 555 --title/--body-file PR-BODY-DRAFT.md; one comment (rewritten for class architecture, same number, old head in backup tag, eval try from merged engine);
keep draft until CI green, then gh pr ready 555; send "#555 final at 2155102e".
2026-10-07 18:30Z: PUSH LANDED (try 4, ~15:17Z) at 2155102e. PR title/body/comment NOT yet updated.
Lead: size regression (review-550): fix before ready. Baseline sizes (ce49eef5 == compiler-v2.5.0) in scratchpad 555r-sizes-ce49eef5.txt;
harness zz_size.rs copied (untracked) into sauce-core/tests. Per-param baking (WIP, uncommitted) -> tryCurve 598 but 7 router fns still larger
(baked address params read as PUSH20 everywhere). Switching design: a copy keeps ALL params (passed at the call); known values are used only
where they decide (decision points substitute known locals), fold into captures/program scope, and forward via a per-copy param map.
decide-only design built (WIP-decide-only.patch, uncommitted): all router+generic <= base at both levels; tryCurve 606 (target ~599).
Next: bake (drop from signature+call) known params with NO run-time read left after a decide-only lowering (second lowering with baked set).
2026-10-07 ~19:30Z: size fix committed: 9e1fe699 fix (decide-only copies + drop unused params), 9ddb06d9 test (guard specialize/ shapes,
baselines from ce49eef5), 02f73dc4 docs. Sizes: all router fns <= 2.5.0 both levels; tryCurve 598/598. zz_size/zz_fp harness moved to scratchpad/555r.
Next: gates (ci, conformance, smoke) -> push fast-forward -> PR comment (regression, fix, corpus, + rewrite note, eval from merged engine)
-> update title/body -> draft until CI green -> gh pr ready 555 -> "#555 final at <sha>" to v12-556r, sdk-class, team-lead.
2026-10-07: lead pushed 68ddccf5 (FF). Gates on 68ddccf5: ci 3709, conformance 742, smoke ok. PR comment posted (issuecomment-6047265709),
body updated. CI watcher by6743gzf running; on green: gh pr ready 555, then "#555 final at 68ddccf5" to v12-556r, sdk-class, review-550, team-lead.
Open nit: programs.rs/wasm docs say programOptions asked "once for each copy" (actually twice: decide + make) -> lead to decide.
2026-10-07: lead: fix the docs nit as a docs-only FF. Pushed 750357f3 (docs: programOptions may be asked more than once for one program call;
programs.rs, sauce-wasm lib.rs TS doc, sauce-wasm README:172), lease on 68ddccf5. "#555 final at 750357f3" sent to v12-556r + team-lead.
CI watcher b64cmqrzu; on green: gh pr ready 555, then tell team-lead.
2026-10-07 ~20:30Z: lead: bake-vs-decide per copy (sdk-class found decide-only regressed constants that decide AND are encoded:
repro1 41->44, repro2 66->92, uniswapV4 const tokens 215->286). CI green on 750357f3 but PR stays DRAFT.
Design (uncommitted, gating): specialize::Form {Decides, Constants}; Knowing::{Decides, Constants} in assembly (same names as #556);
Constants = known params declared const (know_constant) + const derived from them (specialize::Constants read count, statement.rs);
Specializations::choose lowers both (trial, restore), weighs via Lowering::width = crate::function_width (fold::function at -O,
eval_order::function, dead_store::function, codegen::function_width) + push widths of known args still passed; Constants only if strictly
smaller. chosen: Asked->Key; copies keyed (fn, form, values). Compilation.optimize plumbed (lib.rs x3).
Results: every router fn = min(2155,68dd) at both levels; tryCurve 598; repros 41/41, 66/84 (== 2155 bytes).
Guard: specialize/ordered-pair + keyed-pair recorded from 2155102e (fingerprints via node fp.mjs on sauce-compiler-2155).
Tests: unit (constants form, wide stays arg, recursion both forms, LIMIT arity 1), byte claim in specialization.rs, 2 executed cases.
Docs: module doc, language-reference, CLAUDE.md, programs.rs/wasm (callback asked: decide, each form, make).
Pending: SDK 8 programs (asked sdk-class for script; tools/sizes/ exists), gates, commit, push FF, comment, body, final to
v12-556r (heads-up: #555 now has Knowing::Constants for copies), sdk-class, review-550, team-lead.
2026-10-07 ~22:30Z: lead added (a) assigned_names shadowing fix (arrow's own params/top-level locals) and (b) copies vs shared fn by
TOTAL size (trade 1/0/2 repro 189 on 2.5.0 vs 236). Done (uncommitted, gating as bggpzyduo: ci7, conf7, smoke7 logs in scratchpad):
- choose: weigh (memo by Key) = trial lowering + sub-calls dropping what their copies take (drops -> choose recursively, within guard)
  + without_unused; width in own frame (entry = Main); + caller emitted both ways (Site). chosen memo per asked.
- share: in assembly::program BEFORE into_inner; per fn with copies: lower_reached-unlowered fn lowered transactionally (Changes mark +
  Specializations clone), shareable iff nothing reached from it held/unlowered, specialize::shares compares reached widths both ways,
  commit = calls_declared on lowered + map_bodies on copies. Skipped in try-block programs (guards_frame).
- Results: router all = min(2155,68dd) both levels; repros 41/41, 66/84; trade3 189/187; shadow 20/29.
  SDK tool vs rewrite61-2155102e: 79 same, 2 smaller, 0 larger. vs main-2.5.0: payout+12, globals+11, ds+54, buy-stock+2, fbt+1 =
  SDK-side (replay of SDK-main inputs: equal to 2.5.0 at -O; tool on sdk-main tree w/ my pkg: 42 same 3 smaller 0 larger).
- Tools: scratchpad/555r/bake/{logpkg (logging wrapper pkg), one-file.mjs, replay.mjs, fp.mjs, sizes.mjs, router.mjs}, zz_replay.rs.
Commits planned: (1) fix shadowing (walk.rs + tests), (2) fix forms + sharing (+ tests, corpus, docs). Then push FF, comment, body,
final to v12-556r, sdk-class, review-550, team-lead.
2026-10-07 ~23:30Z: PUSHED 6dd0e358 (FF of 750357f3): 418b000c fix shadowing, 6dd0e358 fix forms+sharing. Gates: ci 3717, conf 742,
smoke ok. Comment issuecomment-6048513743, body updated. Finals sent to v12-556r, sdk-class, review-550, team-lead.
CI watcher br38h644n; on green: gh pr ready 555 --repo eco-incorp/v12, tell team-lead.
2026-10-08 ~00:30Z: lead asked compile TIME (msg arrived after 6dd0e358 push). Found #555's ebfcf057 CAT_BLOCK floor (options + block key
Debug-hashed every define/module value on every compile; "try" substring matches "registry"). Fixed lazily: 4188538a perf (BlockKey
OnceCell in Compilation, options as Rc<dyn Fn>, fn_cache::lookup takes &dyn Fn, share width memo, caller-skip when dropped equal) +
6b2dff83 docs. Reverted a "skip constants weigh" idea: it changes chosen-memo order. No bytes changed (81 SDK bytecodes identical).
Times (median of 5): sdk-main 2.5.0 215/200, 554 224/212, 2155 439/426, new 232/220; worst x1.92 distributed-swap. rewrite61: 554 1729,
2155 1940, new 1717. SDK tree moved (sdk-class cdc63a81) -> rewrite61-2155102e.json stale; vs 2155 on current tree 79 same 2 smaller.
PUSHED 6b2dff83. Comment issuecomment-6048883041. Finals sent to all four. BLOCKER: GitHub Actions ran nothing repo-wide since 22:24Z
(no runs for 6dd0e358/4188538a/6b2dff83; mergeable UNKNOWN). PR stays draft. Scratch worktree $SP/wt-554 (daed46d1, built pkg).
2026-10-08: PUSHED 9f0cd9c5 = e8b7ad83 (phantom fix: Made::changed + relower loop w/ declared_only; Site::widths linear weighing)
on 6b2dff83, merged with cascade head f72798a3 (#549 squashed into main by user). Gates: ci 3718, conf 742, smoke ok.
Bytes: SDK 81 == sdk-class rewrite61-6dd0e358.json bar; router/generic identical; sdk-main 42 same 3 smaller vs 2.5.0.
Timing (interleaved replay, tools: scratchpad/555r/bake/{log-all.mjs, replay-all.mjs, logs-*}): see issuecomment-6049555197.
B3d = #551 (44adb11b reached-only) x #550 (a46431f4 held calls counted from every lowered fn); reported, not fixed.
Hold gh pr ready until CI green AND review-550 clean (lead). Scratch worktrees: $SP/wt-554 (daed46d1), $SP/wt-6dd (6dd0e358).
2026-10-08: PUSHED c553e59c (fix: held calls counted only from functions the entry reaches, called_from; B3d pinned in
tests/specialization.rs both ways). Gates ci 3719, conf 742, smoke ok. Bytes identical (SDK == rewrite61-6dd0e358.json,
router/generic). infinityCL isolated: 7-12 ms vs 5.1 on 2.5.0 (31 ms was noise). Comment issuecomment-6057656378.
tools/sizes: added logger/, log-all.mjs, replay-all.mjs, times.mjs + README lines (sdk-class asked).
Still: gh pr ready only when CI green AND review-550 clears e8b7ad83 + c553e59c (lead).
2026-10-08: CI green on c553e59c; review-550 cleared e8b7ad83+c553e59c; gh pr ready 555 done. #555 DONE.
2026-10-08: scratch worktrees wt-554, wt-6dd removed (lead). Standing by for review threads on #555.
