# v12-552r notes (crash recovery)

PR #552 `feat/compiler-try-catch`, local `rewrite/552`, worktree here. Base: rewrite/551 (owner
v12-551-2). Above: #553 `v12-553r`. Lead: `main`. Old head: `backup/feat-compiler-try-catch-20261005`
(diff vs `backup/feat-compiler-program-arguments-20261005` = old net change, saved at scratchpad
old552-src.diff).

## Plan (sent to main)
- Keep: frontend check_try/check_exits/block_main; try_statement; one-call form = exactly the shapes
  `.catch()` treats as external (evm.call/static/delegate, inline contract chain, contract-bound
  local), decided by SHAPE (no lowering twice); block form via #551 core (Body::Block);
  ir::writes_global; TryBlockAssigns(+Through); RUNNING_ENGINE delegate; tests try_catch.rs,
  try_conformance.rs (+pot_code inFlightEngine), Makefile EVM_INTEGRATION_TESTS, docs.
- Drop: Param::Handler, Body::Guarded, Handoff, HostHandler*, program_handlers.rs, wasm handler.
- Block program: enclosing program's OWN options (not programOptions callback), entry contracts when
  written in the entry module, NOT reported in Artifact.programs, no id/path segment.
- Tail rule: a try that is the last statement of a program's `main` may assign module lets (the
  SDK finisher `program(() => { try { body(); } catch { handler(); } }, scope)`).
- New refusals: `this` in a block, recursion through the block (own words).
- New test: class stores two arrows, finisher compiles the library arrow with program(); equal to
  the written-out closure; runs on v12 both paths.

## Status
- 2026-10-06: plan sent to main. Implemented on base 3d44424c (old rewrite/551; new 61fb568c is
  content-identical but for a stray empty file). Commits: 865ce48a feat, 83966fee test try_catch.rs,
  cd2f7ba0 try_conformance (+pot_code inFlightEngine, Makefile), 33396e5a docs, fixups 57a8ea55/4f33b8f0
  (tail try inside a guarded block is guarded too), wasm smoke check. Autosquash fixups before push:
  GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>.
- try_catch.rs 14 green, try_conformance 8 green (real engine), sauce-core all green.
- Gate env: PATH=$HOME/.foundry/bin:$HOME/.huff-neo/bin:$HOME/.cargo/bin:solana active_release/bin
- 2026-10-06 later: main approved plan. Sequential porting: I'm the only porter; "#552 final" goes to main.
  #551 final 0e59032e (on #550 137f2ec8): rebased (backup-552-oldbase = old head). 551 now: captures by
  identity (Shapes/Shared, same local = one word), `this` captured (THIS) -> dropped TryBlockReadsThis,
  `this` works in blocks; caller contracts reach programs via contracts_at -> OwnOptions = options+root.
  Class test now uses SAME `amount` in both arrows (lead's request) -> one word, byte-equal. Head 6077f4de.
  Old-base gates were green (ci 3596, conf 708, smoke 81 ok). Rebased gates running (ci2/conf2/smoke2 logs).
- #551 issue to report: writing a captured (frozen) object's field in a block/closure program says
  "an instance of `X` belongs to a module constant, so it cannot change" (StaticConstantWritten) —
  misleading; refuse_captured_store comes after require_writable.
- When #550's .catch-method fix lands (via #551), rename class test method `otherwise` -> `catch`.
- PR body: needs "## Interface" section (done in draft), modeled on #549.
- 2026-10-06 16:30: rebased onto #551 5e84bc82 (captured writes -> CapturedAssignment; Compilation.captured).
  Added Compilation.block so require_writable words a captured write in a block as TryBlockAssigns.
  Head 4f072515. Gates GREEN: ci 3624/0, conformance 711/0, smoke 84 ok. Reported ready to main.
- 16:45: renamed class test method otherwise -> catch (550's .catch-method fix already in base). Head
  5b0a6c68 (tests-only change vs 4f072515; affected tests green). Reviewer review-550 on 4f072515.
  Waiting for main's "push". Then: git push --force-with-lease origin rewrite/552:feat/compiler-try-catch,
  retitle/rebody from PR-BODY-DRAFT.md, one comment "rewritten for the class design", leave DRAFT.
- 17:xx: review fixes. msgData refusal was ADDED then DROPPED per user (block's msgData = block program's
  payload is correct): now documented + tested (try_catch payload-shape test; conformance: length =
  closure twin + 32, last word = capture, outer = own). Kept msgValue/msgSender/self conformance test,
  eval doc (block-form try under eval always reverts before CATCH; use one-call form). src == 5b0a6c68.
  Head be2b68d6; gates running (v552-ci5/conf5/smoke5 logs; scratchpad is shared, use v552- prefix).
- msgValue guarantee+test dropped per user (block is its own program); kept msgSender/self test+doc.
  Head b406bdad: gates GREEN ci 3625/0, conf 713/0, smoke 84 ok. PR draft in hop syntax
  (Ethereum.hop({ reward, receive, refundee }).then().catch()). Reference try section still Portal.send.
- msgSender promise+assertion dropped (only ctx.self() kept: a_block_runs_as_the_programs_account).
  Try section opening example switched to Ethereum.hop({...}). Head b8c27559 (tests/docs only vs
  b406bdad; try_conformance 10/10). WAITING: v12-551-2's new #551 head (merge commit on 5e84bc82) ->
  rebase, run make ci + make smoke (no conformance needed if src unchanged), send sha to main.
- Rebased onto #551 head 2e9a25af (ff on 5e84bc82: #550 docs merge + hop docs). Head 435c0f62.
  make ci + make smoke running (v552-ci7/smoke7). Conformance last full run green on b406bdad (src same).
- 18:15 GREEN on 435c0f62: ci 3625/0, smoke 84 ok. Reported "#552 ready at 435c0f62" to main. Await "push".
- PUSHED 435c0f62 -> feat/compiler-try-catch (lease vs 6ffd8271). PR retitled, body replaced, one
  comment posted, still DRAFT. https://github.com/eco-incorp/v12/pull/552. Now: watch CI + threads;
  main marks ready. #553 will build on me (told later).
- Stack absorbed v12 main (#558 Pot.eval relay). Merged origin/feat/compiler-program-arguments 9933577a
  into rewrite/552 (merge 77f814dd): ONE stub Pot answering gateSalt, inFlightEngine (armed in
  transient keccak("V12Pot.engine") while a program runs, restoring previous), eval(bytes) from the
  armed engine (static path, unarmed). PUSH2 jumps; JUMPDEST asserts at f4/fc/100/128/151; len 0x17d.
  Measured: block-form try under eval RUNS (static): read->1, revert->caught, write->caught.
  Commit 61723da6 docs+test. Gates running (v552-ci8/conf8/smoke8). Then push FF to
  feat/compiler-try-catch, update PR body, tell main + v12-553r.
- 2026-10-07: gates GREEN on 61723da6 (ci 3626/0, conf 715/0, smoke 84). Pushed FF 435c0f62..61723da6.
  PR body updated. Told main + v12-553r. PR is marked ready (by main). Watching CI.
- 11dba3b4 docs: eval write burns the block frame's gas (63/64; ~930k of 1M). Pushed FF, body updated,
  told main + v12-553r. CI on 61723da6 was 15/15 green.
- 2026-10-07: merged #551 final 10fbe7cb (ProgramKey keying) -> merge baad2def (adapted BlockRequest
  key/enclosing). 2e514e71 fix: TryBlockContainsItself keyed by arrows_among(shapes); 60d4dca5 test
  (Hop nested 2/3 deep, catch without param since catch(e) is #553); 6511ee7f docs. base_bytecode: 8
  listed shrinks (#550's nested-const/objlit-fields), none mine. WAITING: one more #551 commit
  (captured-let message) -> merge, gate once, push, "#552 final" to main + v12-553r.
- Merged #551 final d9de0a90 (ProgramKey::new, captured_cells, captured-let CapturedAssignment) ->
  merge 405aad25: block key via ProgramKey::new (dropped my arrows_among), unified wording helper
  Lowerer::captured_assignment (Compilation::block) — fixes a would-be panic (self.captures None in a
  rebuilt arrow's frame). 68e4ed75 test: a try block cannot assign through an arrow it runs.
  Gating (v552-ci9/conf9/smoke9). Then push FF, one PR comment, "#552 final" to main + v12-553r.
- FINAL: merged #551 d7dce3b4 -> 8600a4c3; targeted tests green; pushed FF 11dba3b4..8600a4c3; body
  updated; comment posted; "#552 final at 8600a4c3" sent to main + v12-553r. Watch CI.
- Cascade: merged #551 750a2bdb (main w/ #549 squashed, #560/#563/#564 via #550 b73446ab) cleanly ->
  0264f759. Gating (v552-ci10/conf10/smoke10). Then push FF, one comment, "#552 final" to main+553r.
- 0264f759 pushed by main (cascade); local == remote; my gates green (ci 3631, conf 715, smoke 84);
  cascade comment posted. Idle; available for CI/review threads.
