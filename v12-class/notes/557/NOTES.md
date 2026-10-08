# #557 port (v12-557r) — notes for crash recovery

Old #557: backup/feat-compiler-host-api-followups-20261005 = 8ba99834, old base backup/feat-compiler-args-20261005
(3b9a0d14). Own commits: f1edc68f (remaining accounts anywhere), 9cf7be20 (entrySignature), 120738bf/7644a4fc/7688fee7
(site spans: DROP), 29dc966b/c8b82828/a10958d0 (record: "calls": DROP, replaced by callOf), 43ca3076 + e297d530
(remaining-accounts tests: KEEP). NEVER port from local rewrite/557 at 3d44424c (junk file).

Worktree is DETACHED at 68ddccf5 (#555) for study only. Phase 2: after "#556 final at <sha>", create a fresh branch
from that pushed head here. Don't push until main says "push".

## Plan sent to main (2026-10-07, phase 1)
- (D) entrySignature: port 9cf7be20 (entry_params.rs `entry_signature`/`entry_param`/`written`, LoweredProgram gets a
  field, lib.rs Artifact::entry_signature, wasm marshal + d.ts + README, smoke). Computed even with #556 `args`.
- remaining accounts anywhere: port f1edc68f (entry_account_count, ModuleTables::entry_accounts, Lowerer::tail_start,
  fn_cache::CAT_ACCOUNTS + lookup arg, manifest::reads_remaining_accounts(reachable)); child Lowerers in
  statics/frame.rs and module statics (members.rs make_module_static) and specialization copies must carry the count.
  Tests: old tests/remaining_accounts.rs + contract.rs unit tests + svm_conformance cases.
- (F) Object.keys(o) static array of static strings (object fields in order, array indices, run-time tuple fields);
  error ObjectKeysNotObject. `+` of two compile-time strings -> string (known_bytes).
- (G) already works on #555 binary (probe in scratchpad p557/g*.ts): tests only.
- (E) Static::Name via a "naming" flag armed in `arguments()`/call_function/new args, propagated only into
  object/array literal children; misuse -> original UnknownIdentifier rendered in its module. nameOf(x). scopeGlobal
  via Programs::global (empty entry, scope options, describe with capture_of_value, rebuild frozen).
- callOf via program_call's capture path + Programs::call_of: lower closure program with external-call logging
  (contract_call/evm_raw_call), body one call, parts portable (Const/Bytes/Concat/AbiEncode/Tuple/Array/Binary +
  capture Globals), substitute outer reads with ir::map_leaves.
- Proposed split: #557 = D+F+G+remaining; new PR = E+callOf. Waiting for main's decision.

## Prototype (2026-10-07, branch proto/557 on #555 68ddccf5, NOT #556)
Commits (oldest first): 634e2565 remaining accounts feat (incl. tests — split at port), b3da89f2 entrySignature
feat (tests incl.), 7b59260e+e156362f Object.keys/+strings feat+test (G tests in static_values.rs), d7eaf90d+08ab958f
names/nameOf, a9af2c20+f6967355 scopeGlobal, d9f2c006+03b2233d callOf, 357d91fc style fmt (SQUASH into owners at
port), f506201b docs (contains smoke.mjs checks — move to a test commit at port).
- sauce-core all suites green (30), base_bytecode green, clippy clean.
- args (#556) test for entrySignature saved at ARGS-TEST-PENDING.rs (worktree root, untracked); re-add after merging #556 (also
  entry_params.rs filter `.filter(|_| place.args.is_none())` from #556 must stay; entry_signature computed always).
- Plan/progress sent to main; awaiting: split decision + names (nameOf/scopeGlobal/callOf).
## Port plan (phase 2)
- fetch; `git checkout -b rewrite/557 <#556 final>`; cherry-pick proto commits in order, resolving; squash style.
- re-run (A)/(B)? no — run all sauce-core, then gates via gate.sh: make ci, make test-conformance, make smoke.

## Lead decisions (2026-10-07): ONE PR; commit per feature in order D, remaining, F, G-tests, E(nameOf+names+globalIn), callOf.
Names: nameOf, globalIn (errors GlobalIn*), callOf. Site spans + record:"calls" dropped.
## Restructured branch proto2/557 on 68ddccf5 (6 commits, == proto/557 tree except builtins-reference order):
516fef63 D, 54638432 remaining, 40f0763b F, 065c18d7 G tests, 0044f3a0 E, 6ced7742 callOf. All core suites green (30),
fmt/clippy clean. make smoke passed on proto/557 (89 ok incl. 3 new) before rename.
Phase 2: on "#556 final at <sha>": `git checkout -b rewrite/557 <sha>`; `git cherry-pick 516fef63..6ced7742`
(expect conflicts in assembly.rs entry_params filter, LoweredProgram tuple, lib.rs emit); re-add
ARGS-TEST-PENDING.rs test into entry_params.rs (commit 1) + brief (D) repro "same with args [5, true]".

## review-550 fixes applied (2026-10-07) -> branch proto4/557 (6 commits on 68ddccf5):
a86b7dd6 D, daaffd07 remaining, 3ef3ec9c F, 4315f911 G, 31f5d478 E, 97b30bbb callOf. proto3-final = reference tree
(differs only in nested.rs doc placement). Each commit clippy-clean; full core tests green at F, E, callOf.
Fixes: callOf straight-line residual walk (describe_call: flatten Seq, substitute set-aside locals, the_call strips
decode/Field/Shr-const, refuse If/Loop/Conditional/arith/other effects/Expr::Call/2 calls), closure_call_main
(concise call body stays expr stmt), CallOfOnSvm{which} incl. SVM program; name uses restricted (only pass/store/
nameOf/globalIn/===undefined), uses_static on name creation (cache test), capture via Shapes.name+finished();
Object.keys run-time tuple; `+` strings only (known_text: not hex, utf8); globalIn class wording; vocab route->tail,
token->item. Port onto #556 final: cherry-pick a86b7dd6..97b30bbb.

## Additions 7+8 (2026-10-07) on proto4/557: bf95e55e getters, 7cea4780 in-place argument fix (twin in base_bytecode).
Head 7cea4780: 31 core suites ok, clippy workspace clean, fmt ok. Port: cherry-pick a86b7dd6..7cea4780 (8 commits).
Base compiler for twins: worktree /Users/er/Documents/Projects/v12-class/557-base at ce49eef5, built target/debug/sauce
(remove with `git -C ../repo worktree remove ../557-base` when done).

## LOWs folded (2026-10-07): proto4/557 head 864fb92a (8 commits): a86b7dd6 D, daaffd07 remaining, bd8007c0 F (+ const
string key, PlusOfBytes), 86473971 G, fb4238d9 E, 23456b76 callOf, e86fec6e getters (+ call_getter/GetterCalled,
compound -> GetterAssigned: frontend no longer refuses compound member stores; assign_field locates its refusal),
864fb92a in-place fix (+ docs). Every commit: clippy 0, core tests 0 failing, fmt ok. proto5-final = reference
(differs only in mod.rs ordering + CLAUDE.md getter paragraph). Port: cherry-pick a86b7dd6..864fb92a.

## proto7/557 (2026-10-07): proto6 rebuilt on 6b2dff83 WITHOUT the zz_probe/zz_replay files (they had been
committed in dfe277d2/4b7ecc8d during the proto6 rebase; zz_*.rs, ARGS-TEST-PENDING.rs, .probe/ now in
repo/.git/info/exclude). 9 commits: 198e3553 D, 68982183 remaining, 065b7ac4 F, 847445da G, 1e16711b E,
34f49342 callOf, 6b8b1274 getters, a46c7ffd in-place fix (8 widened), 6fc366dc tail_reads (9).
- 9: new pass src/tail_reads.rs after loop_reads, before inline::emit (EVM+SVM): spilled value assigned
  once, read in top-level loop + after last such loop -> tail reads via held copy / new copy at value /
  new copy at loop end; measure each, keep smallest if smaller. Budget clamp(65536/nodes,1,8).
  inline test duplicated_spilled_arguments_keep_the_call: loop moved under `if` (else split changes SVM).
  goldens entry_decode -O moved (EVM 1540->1513, SVM 2125->2018). base_bytecode tail/{held-copy,new-copy}
  recorded at ce49eef5, listed SMALLER. Conformance tests on both engines (15100/15140).
- Sizes: main-transfer-param 2665 -> 2581 (== main-as-is bytes); rewrite-as-is 2658 -> 2572;
  rewrite-pay-local 2582 -> 2581; SDK 81 bytecodes vs 6dd0e358: 36 same, 45 smaller, 0 larger.
- Rejected experiment: Spill::FewestReads alt in scope::decide_placement (saved patch in scratchpad
  fewest-reads.patch) - only -6 bytes.
- Port: cherry-pick 198e3553..6fc366dc onto #556 final.

## 2026-10-08 tail_reads bounded (lead: bound before timing; bytes frozen)
- proto7/557 commit 9 amended -> 96f8170b. codegen::measure_function (FunctionEmission{len,spills}) emits one function
  at TARGET_WIDTHS[0] w/ program.global_count; tail_reads compares copies by it; full measure once after a kept split;
  first value whose first copy is not smaller ENDS THE PASS. (c) predictor rejected (read counts / placement don't separate).
- Bytes identical to 6fc366dc (SDK 81 same; tail/ corpus; goldens 1513/2018; replays). ZZSUM check: predicted==actual 9/9.
- Timing (wasm, r5, scratch times57/r5-*.json, bar2.py): main set ok; rewrite61 over-bar = #555's own 8; distributed-swap
  rewrite61 #555 20.5 / base 21.6 / pre 22.7 / 557d 24.9. Synthetic (review probes) tr2 1.7->3.4, held 2.0->4.7, helpers 2.9->3.5.
- Pkgs: v12-class/sauce-compiler-{557pre,557a,557b,557c,557d}; tools: scratch times557/{run3.sh,synth.mjs,bar2.py},
  555r/bake/replay-all-n.mjs (REPEATS env). Local probes zz_logs.rs (ZZ_LOGS=<555r/bake>), zz_t4.rs.
- Offered lead: exact Emission lengths+rung hints (~-0.9ms), lossy one-position copy, profile D-8 +2.6% on rewrite61.
- Port: cherry-pick 198e3553..96f8170b onto #556 final.

## 2026-10-08 PORT onto #556 c0309041 -> branch rewrite/557 (old local rewrite/557 renamed stale/557-3d44424c)
- Commits: f3f36f7b D (+ARGS test in entry_params.rs, smoke args check; conflict: entry_params filter args), 9f3c646e rem,
  09e1d2d6 F, b3bd81fa G, ad9117a8 E (+args: None globalIn Place), db163350 callOf (+args: None), fad16ca7 getters,
  0a153288 8 (+lazy contract predicate: was building a BTreeSet of ALL module contracts + declared_names per call = +5%
  on rewrite61), e26364b2 9 (+option 1: Emission.fits / codegen::Fit / measure_known; cse/loop_reads/inline keep fits).
- Bytes: SDK 557e vs #556: 36 same 45 smaller 0 larger; == proto7 557a byte for byte; 130 logged compiles identical
  before/after option1 and fix8.
- Native release (min of 11) vs #556: rewrite61 sum +0.0%, main +0.4%, worst distributed-swap +7.8%.
- Gates running via scratch gates-557.sh (status file gates-557.status; zz probes parked in scratch/zzhold during gates).
- Pkgs: sauce-compiler-557e (port head), sauce-compiler-c030 (#556).

## 2026-10-08 commit 10 (module cache + shared ambient) -> rewrite/557 head 03086a6a
- Stack: da941310 D, a40a623e rem, 0cd628dd F (+throw "not deployed on '"+slug+"'" test), 66290874 G, 73171289 E,
  4c5e39d9 callOf, 0b52d54f getters, fa235002 8, 1ba24592 9, 03086a6a 10.
- 10: lower/module_cache.rs (leaked arenas, (path,text) keyed, bounded 64 mods/64MiB/4096 ABIs; not cleared by
  clear_function_cache), parse_abi cache, fingerprint_contract via Hash (derive Hash on ABI types), ScopeTable
  (lower/scope_table.rs) shared ambient exports + Taken; ScriptBindings::names (declares removed); ir contracts Rc.
- Bytes: all 130 logged compiles identical cache on/off; SDK 81 == 557e.
- Native release logs10 (fn cache cold, module cache warm): trivial@eth 8.9->2.2ms, cross-chain@eth 23.6->9.1.
- Dev worktree 557-dev on dev/557-10 (same commit). Pkg sauce-compiler-557f. Timing scripts scratch times557/{first.sh, run4.sh}.
- Gates on 03086a6a running (gates-557.sh). Timing waits for load < 20 (lead).

## 2026-10-08 commit 10 v2 (lead: clearFunctionCache clears modules) -> rewrite/557 head 975b70df
- module_cache: self_cell Module {owner Allocator, dependent Parsed{source, program}}; ParseCache holds Option<&Arena<Rc<Module>>>
  (typed_arena declared before the compile's Allocator in compile_program); hold() gives 'a refs. Bounds: empty-when-full.
  clear_function_cache -> fn_cache::clear + module_cache::clear. New deps self_cell 1.3.0, typed-arena 2.0.2 (cargo sort ok).
- Tests: module_cache.rs (on/off/again/cleared; changed text; resolver clearing mid-compile).
- Bytes identical (130 logs, recordings-d176a385: 16/16/9/1215/1215/2600/2572 on/off).
- Pkg sauce-compiler-557g (= 975b70df). Native measuring binary bins/final with test-only ZZ_KEEP_MODULES (local patch, reverted).
- Gates on 975b70df running. Lead: if load > 20 for ~1h after gates pass, report ready with native table, wasm later.

## 2026-10-08 READY at 975b70df: gates ci 3794/0, conf 749/0, smoke 91 ok. Wasm table in scratch times557/f-*.json
(final.sh), native table times557/native.txt (bins/final4 with ZZ_KEEP_MODULES local patch; zsh does not split $E!).

## 2026-10-08 PUSHED 5d9f38f3 (commit 10 + ABI JSON bound 16 MiB, tests) to feat/compiler-host-api-followups (force-with-lease
from 8ba99834; backup tag backup/feat-compiler-host-api-followups-20261008 pushed). PR retitled, body from PR-BODY-DRAFT.md,
comment issuecomment-6060474968. Draft until CI green (watcher bk58aa63o scratch ci557.sh), then gh pr ready 557, then
"#557 final at 5d9f38f3" to sdk-class + team-lead.
