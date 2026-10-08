# NOTES — v12-550-2 (rewrite of #550 for the class design)

I am `v12-550-2`. #551 owner is `v12-551-2`. Lead is `main`.
Worktree: /Users/er/Documents/Projects/v12-class/550, branch rewrite/550, base ca0302eb (#549 head).
Old #550: tag backup/feat-compiler-host-declarations-20261005 (do NOT carry host declare/types/records).
Rules: ../RULES.md, ../DESIGN.md. Do not push until main says "push".
NOTE: main's messages did not arrive in my transcript while I worked; read them from main's
transcript (SendMessage to v12-550-2) if a crash happens again.

Build env: export PATH="$HOME/.cargo/bin:$PATH" CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_BUILD_JOBS=2
Heavy gates ONLY via: /Users/er/Documents/Projects/v12-class/gate.sh make <ci|test-conformance|smoke> (shared lock).

## Commits on rewrite/550
da468f6c decided branches; 44c95926 static values core; a46431f4 encode while compiling;
7232bb59 tests on both engines; ff1e24c5 docs + rest param refused at run time.
Gates green at ff1e24c5: make ci, make test-conformance (catch 19, svm 273, token 21, v12 353,
erc20 11, playground 13), make smoke.

## main's decisions (2026-10-06 02:13, 02:22)
- Design approved. ToPrimitive approved ("default" for ==/!=, "number" for scalar positions, else valueOf()).
- Absent names = option B: a missing member on a static object stays the compiler's error
  ("`getPool` is not a member of `X.Factory`"); when the object's class defines toString(), run it
  at compile time and append the result as the explanation.
- `===`/`!==` between a static object and a scalar: compile error "compares an object with a
  number: use `==`/`!=`, which converts it". Test it.
- Equivalence tests: Token-like class (valueOf -> address, transfer(to, amount) calls a library fn):
  `COIN.transfer(to, amount)` byte-identical to `transfer(COIN_ADDRESS, to, amount)`;
  `IERC20.at(COIN)` == `IERC20.at(<address>)`.
- Per-chain names are AMBIENT GLOBALS (no import): `export const USDC = new Token("USDC", 0x…)`,
  `export const UniswapV3 = { Factory: IUniswapV3Factory.at(0x…) }`, `export const Base = { chainId:
  8453, Portal: new Portal(…) }`, absent-name decls — all usable bare. Locals/params win.
  Lazy: unused `new Token(...)` costs nothing beyond parsing. Test with 2,000-item ambient module;
  report compile time.
- Lift nested-member call limit: `this.body.code.concat(...)`, `this.destination.tokens[symbol]`,
  `item.token.transfer(...)`, `this.destination.Portal.send(...)`, value method on a run-time field.
  Test each form.
- Send "#550 usable at <sha>" to v12-551-2 (closure lexical capture; {code,args} with args = bytes
  with holes; reading a static value back as plain data).

## TODO
- [x] message v12-551-2 usable at ff1e24c5 (sent)
- [x] nested member calls: already lifted by 44c95926 (frontend accepted any static-member callee);
      tests added in 7cdc8614 (static_values + both conformance suites)
- [x] option B toString explanation + === refusal: 7cdc8614
- [x] equivalence tests + 2,000-item ambient test: c3463b59 (release: ~4-5 ms for 2,000 items,
      parse ~1 ms, namespace tables ~3 ms; base's 2,000 scalar consts ~2.4 ms; linear ~2 us/item;
      function count does not multiply it). Probes in scratchpad zz_probe.rs/zz_scale.rs.
- [x] docs 1ff57274
- [x] gates green at 1ff57274: make ci (3,521 tests), conformance (catch 19, svm 274, token 21,
      v12 354, erc20 11, playground 13), make smoke
- [x] "#550 ready for review at 1ff57274" sent to main; "usable at 1ff57274" sent to v12-551-2
- [x] review nit (SDK words in doc comments) fixed at 74ef63f2; told main
- [x] 19fb80e6: lays_out no longer true for every frame (551-2 found 156 vs 66 bytes); gates green
- [x] review findings (adversarial review of 1ff57274) fixed at c3efe434 (code+tests) + fc289592 (docs):
      dispose once (frame/unconditional return mark; closures capture Scopes::captured()); ownership by
      creation serial (Object::serial, made_since); loop tests under condition; compile-time layout
      REMOVED (encode.rs deleted); plain-data const literal = base run-time tuple; decided branches only
      when Lowerer::decides (frame or names static); module const plain/dynamic -> base errors.
      Guard: sauce-core/tests/base_bytecode.rs + base_bytecode/recorded.txt (from ca0302eb; base worktree
      /Users/er/Documents/Projects/v12-class/550-base; RECORD_BASE_BYTECODE=1 there to re-record).
      Gates green: ci 3,525; conformance catch 19, svm 274, token 21, v12 357, erc20 11, playground 13; smoke.
      Reviewer probes (zz_review.rs/zz_probes.rs) copied to scratchpad; converted into committed tests.
- [x] main 2026-10-06: rule is "no program GROWS" (not byte-identical). 50a7ea03 + 4c6cfedc: uniform decided
      branches restored (decides/names_static removed), const plain-data literal view+mirror restored,
      guard asserts len(new) <= len(base) and prints movers (8/380 moved: objlit-fields -10, nested-const -32;
      none grew). Goldens back to 19fb80e6's (smaller than base). Gates green (ci 3,525; conformance as before).
- [x] re-review CLEAN; 3 gaps + guard pin fixed at c4bf908f + 6ff5502e (static arms in decided ?:/||/&&,
      truth_value for static conditions incl. if; const owns literal-held instances (made_disposables);
      in-place array literal for-of unrolls + disposes; guard SMALLER list, others exact). Gates green:
      ci 3,527; conformance catch 19, svm 274, token 21, v12 358, erc20 11, playground 13; smoke.
- [x] PR body draft: scratchpad/pr-550-body.md (also copy below if scratch lost). Title: "feat(compiler):
      classes and static values the compiler runs". Comment text in message to main.
- [x] PUSHED 2026-10-06: feat/compiler-host-declarations = 6ff5502e (forced over 2ab97044); title + body
      (PR-BODY-DRAFT.md) updated; comment posted (#issuecomment-6021761119). PR https://github.com/eco-incorp/v12/pull/550
- [x] PR CI 14/14 green (main, 2026-10-06).
- [x] 2026-10-06: PR body got an ## Interface section (options/result unchanged, removed host API, language-form table, 23 codes, TS example verified); body only edited.
- [x] 8a5c74f1 PUSHED (fast-forward, 2026-10-06); body Interface updated (.catch row, CatchHandler); 551-2 told.
      Was: .catch on a static receiver is its method (catch_receiver; frontend defers;
      builtin_catch_handler refuses for external receivers; concise builtin body). Gates green (ci 3,528). Awaiting go
      for a normal (fast-forward) push: git push origin rewrite/550:feat/compiler-host-declarations
- [x] f3e54781 (local, NOT pushed): dotted path to nothing compares as 0 (compare_absent/absent_path; module-rooted only;
      not vs undefined; ===/!== only vs number literal) + Artifact::absent_paths / npm absentPaths. Gates green (ci 3,529).
      PR-BODY-DRAFT.md updated (apply with gh pr edit after push). Awaiting main's review/go.
- [x] f3e54781 PUSHED (ff) + body applied; 551-2 told.
- [x] 4ec8ce00 (local, NOT pushed): G1 nested-literal/strings module statics, G2 string consts, G4 empty static arrays (encode len 0),
      G6 const alias of statics, G7 locate_at_call, G8 toString failure note, G9 self-naming const arrows. Gates green (ci 3,534).
      PR-BODY-DRAFT.md updated; apply after push. Awaiting main's go.
- [x] b1175679 (local, NOT pushed): G10 contract imports as Static::Abi (.at binds/rebinds), G11 argument substitution
      (Frame::substitutable + walk::first_read/reads), G12 Error::Unset (FunctionState::unset). Gates green (ci 3,537).
      + 6fbb5dc7 (bound_and_called: static ABI .at(addr).method reads address in place; 551-2's 1-byte finding).
      HOLD: main runs one combined review (f3e54781..6fbb5dc7 + #551 rebased). If clean: push
      4ec8ce00+b1175679 as one ff, apply PR-BODY-DRAFT.md, tell 551-2. Standing by for findings.
- [x] b67d8080 (local, NOT pushed) G11 soundness commit on 6fbb5dc7 (main's 4 regressions): substitutable only `invariant` args (local/const/fixed ctx);
      walk: return -> Unclean, Binary/Unary opaque; nested empty array placeholder (members.rs) so const == inline refusal;
      tests: v12_conformance calls_the_compiler_runs_match_javascripts_order_on_v12 (zz_final probes, LOGGER stub 0x..c5),
      static_values forwarding (a*2 = same length), refused_alike, unset b.n; docs ref + CLAUDE.md + PR-BODY-DRAFT.md.
      Gates green: ci 3,538; conformance catch 19, svm 274, token 21, v12 361, erc20 11, playground 13; smoke. HOLD push until reviewer re-checks G11 + #551; then ff 4ec8ce00..new, gh pr edit body, tell 551-2.
      Note: `const o = { y: [[], [a]] }; o.y[1][0]` refuses while the inline `{...}.y[1][0]` folds (pre-existing, unasked).
- [x] be24a885 on b67d8080 (local, NOT pushed; af387693 withdrawn): G11b + G13 + G15 + G17 (MODULE_SCOPE=0 closures run anywhere) + G11 escape (literal reads unclean). Gates green: ci 3,542; conformance 19/274/21/361/11/13; smoke. HOLD push until reviewer checks be24a885; then ff 4ec8ce00..be24a885:
      G11b (TOP): function call runs in place only for has_no_run_time_form args (members.rs helper; contract.rs call site);
        converting instance -> materialized hint "number", function called. Test converted_for_a_function_compiled_for_run_time.
      G13: names_static (assembly.rs) -> module const naming a static const/class (or member path) is that value;
        make_module_static lets names through plain-data refusal + takes a constant word. Test a_module_constant_naming...
      G15: instanceof decided (instance_of in members.rs; frontend allows it; Error::InstanceofNotClass). Tests + engine case.
      Docs ref + CLAUDE.md + PR-BODY-DRAFT.md updated.
- [x] 137f2ec8 on be24a885 (local, NOT pushed): G11b only for ANNOTATED params (unannotated keeps the instance -> compile-time);
      constant args bound as constants (settle_value from_constants) so fact(n-1) decides. Gates green: ci 3,543; conformance
      19/274/21/361/11/13; smoke. HOLD push until reviewer re-checks; then ff 4ec8ce00..137f2ec8, gh pr edit body, tell 551-2.
- [x] PUSHED 2026-10-06: feat/compiler-host-declarations f3e54781..137f2ec8 (ff); body applied (PR-BODY-DRAFT.md); no comment; 551-2 told "#550 final at 137f2ec8".
- [x] 2026-10-06: PR CI on 137f2ec8 15/15 green. Body rewritten to the SDK's `Optimism.hop({ reward, receive, refundee })` syntax (await / .then forms), applied; no comment.
- [x] 6bed847f PUSHED (ff from 137f2ec8): docs(compiler) reference classes opener -> Optimism.hop({...}).then(...). 551-2 + main told.
- [x] 2026-10-06: CI 15/15 green on 6bed847f. Lead merged v12 main up the stack: feat/compiler-host-declarations = 07828837
      (merge of #549 w/ main: #520 #523 #559 #558 #561). Local rewrite/550 reset --hard to it. Watching CI on 07828837.
- [x] 2026-10-07 PUSHED b73446ab (ff), comment posted, 551-2 + main told. Gates green: ci 3,544; conformance 19/274/21/362/11/13; smoke. #549 MERGED to main (squash 6df02215) + #560/#563/#564. Merged origin/main into rewrite/550 = b73446ab
      (all 7 conflicts -> ours; verified merged-vs-07828837 patch == diff 21029c6c..6df02215 exactly). Gates running; then ff push,
      one comment "merged main after #549 landed", tell 551-2 + main "#550 final at b73446ab".
- [ ] Stay available: watch PR CI (gh pr checks 550 -R eco-incorp/v12) and review threads; fix on rewrite/550,
      push only fixes main asks for / CI needs (force-with-lease not needed for fast-forward). Push only on "push": git push --force-with-lease origin
      rewrite/550:feat/compiler-host-declarations, rewrite PR body, one short comment.
