# sdk-class NOTES (crash recovery) — owner of SDK #61 rewrite

- Worktree: /Users/er/Documents/Projects/v12-class/sdk, branch rewrite/61 (start 9d81c86b = #61 head;
  old head tagged backup/proof-compiler-host-api-20261006). DO NOT PUSH until `main` says so.
- Compiler: worktree /Users/er/Documents/Projects/v12-class/compiler-for-sdk (detached rewrite/551,
  built at 61fb568c). `make pkg` via gate.sh -> crates/sauce-wasm/pkg copied to
  /Users/er/Documents/Projects/v12-class/sauce-compiler-local, version stamped 2.4.0.
- Read: /Users/er/Documents/Projects/v12-class/DESIGN.md, RULES.md; SDK CLAUDE.md.

## Task
1. @sauce/intents SauceScript class lib (sdk/src/std/intents/)
2. per-chain ambient modules generated from registry
3. wire compile path (ambient + programOptions); delete host.ts declare + intent-host.ts bind/splice
4. wallet publish bytes: PROPOSE to main first, keep #61 path meanwhile

## Status log
- 2026-10-06: started; compiler pkg build kicked off.
- Compiler built at 61fb568c, copied to sauce-compiler-local (2.4.0), linked in 4 package.json (pnpm install done).
- Plan sent to main (Q1: #552-#557 features absent in 551; Q2: wallet publish via eth_simulateV1 + IntentPublished).
- Probes in .probe/ (probe.mjs + mods/). Measured: 400KB ambient +13ms; 300 ABI imports +27ms.
## Gaps (for main)
- G1: module const object literal with nested plain-data literal refused as lookup table even if unread (workaround: class instance).
- engine env: source /Users/er/Documents/Projects/v12-class/sdk/.env.engines
- 2026-10-06: MILESTONE 1 reached: test/.probe/milestone.ts (untracked) — class intent hash == TS route builder's on Base anvil. Reported to main with gaps G1-G8.
- Files so far (uncommitted): src/std/names/*, src/std/intents/{intents.evm.js,portal.abi.json}, src/routes/chain-module.ts, sauce-route.ts rewrite, rs-compile.ts (modules + programOptions), entry.ts EntrySignature local, unknown-global.ts (fast distance), intent-defaults.ts (IntentDefaults type), embedded/resolve.ts (@sauce/names), deleted std/context.
- Gaps G1-G8 listed in message to main (see below).
  G1 nested plain-data module const refused; G2 module string const refused; G3 no static string concat; G4 empty array encode/bind; G5 const array push; G6 const alias of static plain object -> runtime tuple; G7 no location; G8 toString failure dropped.
- Decisions taken: token-only bodies are NOT recorded any more (every body cooks); salt default = one per compile; const-bound intent publishes at block end.
- G9 undefined member read -> no toString; G10 contract import not a value / .at on binding; G11 compile-time method copies called args (byte diff vs direct call); G11b instance passed to run-time fn makes compiler inline fn (and `==` inside uses hint default -> Absent silently 0); G12 `undefined != 0` true instead of refused; G13 `export const X = A_n` (bare name of a static module const) refused.
- Tests marked it.failing pending compiler: routes-protocol-names (G10 x3, G11 x2), routes-absent-names (G12), routes-token-names (G11b x2), routes-stock-tokens (G11/G11b x2).
- 2026-10-06 commits: 8da915d3 (class + modules), 7750797b (intent suites on anvil). MILESTONE 2 reported (portal 49/49, chains e2e 19/19, nest-dynamic e2e 41/41).
- Gaps G12 (undefined != 0 true), G13 (export const B = A refused), G15 (scalar.member === undefined), G11b reported.
- Remaining red (pre-commit run): cli-*.e2e, cli.test, cli-support, cli-inputs, cli-create, docs-intent-sugar-drift, routes-program, routes-typed-source, routes-intent-contracts, routes-intent-defaults, routes-portal-funding, swap-on-base.e2e, distributed-swap.e2e, cli-examples.e2e, try-catch.e2e(pending #552), verify.compile(expected pin), deleted-module suites: routes-intent-body, routes-chain-defines, routes-intent-sugar, routes-intent-reward-chain, routes-token-registry(TOKEN_METHODS), cli-inspect(chainHost).
- G16 program() closure doesn't see entry inlineContracts; G17 module-scope arrow (Token) not callable from helper fns. Reported.
- swap-on-base.e2e blocked on args (#556) + wallet intents (Q2); distributed-swap.e2e blocked on G17.
- 2026-10-06 ~17:00: rewrite/551 MOVED to b2208857 (rebased on new #550 b67d8080: G9/G10/G11 fixes, absentPaths). Rebuilt + relinked (sauce-compiler-local 2.4.0).
- DESIGN.md updated by USER: (1) names a chain lacks = compiler folds unknown dotted paths, reports absentPaths; modules export ONLY what chain has; Absent class gone. (2) wallet publish = cook on wallet's own Pot with --fund; refundee REQUIRED always (no publisher default); hash/record from IntentPublished (rehearsal then receipt); TS host builder returns the cook. (3) bodies always cook (done). (4) hooks: callOf in #557 later.
- In progress: generator rewritten to export only what chain has (Absent removed from generator; names lib still has Absent/Refused -> remove).
- Commit 293e4630: modules export only what chain has; absentPaths checked (unknown-global.ts absentNameError/absentPathError; intent-parts.ts chainAt). Routes suites all green (852).
- Next: wallet publish = cook on wallet Pot + --fund; remove `publisher` (refundee required always); records from IntentPublished (rehearsal then receipt); TS host builder (intent-dsl chainPortal) returns the cook.
- Open Q to main: destination-only delivery tokens (USDT0 from Base) can't be named; Token(0x...) workaround.
- 2026-10-06 wallet-publish rework (UNCOMMITTED in worktree): publisher removed; refundee required (class throws);
  --intent-refundee/intentRefundee RETIRED; intent publish = run/simulate/tx on signer's Pot + --fund (publish.ts rewritten);
  logged-intents.ts (intents from IntentPublished: {intentHash,destination,record}) reported by simulate+run;
  file-intents.ts = rehearsal (fund:false Level option; nested levels never inherit) for fill <file>/lifecycle file/;
  inspect file offline from bodies; create.ts writes .refundee + --fund reward; MCP publish tool = dryRun simulate | unsigned cook;
  bindMainArguments + ProgramInput.bound deleted; Intent class fields _-prefixed. routes-intent-portal 54/54.
  Asked main: TS host builder shape (return cook). Next: CLI/MCP tests, docs/skills.
  Helper: .probe/add-refundee.py <file> <expr> inserts .refundee after Portal.send chains lacking it.
- COMMITTED 05fdba40 (intents: refundee required, fund:false, _fields, cycle fix), 16bca886 (cli publish-by-cook),
  f3edb246 (mcp). Green: routes-*, cli unit suites, cli-lifecycle.e2e 17/17, mcp all but 2 todo (return type).
  Remaining red: cli.e2e (publish section), cli-fill.e2e, docs-intent-sugar-drift, swap-on-base.e2e,
  cli-examples/distributed-swap/cli-simulate/cli-solana (return type #556 / G17), try-catch (#552), verify.compile (pin).
  Run single jest suite in band: NODE_OPTIONS=--experimental-vm-modules npx jest --config ../.probe/jest.inband.cjs --rootDir . <file> -i
  Stale anvils on 94xx ports from killed runs poison lifecycle e2e: pkill -f "anvil --port 94".
- COMMITTED b7b44913 (fill --rpc-url beside --config), 9ace7c2c (cli.e2e + cli-fill.e2e), 9b0aadf4 (skills), 32617113 (docs).
  skills:check remaining = compiler gaps only (G11b swap-on-base/actions/swap-and-supply/uniswap-v4; G17 distributed-swap/eth-prices;
  #552 try/catch/.catch; #554 await; builtins.md vs #550 classes/undefined/arrow/throw). docs:check: only router-swap (G11b).
  Still to do: CLAUDE.md update; swap-on-base.e2e; remaining full-suite red; TS host builder (awaiting main).
- 2026-10-06 later: compiler rebuilt at 5e84bc82 (G10/G11b/G16/G17 cleared); docs:check green; flipped it.failing markers.
  COMMITTED fix(actions) wordArg chain key; 08252bec (bare token a chain lacks is refused: venue-where-deployed + guide + sauce-globals);
  4d3c43f1 CLAUDE.md rewritten for chain modules/@sauce/intents/publish-by-cook.
  actions test:mainnet: remaining 14 red = main's return type (entrySignature.returns, compiler #557 port) — cookbook x12, holdings x2.
  rewrite/552 (try/catch) exists locally at b406bdad on top of 551; instructions say build from 551 only.
  Next: run full gates, report status to main; TS host builder still awaiting main.
- 2026-10-06 evening: commits 08252bec, 4d3c43f1, test(routes) cascade cook, 84450239 (skills refusal + bound Token baseline), f788d79a (builtins.md #550 language).
  Gates: build/typecheck/lint(tracked)/format(tracked)/docs:check green; mcp+dev-tools green.
  Reds = compiler only: return type (#557 port) sdk 13 + actions 14; try/catch #552 (4 + skills); .catch(e)/await (skills); verify.compile pin; G11 forwarding (globals.mts).
  G11 root cause reported to main: decided `=== undefined` guard in a method blocks single-read forwarding of ctx.self() (+1/+4 bytes). Repro in scratchpad g11/probe3.mjs.
  Asked main: build from rewrite/552? TS host builder shape still open.
- 2026-10-06: SDK #97 MERGED into main (compiler 2.5.0, engine/Kitchen 1.2.0, Router gen 4, quote router; releases.json 2.5.0 row).
  DO NOT merge main into rewrite/61 until the v12 class stack is rebased onto current v12 main; then merge SDK main + restamp.
- Lead answers (2026-10-06): TS builder shape APPROVED ({source, program, cook(target,value), intents(logs)}, drop .nest()/BuiltIntent Portal helpers);
  lifecycle steps take the PUBLISHED intent (store, --tx <hash>, imported record), never a rehearsal; rehearsal only for --dry-run (hash illustrative);
  fill <file> = publish-then-fill if kept; REMOVE old Base(...).reward(...) syntax + openRoute old paths (report remaining internal use);
  hooks later: Intent route assembly must take raw calls before/after the cook; bare destination symbol -> it.failing test;
  builtins.md full #550 language; pending #552-#557 items marked in the CHECKER, not skill text; Token balanceOf gap -> #555 (keep it.failing).
- COMMITTED e1730f9d (instanceof delivery + before/after raw call lists + it.failing bare USDT0), 4d325427 (lifecycle = published intents; --tx; file = preview only).
  Asked main about duplicate intents (Portal accepts both; proposed run-time nonce salt) — awaiting.
- IN PROGRESS: TS builder rewrite + old-syntax removal. Plan:
  A core: routes/published.ts loggedIntents (moved from cli); chainPortal -> HostIntent {source, program, cook(target,value), intents(logs)};
    .source(chain, options?) carries compile options; no .nest; chain exports plain objects {chain, Portal, contracts, tokens} (no call, no .route);
    openRoute not exported from routes index (internal: cctp recipe builders only); actions programIntent DELETED.
  B tests migration (~50 files; nest-* tests import internal openRoute or get deleted w/ report); C docs/examples/skills.
- 2026-10-06 night: COMMITTED 6cbb4199 (TS builder = HostIntent {source, program, cook, intents}; old syntax removed; actions programIntent deleted),
  e59be6a0 (docs/examples/skills for it; first-intent from Base, executed on Base state in actions docs-examples),
  ba50621d (pending markers: jest it.failing return-type x13 + try/catch x4 + compiler pin x1; actions todo x14; skills:check PENDING list x12),
  237c5df2 (builtins.md classes), + receive-rule docs.
  ALL GATES GREEN locally (build, typecheck, lint/format tracked, test incl. pending markers, docs:check, skills:check);
  check:browser fails only on the local compiler link (glue path regex).
  Remaining internal openRoute users: recipes/cctp-transfer.ts (buildCctpSplitTransfer/buildPlainTransfer, public via ./recipes, return BuiltIntent);
  nest.ts/nest-dynamic.ts reachable only via openRoute .nest() (no shipped path) + their suites (routes-nest-*).
  Awaiting main: duplicate-intent nonce salt (a/b/c).
- 2026-10-06 late: COMMITTED 9819f167 (delete openRoute/nest/CCTP), 89fb5596 (nonce salt, transient slot).
  IN PROGRESS (uncommitted): HOP SYNTAX (user decision): `await X.hop({ reward, receive?, refundee, deadline?, rewardDeadline?, prover?, salt?, fee? })`,
  `.then(body)`, `.catch(e)`; chained Portal.send form REMOVED; `X.Portal` = eco-routes Portal contract binding (program and host).
  Done: intents.evm.js (Intent(config)), chain-module hop(config), intent-syntax HOP_FIELDS/HOP_STAGES, gen-source-globals renderHop,
  host-intent.ts chainHop (HopConfig incl. source + compile; unknown keys refused), builder/composed (hop, Portal getter),
  intent-parts (await/then/receive), CLI/MCP texts, create.ts (writes .then form), checker OPENS_INTENT=/X.hop(/ and Portal rule (no exemption),
  gen-skills-references defaults table (fields). Tests converted w/ scratchpad/hop/convert.py; portal + types suites green.
  Sent main: status, CCTP deleted, unknown-field gap (no Object.keys/for-in), question (a)/(b) on await in executed files (going (b)).
  NEXT: full jest results; docs/skills/examples to hop; CLAUDE.md; commit.
- 2026-10-06 later: hop rewrite through docs/skills/CLAUDE.md done (uncommitted at time of writing). Decision (b) pending main's answer:
  EXECUTED example files (docs/examples/*.sauce.ts, skills examples, create.ts output) use `.then(...)`; prose + skill ```sauce blocks lead with `await`
  (checker PENDING "skills/" + await message, #554). intents.mts compiles the skill's one-pool block (await) -> runner pending until #554 (fields check after it).
  After #554: switch executed files to await, drop PENDING entries, cli.test await test already passes (intent-parts reads await textually).
  Gates so far: build, typecheck, lint, format(tracked), docs:check, skills:check(17 pending) green; mcp 165+2todo, actions unit 370 green. Full jest + actions mainnet running.
- COMMITTED hop: 4114a542 (core), 0a3c6822 (docs), eeeb1d24 (skills), b9ce53da (tests), 09539235 (CLAUDE.md). All gates green
  (jest 9244/0, mcp 165+2todo, actions unit 370 + mainnet 141+14todo, dev-tools 30, docs:check, skills:check 17 pending).
  Reported to main. Waiting: (a)/(b) answer on await in executed files; #552 sha; unknown-field compiler gap acknowledged?
- Lead approved (b) + `compile` field. COMMITTED 61c17db9: check-skills THEN_UNTIL_AWAIT (list of .then files until #554; probe fails when await compiles),
  it.failing unknown hop field (#557 Object.keys), it.failing Unset wording (#555). Reported "everything committed". Waiting on #552 sha.
- 2026-10-06 ~20:30: compiler rebuilt from #552 435c0f62 (compiler-for-sdk detached at 435c0f62), restamped 2.4.0.
  COMMITTED ac6a7740 (.catch -> try in Intent._run; intent-parts handler parts + alsoHere paths; report multi-path),
  81e45e65 (try-catch e2e x4 flipped, handler e2e flipped except e-reading case, cli handler report flipped, PENDING -> catch(e) #553).
  Gates green: jest 9248/0, mcp 165+2, actions unit 370, docs:check, skills:check 15 pending (7 #553, 8 #554). Reported to main.
- LEAD (2026-10-06): after building from #553 (catch (e); an arrow called in place drops extra args JS-style), switch
  intents.evm.js Intent._run to ALWAYS `() => { try { body(); } catch (e) { handler(e); } }` -> flips the e-reading it.failing tests
  (routes-intent-portal "a handler reads what the body reverted with", routes-intent-bodies e2e "(e)" case) + PENDING #553 entries.
- 2026-10-07: compiler rebuilt from #553 59feffbb (includes v12 main #558/#559/#561), restamped 2.4.0. Engine built from the branch:
  /Users/er/Documents/Projects/v12-class/engines/v12-evm-553-59feffbb.creation.hex (KITCHEN 0x1984…506b, POT_INITCODEHASH 0xbca0…7585;
  v12-evm submodules inited in compiler-for-sdk). COMMITTED 05fd8dcc (_run catch (e) { handler(e) }), f7eca1fc (flips; e2e e-reading
  it.failing until CATCH_READS engine release; interface extra args dropped; throw new Error ok; .catch limit 254).
  Gates green; skills:check 8 pending (await #554). Reported to main.
- 2026-10-07: MERGED origin/main 455f2a70 into rewrite/61 at 19c82928 (+ 9b99dedf follow-up). Local compiler restamped 2.5.0 (still 59feffbb build).
  sync-engine-artifacts -> 2.5.0 row: v12-evm 1.2.0, kitchen-evm 1.2.0; .env.engines uses v12-evm-v1.2.0 runtime.
  Gate anchors 1.2.0: kitchen 0x1984…506b, potInitCodeHash 0xb4f700d3…d520. #553 engine rebuilt: engines/v12-evm-553-59feffbb-kitchen120.creation.hex.
  check-skills: item 15 = main's release-address rule, 16 = THEN_UNTIL_AWAIT. Gates all green (jest 9314/0). Reported. Not pushed. Next: #554.
- LEAD: when #554 lands, add an SDK test with 2 and 3 nested hops inside ONE try/catch (`try { await A.hop; ..; await B.hop } catch (e)`)
  EXECUTED on the locally built engine (routes-intent-bodies e2e style), and flip it.failing "a handled hop opens another handled hop"
  (committed 2026-10-07; reproduces ProgramContainsItself today with .then/.catch nesting).
- LEAD 2026-10-07: the nested-handled-hops fix moves into #551/#552, cascades through #553; on the NEW #553 sha: rebuild compiler (restamp 2.5.0),
  flip "a handled hop opens another handled hop" it.failing, rebuild engine if needed (anchors: kitchen 0x1984…506b, pot 0xb4f7…d520), rerun gates.
- 2026-10-07: #553 FINAL 3d637a04 (on #552 final 8600a4c3): compiler rebuilt, restamped 2.5.0; engine rebuilt ->
  engines/v12-evm-553-3d637a04-kitchen120.creation.hex. COMMITTED a0f2e2a3 (nested handled hops flipped; e-reading pending v12-evm 2.0.0).
  Gates green (jest 9315/0). Release note: compiler w/ #553 must pair with v12-evm 2.0.0 in releases.json. Waiting: #554.
- #553 final moved to 44c42d89: test-only fast-forward of 3d637a04 (one test in try_catch.rs). No rebuild needed; local compiler/engine stay at 3d637a04.
- 2026-10-07: #554 FINAL daed46d1 built (restamped 2.5.0; engine unchanged, local engine stays 3d637a04).
  COMMITTED 3b00ab42 (funding.ts#thenForm: --fund wraps awaiting programs in .then form, byte-identical; create.ts writes await),
  b2d11d6f (executed examples await; repay-on-base inner hop stays .then inside if), 1edf1e4c (await tests flipped; try-around-awaits
  byte identity 2/3 deep; e2e 2/3 hops in try on Portal; THEN_UNTIL_AWAIT + PENDING removed). Gates green (jest 9323/0, skills 0 pending).
  Reported. Remaining it.failing: #555 Unset, #557 (Object.keys, return type, bare USDT0, bound args), compiler pin, e-reading on 1.2.0.
- 2026-10-07: rewrite/61 on #554 at 316da6bc (diagnostics spanPad fix: multi-line span pads quoted lines; value-return-after-await
  refusal now located at file line; cli.test pins it). Reported "rewrite/61 on #554 at 316da6bc". Not pushed.
- 2026-10-07: lead's --fund conditions done: COMMITTED 842bfacd (thenForm AST-only, blanks await in place, no regex, refused awaits
  untouched; original compiles first via cookOf; tests for 8 untouched shapes + 5 --fund refusals at file line). Reported. HOLD for #555 (v12-555r porting).
- 2026-10-07: pushed backup/rewrite-61-20261007 at 842bfacd (lead asked; NOT #61's branch). PR-BODY-DRAFT.md written (untracked).
  Full suite on local #553 engine: only the 3 expected e-reading "failing test passed". Reported. HOLD for #555.
- 2026-10-07: sent main the compiler-needs list with generic repros: #556 (A args, B folding bound args into closure captures),
  #555 (C Unset), #557 (D entrySignature {params[{name,type,abi}], returns}, E bare name in object literal -> static name + scopeGlobal,
  F Object.keys, G contract import as static field with .at). Not compiler: verify pin (release), e-reading (v12-evm 2.0.0). HOLD for #555.
- LEAD: A–G are acceptance tests in REBASE-BRIEF.md. On "#555 final <sha>": rebuild compiler (restamp 2.5.0), confirm (C) flips
  (routes-token-names "a missing argument is refused at the argument, as unset"), gate, report. Otherwise HOLD.
- 2026-10-07: #555 2155102e built (restamped 2.5.0). (C) flipped: diagnostics[0].code "Unset" at user's call. COMMITTED be06c874
  (+ args doc: indexed by entryParams, SVM Account params stay manifest slots). Gates green (jest 9331/0). HOLD for #556/#557.
  #556 TODO when it lands: compileSauceProgram passes `args` to the compiler (remove RangeError), flip routes-intent-portal "folds arithmetic…".
- 2026-10-07: #555 final 68ddccf5 built (restamped 2.5.0), gates green, no pin failed. BUT size compare vs 2155102e (scratchpad/hop/sizes.mjs):
  8 of 83 bytecodes GREW (router-route +5, router-swap +41, distributed-swap +28, swap-on-base +24/+24); repros sent to main
  (f(1,2,x) abi.encode 41->44; sorted-record 66->92; uniswapV4 const 215->286). Side builds: v12-class/sauce-compiler-2155, -68dd. HOLD for #556.
- 2026-10-07: size tool at v12-class/tools/sizes (sizes.mjs via SAUCE_COMPILER_PKG + register.mjs hook, diff.mjs, three.mjs, one.mjs);
  baselines rewrite61-2155102e.json / -68ddccf5.json / main-2.5.0.json (sdk-main worktree at origin/main 9a1dac3f, released 2.5.0).
  Sent to v12-555r. vs 2.5.0: distributed-swap +343 (specialization copies of `trade`, repro 189->236); payout/globals/buy-stock/fund
  small (+1..+12, token READ via @sauce/token balanceOf frame 65 vs main inline 54; inline experiment reverted).
  SDK main moved to 9a1dac3f (#102) — not merged; wait for main's word. On next "#555 final": rerun vs 2155102e AND main-2.5.0.
- 2026-10-07 lead: merge SDK origin/main 9a1dac3f (#100 #101 #102) into rewrite/61 (merge commit), regate, push backup branch again.
  Merge in progress (uncommitted): conflicts resolved (package.json link kept + litesvm; CLAUDE.md router para; mcp tools imports
  (drop bindMainArguments/fillTargets/intentRecord); chain.e2e scenario test todo + main's erred(); run.ts imports; sauce-examples
  tables row-merged; sauce-script: dropped main's "method on a literal" row+sentence — class compiler COMPILES hex`..`.concat(d)).
  solana.ts:1733 (main's new LiteSVM rehearsal) mainReturnType -> entryReturnType(prepared.program.entrySignature).
  Probes moved to v12-class/probes-sdk/. build/typecheck/lint/format/docs:check/skills:check green; jest+mcp+actions+devtools running.
- 2026-10-07 MERGED: 7e3e8c93 "Merge SDK main (#100, #101, #102) into rewrite/61" (parents be06c874, 9a1dac3f); pushed to
  backup/rewrite-61-20261007. +3 jest it.failing (cli-solana-distributed-swap: returned, #557) -> 17 return-type it.failing total.
  Gates green on 68ddccf5 (jest 9528/0, mcp 169+2todo, actions 370 + mainnet 176+14todo, devtools 15+30, docs, skills 0 pending).
  Size baselines re-measured on 7e3e8c93 (tools/sizes/rewrite61-{2155102e,68ddccf5}.json; old in pre-merge/). v12-555r + main told.
  HOLD: "#555 final" -> rebuild, stamp 2.5.0, sizes vs rewrite61-2155102e.json AND main-2.5.0.json, regate, revisit Token read spelling.
  Use unique log names in the scratchpad (shared with other agents: 554-*.log there).
- 2026-10-07 lead: after "#555 final", fix Token read spelling so rewrite/61 <= main-2.5.0 for EVERY program in tools/sizes; report table.
  WIP (uncommitted, gates running): names.evm.js Token.balanceOf/Holding.valueOf -> ERC20.at(addr).balanceOf(holder) inline,
  names/erc20.abi.json copy (pinned = token's in routes-token-names.test.ts), tests -> typed IERC20 by hand, globals.mts/SKILL
  (IERC20 own-name import no longer collides), CLAUDE.md. On 68dd vs 2.5.0: payout +2, buy-stock +2, stop-loss +2, fund +1, dswap +418.
  Sent main: (a) compiler repro: inlined method's run-time arg before body constant -> SWAP (+1/read w/ ctx.self()), c.json repro 37 vs 36;
  (b) BUG: `const b = self.USDC` stores Holding object -> re-reads per use (post-transfer value); getters unsupported -> ask getters or drop self.USDC.
  Generic repro dirs: scratchpad/sdkclass-read/{call-m,call-i,getter2}; tools/sizes/files.mjs (dir of files on 3 builds + $SAUCE_COMPILER_PKG), hex.mjs.
- 2026-10-07 #555 FINAL 6dd0e358: compiler-for-sdk detached there, built, sauce-compiler-local + sauce-compiler-6dd0 (stamped 2.5.0;
  sizes identical to v12-555r's pkg). Size baseline tools/sizes/rewrite61-cdc63a81-6dd0e358.json.
  Commits: cdc63a81 inline Token reads (lead OK: <= 2.5.0 is the bar even if > rewrite/61); f6cd8cfd self.USDC it.failing x3.
  BUG (rewrite/61): `self.USDC` is a Holding object (valueOf = read) -> `const b = self.USDC` re-reads per use (returns 0 after
  transfer; e2e shows 0 vs 23054), `let left = self.USDC; left -= x` refused. FIX = class GETTERS (#557, v12-557r):
  pending-patches/self-getters.patch (chain-module Self getters `get USDC() { return USDC.balanceOf(this); }`, drop Holding,
  flip 3 markers). Getter in module now = EVERY EVM compile fails, so not committed. Apply when #557 lands (+CLAUDE.md line).
  vs 2.5.0 still larger: payout+2, stop-loss+2, buy-stock+2, fund+1 (all #557 arg-order SWAP; repros w-m/w-i 91v89, w-rt 146v145,
  call 37v36 in scratchpad/sdkclass-read), distributed-swap +77 (= +1 #557, +76 compiler sensitivity param-vs-local copy, also in
  2.5.0; `const pay = payToken` variant 2582; factory local-copy workaround costs supply-idle/swap-leg +3 -> reverted). Reported.
- 2026-10-07: backup pushed to f6cd8cfd (lead: ALWAYS push backup after a green regate, no asking). Lead: #557 item 8 (constant
  field/arg reads clean) + item 9 (cache repeatedly-read param in a local when smaller = distributed-swap +76) both v12-557r.
  Sent v12-557r: repro-557-param-cache/ (recordings replayable w/o SDK: tools/sizes/replay.mjs; recorder pkg tools/sizes/recorder,
  record.mjs) + item-8 repros (durable copy: v12-class/repro-557-arg-order/). self-getters patch stays pending. HOLD #556/#557.
- 2026-10-07: #555 final now 6b2dff83 (ff of 6dd0e358, compile-time only). compiler-for-sdk detached there; sauce-compiler-local
  + sauce-compiler-6b2d (2.5.0 stamp); sizes byte-identical to 6dd0e358. Bar re-measured on f6cd8cfd (tools/sizes/
  rewrite61-2155102e.json; old in pre-cdc63a81/). Regate on 6b2dff83 green (jest 9535, mcp 169+2, actions 370 + 176+14, dev 15+30).
- 2026-10-07: #555 final now 9f0cd9c5 (ff of 6b2dff83; merges v12 main incl #549/#560). compiler-for-sdk detached there;
  sauce-compiler-local + sauce-compiler-9f0c (2.5.0); sizes identical to 6dd0e358 (81 bytecodes). Regate green (same counts).
- 2026-10-08: #555 final now c553e59c (ff of 9f0cd9c5). compiler-for-sdk detached there; sauce-compiler-local + sauce-compiler-c553
  (2.5.0); sizes identical to 6dd0e358. Regate green (same counts). tools/sizes gained v12-555r's logger/, log-all.mjs,
  replay-all.mjs (use log-all for programs that open intents).
- 2026-10-08 lead: profile rewrite61 compile time (findings only). Done + reported. Fixed cost per chain module dominates:
  base module 701K (41 On<Chain> classes = 575K incl 230K refusal strings, OnEthereum 122K w/ 88K dest token table), ethereum 925K
  (+1735 tokens 152K, Self holdings 55K); chainModuleSource 5.8ms JS uncached (chainsPart); compiler ~10-20ms parse per module;
  hop = 2 modules. Proposed: (a) cache On<Chain> texts, (c) dest token table = source symbols only, (d) composed refusal strings
  [SDK-only, no output change]; (b) On<Chain> only for named chains (needs scan) / (e) stocks lazy -> compiler ask (lazy decls,
  module-parse cache). Tools: tools/sizes/profiler + profile.mjs; probes-sdk/prof/variant*.mjs. Awaiting decision.
- 2026-10-08 lead: do (a)(c)(d) only (NOT b/e). Commits: 5c93cb4a (d) namespace sentences in class; 6ca67951 (a)+(c) per-part
  caches (contractsOf, destinations; fee fn re-read) + dest token table = source symbols. New test routes-chain-module.test.ts.
  Proof: tools/sizes/bytes.mjs (88 hashes + 45 refusal texts) identical; probes-sdk/refusals/capture.mjs identical modulo
  "(bytes N..M)" offsets into generated module. sdk-before worktree (f6cd8cfd, built) for A/B: tools/sizes/ab.mjs.
  Killed orphan anvil :8601 (descriptors-viem leftover from Oct 7) that broke cli.e2e worker-1 port. Load avg ~98 -> re-time later.
- 2026-10-08: (a)(c)(d) regate GREEN (jest 9541/0); backup pushed 6ca67951. Reported with interleaved A/B (pre-load) table.
  Pending: re-time with times.mjs when load drops (bugcaaw5o waits for load < 25, then ab.mjs x15). sdk-before worktree kept for A/B.
- 2026-10-08 #556 FINAL c0309041 (contains #555 c553e59c). compiler-for-sdk detached there; sauce-compiler-local + sauce-compiler-c030.
  Every compile/refusal identical to c553e59c (bytes.mjs). SDK: compileSauceProgram passes args (entry.ts#entryWords strict
  words; removed dead entryArguments/checkEntryArguments/entryConstant), rs-compile args, docs (compiler.md row, routes.md para,
  CLAUDE.md), flipped routes-intent-portal folding test, new routes-program-args.test.ts (A byte-exact, folding into bodies,
  Solana Account, refusals, ArgsCount/ArgOutOfRange). Regate running (gate-556). Uncommitted until green.
- 2026-10-08: #556 committed 03637578 (feat) + d176a385 (docs); regate green (jest 9547); backup pushed d176a385. Reported.
  Still pending: low-load re-time (ab.mjs, SAUCE_COMPILER_PKG=sauce-compiler-c553 for comparability) + times.mjs; then #557.
- 2026-10-08: recordings for v12-557r at v12-class/recordings-d176a385/ (recordings-6ca67951 symlinks to it) (7 programs, logger w/ programOptions; README; made by
  tools/sizes/record-targets.mjs; replay-all.mjs patched to skip non-dirs). Lead: after #557 compose "not deployed on '<slug>'"
  sentences once static string + renders in a compile-time throw. Timing queued (brdg4kfwj, waits load<20, c553 pkg).
- v12-557r: compose with static string `+` (literal / static arg or field / const / const-table read); NOT .concat (run-time),
  NOT let-reassign loops, NOT == "" (needs scalar), strings only. Plan on #557: Ns class with main ->
  constructor(c, address, missingOn) { this.reason = address !== undefined ? "<is p.C>" : missingOn === undefined ? "<widened>"
  : "Contract 'C' (p) is not deployed on '" + missingOn + "' (available: <joined list>)"; } instances pass slug string only.
  Verify render (refusal capture identical modulo offsets) before committing.
- 2026-10-08 #557 FINAL 5d9f38f3. compiler-for-sdk detached; sauce-compiler-local + sauce-compiler-5d9f. Uncommitted (regate gate-557
  running): entrySignature from compiler (params w/ abi, returns), 17 jest + 14 actions + 2 mcp return-type flips; getter patch
  applied (self.USDC getters; Holding gone); intents class: Object.keys field refusal + bare destination token via nameOf/globalIn;
  unknown-global GlobalInMissing rewording (nameAt); composed not-deployed sentence (notDeployedAround + missingOn); docs/skill/CLAUDE.
  Sizes (tools/sizes/rewrite61-5d9f38f3.json): vs 2.5.0 only fund-by-transfer +1 (w-rt-m 146 vs 145: run-time field arg order,
  NOT fixed by #557); vs 2155102e 0 larger, 46 smaller. Interface G (call + .at) still pending: compiler calls no contract import.
  Timing (load ~14): ab-5d9f.txt; trivial@base cold 8.2 warm 2.2; cross-chain@base 25.2/8.7.
- 2026-10-08 #557 COMMITTED: 5f58afd7 signature/return type (+flips), 80b164ad self.USDC getter (patch applied; file renamed
  .applied), 98d775ca intents Object.keys + bare destination token (+GlobalInMissing rewording), 9462de91 composed not-deployed,
  492c9faf interface comment. Regate green (jest 9547 after skills return-spelling fix; mcp 171/0 todo; actions 370 + 190/0 todo).
  Backup pushed. Remaining: fund-by-transfer +1 (w-rt), interface call+.at (compiler calls no contract import).
- 2026-10-08 lead: HOLD. Two compiler asks held pending the user's decision on splitting #557:
  (1) +1 byte: run-time-field argument read in place when the arguments between are effect-free (Token(t.token).transfer(vault, t.amount);
      repro repro-557-arg-order/w-rt-m vs w-rt-i 146 vs 145);
  (2) a contract binding held as a value, called with one address, is its .at(address) (UniswapV3.Pool(pool) == UniswapV3.Pool.at(pool);
      repro probes-sdk/iface/run.mjs). KEEP the 2 it.failing in routes-protocol-names for (2).
  State: rewrite/61 at 492c9faf (= backup), compiler 5d9f38f3 linked (stamped 2.5.0), regate green. Nothing uncommitted but untracked notes.
  When either lands: rebuild, flip/size (fund-by-transfer must reach 798), regate, push backup, report.
