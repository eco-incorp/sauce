# #554 await port — notes (v12-554r)

Base: #553 final 59feffbb (feat/catch-revert-data). Branch rewrite/554. Old: backup/feat-compiler-await-20261005.
Approach: parse-time AST desugar `frontend::desugar_awaits` after `check` (entry in lib.rs, imports in
assembly.rs loader): `await x; rest` -> `x.then(() => { rest });`, in a try `.catch((e) => { H })` too.
Lowering only diagnoses: a desugared `then` call starts before its receiver (frontend::awaited).
Plan sent to main 2026-10-07.

## State 2026-10-07
Commits on rewrite/554 (on 59feffbb):
- 505e49ad fix: Written key (module, span, captured arrow spans) for ProgramContainsItself — PROPOSED to main, awaiting OK; drop if refused (then cascade-in-try tests fail)
- 5743e53a feat: frontend/awaits.rs desugar + Place checks + AwaitWithoutThen/AwaitInTryWithoutCatch
- 5c3e3239 test: v12/svm/try_conformance + smoke
- 1889c42c docs
Next: gates via gate.sh (make ci, test-conformance, smoke), PR-BODY-DRAFT.md, report "#554 ready for review".

Rebased (autosquash) 2026-10-07: 505e49ad fix, 11d20ebc feat (+function-expression handlers), 2df4f6ff test, 78c0a9eb docs.
make ci green at pre-squash state (3654 passed). Now running test-conformance, smoke, ci via gate (logs in session scratchpad 554-*.log).
PR-BODY-DRAFT.md written (untracked).
2026-10-07: gates green at 78c0a9eb (ci 3654, conformance 738, smoke all). Reported "#554 ready for review at 78c0a9eb" to main; told v12-555r "usable at 78c0a9eb". Waiting for main: review + OK on 505e49ad (Written key). Do NOT push until main says "push".
2026-10-07 later: main moved the guard fix to #551/#552. Saved as /Users/er/Documents/Projects/v12-class/patches/capture-keyed-guard.diff, sent to v12-551-2. Dropped 505e49ad.
rewrite/554 now: 1a979c7d feat, fc2cd13d test, a92340bf docs (on 59feffbb). 3 awaits.rs try tests (two awaits in one try) FAIL until #553's new head (with the guard) arrives; then rebase onto it and rerun gates.
2026-10-07: review fix (MEDIUM) done: 8cce1078 fix(compiler): refuse a value return after an await (frontend returned_after_await, test a_value_return_after_an_await_is_refused, docs). Verified: with guard patch applied temporarily, all sauce-core tests pass (1916). Waiting for "#553 final at <sha>" to rebase (drop nothing else; guard comes from the stack) + regate.
2026-10-07: rebased onto #553 final d0ccadf7 (guard now in the stack as ProgramKey). rewrite/554 = 0067ddf8 feat, 96c9d8b0 test, ae3146a7 docs, ffc7569e fix. awaits 16/16. Gates running (logs 554b-*.log in session scratchpad).
2026-10-07: fixed AWAITED fixture (no value return), squashed into fix commit. rewrite/554 = 0067ddf8 feat, 96c9d8b0 test, ae3146a7 docs, 2e43184b fix on d0ccadf7. Gates green: ci 3659/0, conformance 738/0, smoke 86 ok (at ffc7569e, wasm-identical). Reported ready to main. No push until "push".
2026-10-07: rebased onto #553 final 44c42d89 (test-only over d0ccadf7). rewrite/554 = f075201d feat, 4a493a32 test, 1b2ea77b docs, daed46d1 fix. Gates green at daed46d1: ci 3660/0, conformance 738/0, smoke 86. Reported ready; review-550 re-reviews before push.
2026-10-07: PUSHED daed46d1 to feat/compiler-await (force-with-lease from 228e431d); tag backup/feat-compiler-await-20261007 pushed; PR #554 title/body replaced, comment posted; still DRAFT. Waiting for CI on daed46d1, then `gh pr ready 554` and send "#554 final at daed46d1" to v12-555r, sdk-class, main.
2026-10-07: CI green (15/15) on daed46d1; marked ready; sent final.
2026-10-07: NEXT (cascade after #549 merged to main): on "#553 final at <sha>" from v12-553r -> git merge (merge commit) origin/feat/catch-revert-data into feat/compiler-await (rewrite/554 == daed46d1 == pushed), gate ci/conformance/smoke via gate.sh, push (no force), one PR comment, send "#554 final at <sha>" to v12-555r + main. Report problems immediately.
2026-10-07: main pushed cascade merge fc19fc25 (#553 701dccb4); local aligned; PR comment posted. Done.
2026-10-08: USER relax: await in tail-if branches. Commits a916b2ad feat, 125694ab test, 1d3406c8 docs on fc19fc25. Message uses 'wherever the branch taken continued' (not 'chain': no SDK vocab in compiler). Gating next; then fast-forward push + comment + '#554 final'.
2026-10-08: pushed 1d3406c8 (ff), body updated, comment posted, final sent to main + v12-555r. Watching CI.
