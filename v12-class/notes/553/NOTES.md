# v12-553r notes (crash recovery)

PR #553 `feat/catch-revert-data`, local `rewrite/553`, worktree here. Base: #552 435c0f62
(`feat/compiler-try-catch`, pushed, final). Below: #551 2e9a25af, #550 6bed847f. Above: #554 `v12-554r`.
Lead: `main`. Old head: `backup/feat-catch-revert-data-20261005` (old base
`backup/feat-compiler-try-catch-20261005`; old net patch in scratchpad 553/old553.patch).

## Plan (sent to main 2026-10-06)
Keep: engine CAUGHT_RETURNDATA (+forge, AUDIT, STABILITY BREAKING footer commit, Runtime.huff tail count),
Expr::Caught for `catch (e)` and built-in `.catch((e)=>…)`, refusals, codegen handler stack fix,
lower/engine.rs lazy read (replaces #552 per-block STATICCALL), conformance, docs.
Drop: host-handler e (ClosureParameter, guarded_main), View::Constant (9719cbf1).
Add: ERRAND class test with `catch (e) { fallback(e); }` byte-equal + run on v12 both paths.

## Status
- a9b69fba: engine commit cherry-picked (349b5cba) clean.
- 8b54fdcc catch(e) compiler; 5456ca11 engine.rs lazy read; d13ebe26 conformance+smoke; 663b0ead Runtime.huff
  count; 4102de92 STABILITY BREAKING footer; 74a104df docs. make ci GREEN 3632/0 (at 74a104df).
- OPEN QUESTION to main: `fallback(e)` when stored arrow takes 0 params -> CompileTimeArity (#550).
  Proposed: arrows called in place drop extra args (JS); alt: f.length. Awaiting answer.
- main (origin/main ce49eef5) moved past the stack base: #558 EVAL relay (eval runs as Pot -> eval docs
  about block-try change), #523 REQUIRED_ENGINES gate exists. Flag in report.
- PR-BODY-DRAFT.md written (GATES/GAS placeholders to fill).
- Autosquashed; head 50b2a126 (tree == gated 74a104df). Gates GREEN: ci 3632/0, conformance 731/0,
  smoke 85 ok, forge test 1360/0 (6 skipped). Gas probe (scratch gasprobe.rs) numbers in PR body.
- Reported "#553 ready for review at 50b2a126" to main. Waiting: arity answer + "push".
  Push: git push --force-with-lease origin rewrite/553:feat/catch-revert-data; retitle/rebody from
  PR-BODY-DRAFT.md; one comment "rebased onto the class design"; leave DRAFT.
- main approved option 1 (arrows drop extra args). d7875111 feat(compiler): Callee::arrow in statics/frame.rs
  + tests (static_values, try_catch, try_conformance both fallbacks, v12_conformance) + docs.
  Gates GREEN at d7875111: ci 3634/0, conformance 732/0, smoke 85 ok (forge unchanged 1360/0).
- Added '## Meeting main' to PR body (#558 eval, REQUIRED_ENGINES, Runtime.huff). Sent ready at d7875111. Waiting for review + push.
- Meeting main corrected: STABILITY.md conflicts with #561; Runtime.huff merges clean (merge-tree).
- PLAN CHANGE (main): stack absorbs v12 main bottom-up via merge commits on pushed PRs. WAIT for main's
  sha of #552's merged head, then REBASE rewrite/553 onto it (backup tag: local branch backup-553-d787 at d7875111).
  Then: re-verify eval + block try under #558 (EVAL -> Pot.eval, static DELEGATECALL as the Pot; inFlightEngine
  answered by Pot; block writes fail static -> catch runs?), rewrite eval docs (reference eval paragraphs,
  Try/Catch bullet, builtins eval para, CLAUDE.md, README?) + EVAL_BLOCK conformance test to measured behaviour;
  resolve STABILITY.md vs #561; add REQUIRED_ENGINES line (release-compiler.yml); common/mod.rs pot_answering
  vs main's eval-answering pot_code; re-gate all + forge; turn "Meeting main" into what was done.
- Ownership: v12-552r does the combined stub Pot (gateSalt+inFlightEngine+eval) and #552's eval docs/test.
  On its sha: rebase; adjust only MY parts (my eval paragraph+test measured, pot_answering(any address)
  for codeless test, STABILITY vs #561, REQUIRED_ENGINES), gates + forge, report.
- REVIEW FIX (user decision): CATCH flag. Engine: call handlers back to 0/no copy; CATCH immediate 0xFF
  (CATCH_READS) marks a reading handler, len next byte; do_catch_reads copies (CAUGHT_RETURNDATA). Plain
  handlers max 254. Compiler: codegen reads_caught -> emit 0xFF; catch_length limit 254/255.
  Commits fd312e31 (engine) + 24febb89 (compiler). Gates: ci 3635/0, conf 733/0, smoke 85, forge 1368/0.
  Gas: unread +22/CATCH vs #552 (same loop 1000: 1,977,381 -> 1,999,381); read pays copy.
  Backup branch of pre-flag head: backup-553-d787.
- Reported CATCH flag ready at 24febb89 to main. Next: wait for #552 new head from v12-552r -> rebase; then eval re-verify, STABILITY vs #561, REQUIRED_ENGINES.
- 2026-10-07: rebased onto #552 61723da6 (merged main, #558). Backups: backup-553-d787, backup-553-flag (24febb89).
  New: b3477c43 eval re-measured (block under eval runs via Pot; write burns ~930k/1M), 6b9ea638 REQUIRED_ENGINES
  + config test. Gates GREEN at 6b9ea638: ci 3636/0, conf 735/0, smoke 85, forge 1427/0/6, cjs 10/10.
- PUSHED 2026-10-07: 59feffbb (rebased on #552 11dba3b4, docs-only ff; reworded BREAKING footer commit 969cb555
  for the flag design; tree == gated 217b74e8: ci 3636/0, smoke 85; conf 735/0 + forge 1427/0 at 6b9ea638
  same code). PR retitled, body = PR-BODY-DRAFT.md, one comment posted, still DRAFT. main marks ready after CI.
- NEXT (main 2026-10-07): wait for v12-552r '#552 final at <sha>' -> MERGE (merge commit) into feat/catch-revert-data (rewrite/553 == pushed 59feffbb), gate.sh (ci, conformance, smoke, forge), push, send '#553 final at <sha>' to v12-554r and main. No other change.
- 2026-10-07: merged #552 final 8600a4c3 -> d0ccadf7 (conflicts: CLAUDE.md, reference recursion/error bullets, try_catch.rs both tests kept). Probe: nested catch (e) through HOP finisher compiles. Gates running (ci7/conf7/smoke7/forge7 logs).
- PUSHED d0ccadf7 (merge of #552 final). Gates: ci 3641/0, conf 735/0, smoke 85, forge 1427/0/6. Body gate line updated. Sent '#553 final at d0ccadf7' to v12-554r + main.
- PUSHED 3d637a04: nested Hop catch(e) test (main's ask). ci 3642/0; conf/smoke/forge at d0ccadf7 (same code).
- PUSHED 44c42d89: hand-written byte check for one Hop catch(e). Targeted tests green. Sent final to v12-554r, sdk-class, main.
- NEXT (cascade, #549 merged to main): on v12-552r '#552 final at <sha>': merge into feat/catch-revert-data (merge commit), gates (ci, conf, smoke, forge), push, ONE comment, send '#553 final at <sha>' to v12-554r + main. Report problems immediately.
- 2026-10-07: lead pushed cascade merge 701dccb4 (#552 0264f759); local rewrite/553 fast-forwarded to it; posted one comment. Done.
