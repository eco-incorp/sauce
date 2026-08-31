# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Developer-facing tooling for the **Sauce protocol** — an on-chain bytecode runtime that executes
Turing-complete, atomic scripts in a single EVM transaction. The runtime engine itself lives in the
separate private `eco-incorp/sauce` repo (often checked out at `../sauce`); this repo only *targets*
it.

A **pnpm monorepo** of four workspace packages, all `private: true`, bundled and published as a
**single npm package `@eco-incorp/sauce-sdk`** via subpath exports — only the root `package.json`
publishes. This bundling is the key mental model: code lives in four packages for development,
consumers import everything from one name.

| Workspace | Internal name | Published as | Role |
| --- | --- | --- | --- |
| `compiler/` | `@eco-incorp/sauce-compiler` | `/compiler` | SauceScript (JS subset) → Sauce bytecode |
| `sdk/` | `@eco-incorp/sauce-sdk-source` | `.`, `/protocols/*`, `/chains`, `/skills`, `/recipes` | 127+ protocol registry, chains, recipes, AI skill files |
| `dev-tools/` | `@eco-incorp/sauce-dev-tools` | bin `sauce-dev-tools` | Local/forked hardhat env + recipe runner |

This repo was **extracted from `../sauce`** (the source of truth, which still has its own copies of
these four packages, generally more built-out). The packages here are **siblings, not generations**:
`dev-tools` is a dev harness, not a legacy `sdk`. The genuinely deprecated compiler is
`../sauce/compiler-poc/`, nothing here.

## Build, test, lint

Run from the repo root. **Build order matters** — sdk and actions consume the compiler's `dist/`, so
the compiler builds first (the `build` script enforces this).

```sh
pnpm install
pnpm build          # compiler, THEN sdk + actions
pnpm typecheck      # all workspaces
pnpm test           # all workspaces
```

Per-workspace (`--filter`):

```sh
pnpm --filter './compiler' test          # jest: unit test/ + integration-test/ (needs Foundry)
pnpm --filter './compiler' lint          # eslint; also: format:check (CI enforces)
pnpm --filter './sdk' test               # compiles every protocol's SauceScript fn (1400+ tests)
pnpm --filter './actions' test:unit      # fork-free subset CI runs
```

Single test file: jest (compiler/sdk) → `pnpm --filter './compiler' test -- arithmetic.test.ts`.
Actions and dev-tools use the **node test runner**, not jest → `pnpm --filter './actions' exec tsx
--test tests/megas-swap.unit.test.ts`.

## Toolchain gotchas (why a fresh clone may fail)

- **Private `sauce` git dep.** The compiler depends on `sauce` from `git+https://…/eco-incorp/sauce`
  (private). Cloning needs GitHub auth — locally `gh auth setup-git` or an `~/.npmrc` token; CI uses
  the `ECO_INCORP_TOKEN` secret via a `git config insteadOf` rewrite.
- **Foundry** (`anvil`/`forge`/`cast`) is required for the compiler's integration tests (jest
  `globalSetup` spawns anvil, `forge create`s the engine, runs compiled bytecode) and to build the
  engine artifacts. The compiler `postinstall` (`integration-test/fetch-engine-libs.js`) clones the
  OpenZeppelin submodule into the `sauce` dep and `forge build`s it (pnpm doesn't recurse submodules).
- **`FORK_URL`** — actions `test`/`test:megas-swap` and dev-tools fork flows hit a hardhat mainnet
  fork (loaded from `.env`). `test:unit` is the fork-free subset.
- **`SAUCE_ENGINE_SO`** — path to the Solana engine binary (`engine.so`, built with
  `cargo build-sbf` in the sauce repo's `svm/`). The SVM integration suites
  (`compiler/integration-test/svm-*.test.ts`, `sdk/test/svm/*.test.ts`) run compiled
  `target: 'svm'` bytecode on it via LiteSVM. The binary is **vendored** at
  `artifacts/svm/engine.so` (committed, force-added — `.so` is gitignored — same
  convention as the committed `compiler/dist`/`sdk/dist`) and that's the default both
  locally and in CI, so these suites run **offline by default**, same as the EVM ones; the
  suites **skip cleanly** only if that binary is somehow missing. Set `SAUCE_ENGINE_SO` to
  override — e.g. to test a freshly built engine before repinning the `sauce` dep. **Refresh
  the vendored binary whenever the `sauce` dep is repinned**: `cargo build-sbf` in the pinned
  commit's `svm/` checkout, copy `target/deploy/engine.so` over `artifacts/svm/engine.so`,
  force-commit — nothing re-derives this automatically, so a repin without a refresh silently
  tests against a stale engine again. The `'svm'` compile target, its account-plan output,
  and the `/svm` SDK subpath are documented in `docs/plans/2026-07-03-solana-svm-support.md`.
- **`SAUCE_RUST_ENGINE_SO` / `SAUCE_RUST_V12_RUNTIME`** — the two engines every suite that EXECUTES
  compiled bytecode needs, and **deliberately separate variables** from `SAUCE_ENGINE_SO` above.
  The SDK compiles through the published compiler (`@eco-incorp/sauce-compiler` from the public npm
  registry, an `sdk/` dependency aliased `sauce-next` because a workspace package shadowed the real
  name; nothing is built locally and no Rust toolchain is needed), which emits for the sauce `main`
  engine lineage. `SAUCE_ENGINE_SO`'s vendored `artifacts/svm/engine.so` is built from the pinned
  `release/beta` lineage, so it can only serve suites that do NOT run freshly compiled bytecode
  (instruction builders, PDA derivation, decoders). Anything that does run it gates on
  `describeRustSvm`/`SAUCE_RUST_ENGINE_SO` instead, which hard-fails in CI rather than skipping.
  **The two wire formats have diverged, measured in both directions**: on the SVM, `JUMP`/`JUMP_I`
  (0xB0/0xB1) exist only on `main` and `NEW_ARRAY` (0x92) encodes its scalar elements differently, so
  Rust-compiled bytecode carrying any `require`/`if` is rejected by the vendored `engine.so` with
  `InvalidInstructionData`; on the EVM, `0xB0–0xB5` are `IF/IF_2/JUMP/JUMP_2/JUMP_BACK/JUMP_BACK_2`
  on the pin but `JUMP/JUMP_I` on `main`, and `0x88–0x8A` (`MLOAD`/`MSTORE`/`MALLOC` — every
  value-returning program's epilogue) are `do_unknown` on the pin, so a Rust-compiled `balanceOf`
  either returns empty or dies with `MemoryOOG` on the `V12RuntimeBytecode` this repo generates.
  Pointing `SAUCE_ENGINE_SO` itself at a `main` engine is therefore **not** a workaround — it breaks
  the suites that exercise the SDK's staged-execution instruction builders, which encode the pinned
  engine's layout. **Staged execution is a known gap**: those builders and `main`-lineage bytecode
  cannot both be satisfied today, so `svm-settle.e2e` runs its programs INLINE and the staged-path
  e2e is gone. Restoring it needs the v12-svm v0.4.0 instruction layout; it is unrelated to which
  compiler the SDK uses. Engine-gated suites skip when their variable is unset LOCALLY, so the
  default `pnpm test` is green and engine-free — but in CI
  an unset variable is a hard failure, and CI supplies both from the `v12-svm-v0.4.0` and
  `v12-evm-v0.3.0` release artifacts, which are built from the same sauce commit the published
  compiler's `compiler-v0.5.0` tag is cut from. (They cannot come from the `sauce` git dep:
  `release/beta` is the wrong lineage, and sauce `main` deleted the `engine/` tree
  `sync-engine-artifacts.mjs` reads.)
  `pnpm --filter './sdk' sync-engine-artifacts --fetch-v12-engines` fetches both from those releases,
  digest-verified against values pinned in the script, so no Huff toolchain and no local sauce
  checkout is needed. Building by hand is only for an **unreleased** engine: the `.so` is
  `cd <sauce>/v12-svm && make build`, and the EVM runtime cannot come from `hnc -r` at all —
  `Runtime.huff`'s CONSTRUCTOR returns its own bytecode, so the deployed code is only known once
  deployed; deploy the creation code to an anvil and read it back with `cast code`. (The EVM suite
  needs `anvil` on `PATH` either way.)
- **Committed EVM engine artifacts** (`sdk/dist/artifacts/` — `Router`, `SauceRouter`,
  `ISauceRouter`, `V12Pot`, `V12Kitchen`, `V12RuntimeBytecode`, `IERC20`, `IUniswapV3Pool`,
  `IStateView`) ship to downstream SDK consumers, which read them for local tests/deploys, so
  they must track the pinned `sauce` engine. Unlike `compiler/dist`, they are **not** build
  output — `tsc` never emits them — so a `sauce` repin would silently leave them stale. **After
  any repin run `pnpm --filter './sdk' sync-engine-artifacts`** (copies the 8 forge artifacts
  from the pinned dep's `engine/out/`) **and commit the result**. CI enforces this: it re-syncs
  from the freshly-installed engine (foundry v1.5.1 + solc 0.8.27 → byte-reproducible) and fails
  on any drift, so a forgotten re-sync can't merge.
- **`V12RuntimeBytecode.json` is the one artifact the sync script does NOT re-derive** (it is
  listed in `OPTIONAL_SOURCES`, not `SOURCES`). It used to be a snapshot committed inside the
  dep at `engine-v12/snapshots/`, so syncing was a plain copy. The engine **deleted that
  committed copy** (`chore(v12): compile the runtime at deploy time`) because it was a second
  source of truth that rotted — a change to six `.huff` handlers shipped with a snapshot built
  from the pre-change source, through green CI, and the deploy script would have pushed those
  stale bytes to eleven live chains. The engine now compiles `v12/Runtime.huff` with `hnc` at
  deploy time, where `hnc` is a first-class dep. **It is not one here** — this repo's CI installs
  Foundry only, and that same CI re-runs the sync and fails on drift, so requiring the snapshot
  would make the drift check unsatisfiable. The engine keeps its generator
  (`engine-v12/script/V12RuntimeBytecode.s.sol`) precisely for this consumer; its doc comment
  names "the sauce-sdk viem test harness" as the reason. **When the v12 runtime changes, refresh
  it by hand** from a checkout of the pinned commit, with `hnc` on `PATH`:
  `cd engine-v12 && git submodule update --init --recursive --depth 1 && forge script
  script/V12RuntimeBytecode.s.sol --sig "run()" --ffi`, then copy
  `snapshots/V12RuntimeBytecode.json` over `sdk/src/artifacts/` + `sdk/dist/artifacts/` and
  commit. The generator sanity-deploys the creation code before writing, so a broken snapshot
  fails there rather than in a downstream consumer. Nothing in this repo re-derives or verifies
  it, so a v12 runtime change without this step silently ships stale creation code to consumers.

## Architecture

**`compiler/`** — parses **SauceScript** (a uint256-only JS subset; no closures/classes/async, strict
equality; full surface in `compiler/README.md`) to bytecode. `src/index.ts` `compile()` parses via
`acorn` and emits `Uint8Array[]`; `src/processor/` walks the AST (expression/statement/collection/
inference); `src/saucer/` emits bytecode (`Saucer` builder, `ops.ts` opcode table, per-type encoders);
`src/context.ts` tracks functions/var kinds/ABIs; `src/contracts.ts` loads contract ABIs from artifact
JSON for `import { X } from "./X.json"` + `.at()/.view()/.lib()` binding.

**TS front-end (`src/ts-frontend.ts`) — `.ts`/`.sauce.ts` sources/imports only.** The core pipeline
is acorn-only; a `.ts`/`.sauce.ts` source opts into a front-end that runs strictly BEFORE acorn: it
parses with the real `typescript` compiler, folds provably-constant `if`/ternary branches, literal
expressions, and countable `for` loops, then strips types via `ts.transpileModule` — handing acorn
plain JS text. Wired at both the import seam (`ctx.transformModule`, default for any resolved
`.ts`-suffixed module — a caller-supplied `transformModule` always overrides it) and the top level
(`CompileOptions.tsSource`).

TWO evaluators, layered: `tsEvalConst` (a hand-rolled bigint evaluator mirroring
`processor/const-eval.ts`, retargeted to `ts.Node`) is the PRIMARY one — because
**`ts-evaluator@2.0.0` cannot reliably evaluate bigint arithmetic at all** (`BigInt(node.text)` on a
bare BigInt literal like `"3n"` throws — the constructor rejects the literal's own `n` suffix — and
bigint binary expressions just fail silently), and SauceScript is bigint-only, so `ts-evaluator`'s
`evaluate()` (`tryEvaluate`) is only a fallback for shapes `tsEvalConst` doesn't cover (bare
boolean/string identifiers, templates — same-file identifiers only, no `ts.Program`/checker is
built, so it can't see into array/object property access or function calls either — that scope
boundary is why loop unrolling can't (yet) fold real array/object DATA processing, only countable
counters). **A ternary's MAINSTREAM path is neither evaluator directly**: `tsEvalConst`/
`tsEvalUnary`/`tsEvalBinary` have NO case for `ts.isConditionalExpression` anywhere — instead,
`foldTransformer` (the module-scope fold pass, described further below) handles a ternary via its
OWN separate, dedicated `ts.isConditionalExpression` visitor branch: it evaluates ONLY `.condition`
(via `foldExpression`, which tries `tsEvalConst` first, `tryEvaluate` only as THAT narrower
fallback) and, if resolved, structurally replaces the WHOLE ternary with whichever branch was
taken, recursing into it (so a nested ternary in the taken branch cascades too). `tryEvaluate` is
only ever asked to resolve a WHOLE ternary node in the narrower case where `foldExpression` is
reached from a calling context that doesn't go through that dedicated branch — e.g. an
if-statement whose own test expression is itself a bare ternary. A failed/unresolvable fold always
leaves the node untouched (fails closed, never throws) — `tryEvaluate` wraps `evaluate()` in
try/catch for whatever still reaches it with a bigint present (e.g. a template literal
substitution).

**Fix (this branch): a suffix-less numeric literal beyond `Number.MAX_SAFE_INTEGER` silently
corrupted to the nearest float64 value.** Both `tsEvalConst`'s `ts.isNumericLiteral` branch and
acorn-side `processor/const-eval.ts`'s `literalToBigint` used to fold a numeric literal by first
parsing it into an ordinary JS `number` (`Number(node.text)` / acorn's own already-parsed
`literal.value`) and only then converting to `BigInt` — silently rounding to the nearest
representable double for any suffix-less literal (hex/decimal/octal/binary) whose true value
exceeds `2^53 - 1`. Confirmed via real EVM execution: the real ecoswap `HIGH` bitmask
(`0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000`, `2^256 - 2^24`, legally
in-range for uint256) rounded UP to exactly `2^256` under this bug, so any `tickArg`-shaped helper
using it threw `value exceeds 32 bytes (uint256 max)` at compile time whenever compiled through the
ts-frontend (`tsSource: true`) — even though the source is valid SauceScript; a smaller value (e.g.
`2^200 + 12345`) instead silently compiled to the WRONG (rounded) constant with no error at all,
reproducing identically on the plain acorn-only path too (`const-eval.ts` is consulted for every
top-level `const` runtime read via `ctx.getConstant`, not just ts-frontend). Both are `.ts`/
`ts-frontend`-independent from `processor/expression.ts`'s `processLiteral`/`literalToInt` (the
RUNTIME-value emission path), which already avoided this exact hazard by parsing the literal's own
raw source text (`literal.raw`) — the two COMPILE-TIME-constant evaluators just never got the same
treatment. Fixed by parsing the literal's own raw source text directly into a `BigInt` in both
places instead: `tsEvalConst` now uses `BigInt(node.getText().replace(/_/g, ''))` (`ts.NumericLiteral.
text` is NOT raw source text — the TS scanner normalizes it through the SAME lossy float round-trip,
so `getText()` — the literal exactly as written — is required, with numeric separators stripped
since `BigInt()` itself rejects them); `const-eval.ts`'s `literalToBigint` now threads the acorn
`Literal` node's own `.raw` through, mirroring `processLiteral`/`literalToInt`'s existing pattern
exactly. A non-integer literal (float, exponential notation) still correctly declines to fold —
`BigInt()` throws for both forms, matching (and generalizing) the previous `Number.isInteger` reject
path, now via an exact parse instead of a lossy intermediate float.

**Loop unrolling**: a `for` loop with a constant start/bound/step (`i++`/`i--`/`i +=
step`/`i -= step`/`i = i +/- step`, compared against a same-file `const` or literal bound) unrolls
into N copies of its body with the counter substituted by its per-iteration literal — capped at
`MAX_UNROLL_ITERATIONS` (256) so it can't blow up bytecode size; over the cap, or a
non-canonical/non-constant shape, or a body containing `break`/`continue`/`return` or shadowing the
counter name, leaves the loop as real runtime code (`JUMP_BACK`) untouched. The SAME counting-loop
core (`unrollCountingLoop`) also recognizes the `while` spelling of the identical idiom — a `while`
has no init/incrementor clauses of its own, so it's the pairing `let i = <const>; while (i <cmp>
bound) { ...; i +/- step; }` (the increment as the body's own last statement) that's matched, at the
statement-LIST level (`foldStatementList`, since eliding the pair replaces two adjacent statements
with N — a single-node visitor can't express that). Unrolling a `while` this way ELIDES the counter
declaration entirely, so it only fires when nothing after the loop still reads the counter (a
"found index" pattern must keep the loop as-is) — checked by scanning the rest of the enclosing
statement list. Each unrolled iteration re-enters the fold pass, so a nested `if`/inner loop keyed
on the counter cascades to a fully-resolved literal per iteration (e.g. a nested `while` inside an
unrolled `for` fully resolves both loops to straight-line arithmetic, no loop opcodes emitted at
all). Plain `.js`/`.sauce` sources never invoke any of this.

**Fix (this branch): unrolling could emit a duplicate declaration.** Both `unrollCountingLoop` (the
`for`/`while` unroller above) and the array-table `for...of` unroller further below splice N copies
of the body's OWN statements directly into the ENCLOSING statement list — no per-iteration `Block`
scope of their own (the base SauceScript compiler's own statement processor doesn't accept a bare
`Block` as a standalone statement, so wrapping each copy in one isn't a valid alternative fix
either). The existing shadowing guard only ever bailed on a body that redeclared the COUNTER's own
name; a body declaring any OTHER local (`let doubled = i * 2n;` — an entirely ordinary shape) would
unroll into N (or, colliding with an outer declaration of the same name, even just 1) adjacent
`let`/`const` declarations of that name in the SAME scope — invalid JS/TS that `ts.transpileModule`
happily prints as text, but that `acorn.parse` (the very next `compile()` stage) then rejected with
`SyntaxError: Identifier 'x' has already been declared`, crashing the whole compile. Confirmed
reachable via all three unroll entry points (numeric `for`, the `while` counting idiom, and the
array-table `for...of` unroller). Fixed by `collidesWithSurroundingDeclarations`: after producing
the (already fully expanded/cascaded) unrolled statement list, it's scanned for a direct `let`/
`const`/nested-`function` name that either repeats within that list or collides with a name already
reserved by an OUTER enclosing scope — either shape bails the WHOLE unroll (falls back to the
well-tested "stays real runtime code" path) rather than handing back output the next stage can't
parse. This inspects the ACTUAL final output, not the per-iteration body in isolation, so an
inner declaration fully CONSUMED/ELIDED by a further nested cascade (e.g. the paired `while`-
counting idiom eliding its own counter) is correctly judged safe — existing unroll-cascade tests
are unaffected; only a body whose local declaration has nothing to consume it now declines instead
of crashing.

**Fix (this branch): the SAME splice-collision crash, in if-branch flattening.** `foldTransformer`'s
if-statement handling replaces a taken `if (true) { ... }` / `if (false) { ... } else { ... }` with
its branch's OWN statements spliced directly into the ENCLOSING statement list (the identical
architecture as the loop unroller above, for the identical reason — the base SauceScript compiler's
statement processor doesn't accept a bare `Block` as a standalone statement) — but had no
`collidesWithSurroundingDeclarations` check of its own. A taken branch's OWN `let`/`const` sharing a
name with something already declared in the enclosing scope (`let x = 1n; if (true) { let x = 2n;
... }` — an entirely ordinary shape, and perfectly legal AS WRITTEN since the branch's own `Block`
gives it a real nested scope) became, once flattened, two adjacent declarations of the same name in
the SAME scope — invalid to emit, crashing with the identical `SyntaxError: Identifier 'x' has
already been declared` at the next `acorn.parse` stage. Fixed by reusing
`collidesWithSurroundingDeclarations` unchanged: the flattened result is checked against the
ORIGINAL outer `shadowed` set before being returned; a collision declines to flatten (falls through
to the generic `ts.visitEachChild` fallback, which visits the branch via the ordinary `ts.isBlock`
case instead — a genuine nested scope, so no collision there) rather than handing back output the
next stage can't parse. A non-`Block` taken branch (e.g. `if (true) return 5;`) can never trigger
this — real JS/TS grammar rejects a lexical (`let`/`const`) declaration as a single-statement `if`
body outright, so that shape can't reach here in the first place.

**Constant propagation to reads + dead-declaration elimination** (`constPropagationTransformer` /
`deadConstEliminationTransformer`, two more `before` transformer stages appended AFTER
`foldTransformer`, running on ITS output): a chain like `const a = 1; const b = a + 3; const c = b
+ 4; console.log(c);` now fully collapses to `console.log(8n);`. The fold pass above already
resolves every top-level `const`'s value into `consts` up front and folds it into a later
FOLDABLE initializer expression (`const b = a + 3` → `const b = 4n`), but never touched a bare
`Identifier` sitting in ordinary READ position — `constPropagationTransformer` closes that gap,
substituting every unshadowed read of a top-level const name with its resolved literal;
`deadConstEliminationTransformer` then deletes any top-level `const` left with ZERO remaining
`Identifier` occurrences of its name anywhere in the file. Running after fold+unroll means a const
used only as a now-fully-unrolled loop bound, or only inside a since-pruned dead `if`-branch, is
correctly eliminated too — its only textual reference already disappeared with the unrolled-away
loop condition or pruned branch, before either of these two passes ever looks for it. Scope-aware:
descending into a function body, block, catch clause, for-loop declaration, or parameter that
redeclares the SAME name shadows it for that whole (inner) scope, computed once up front per scope
rather than incrementally (matching real JS/TS semantics — a block-scoped name is reserved from the
top of its scope regardless of TDZ) — the outer const is correctly left un-substituted inside that
shadowed scope; `var` is additionally hoisted to its enclosing FUNCTION (not block) scope, via a
separate pre-scan that doesn't cross nested function/class boundaries, matching real `var`
semantics. **Fix (this branch):** that shadow set now ALSO includes every name a `let`/`const`
(or nested named `function`) declaration introduces anywhere reachable in the function's body
WITHOUT crossing into a nested function-like scope or class — not just names declared directly
in the function's own top-level statement list — via the same `collectLexicalNamesInScope` the
local (per-function) pass below already needed. This matters because the REAL SauceScript
compiler shares scope across `if`/`while`/bare-block bodies (`processor/statement.ts`'s
`processIfStatement`/`processWhileStatement` never call `ctx.pushScope`; only
`processForStatement` does), so a name FIRST `let`/`const`-declared inside such a branch is NOT
block-scoped away once the branch ends — it is the SAME persisting variable for the rest of the
function. Before this fix, `const FEE = 100n; function f(cond) { if (cond) { let FEE = 5n; }
return FEE; }` wrongly substituted the final `return FEE;` with the OUTER `100n` (confirmed
reachable on this exact shape) — the branch's own `let FEE` correctly shadowed reads INSIDE the
`if`, but the function-level shadow set never saw a name declared only inside a nested branch,
so a read AFTER it fell through to the top-level const instead of staying an (unsubstituted)
real runtime read. Over-including a name this way costs at most a missed optimization (the real
compiler's own `getVar`-then-`getConstant` resolution still handles an unresolved read
correctly), never a wrong substitution. **Follow-up fix (this branch): the SAME gap, in every
OTHER pass that computes its own function-scope shadow set.** The fix above landed only in
`constPropagationTransformer`'s `substituteConstReads` — `foldTransformer` itself (which folds a
`BinaryExpression`/`CallExpression`/`TemplateExpression` DIRECTLY, via `tsEvalConst`/`tsEvalCall`,
strictly BEFORE `substituteConstReads` ever runs), the array/object lookup-table feature's
`checkTableSafety` (the whole-file soundness scan) and `tableFoldTransformer` (the actual table
substitution), and `collectWriteCounts` (the effectively-const `let`/`var` write-count scan) each
had their OWN, separate, still-`collectVarNames`-only shadow computation, unfixed. Reachable and
confirmed (including via real EVM execution — the ts-frontend-compiled bytecode returned the SAME
answer for both branch outcomes of the shadowing condition, while the plain/acorn pipeline
correctly returned two different, condition-dependent answers) on: `const RATE = 5n; function
f(cond) { if (cond) { let RATE = 999n; } return RATE + 1n; }` (foldTransformer folding a
BinaryExpression read after the branch straight to the OUTER `6n`) and the analogous shape with a
top-level array/object table in place of a scalar const (`checkTableSafety`/`tableFoldTransformer`
folding `TABLE[k]`/`OBJ.prop` after the branch against the OUTER table). All four now also call
`collectLexicalNamesInScope` in their `isPlainFunctionScope`/`isMethodLikeScope` handling, exactly
like `substituteConstReads` already did — `collectWriteCounts`'s own gap could only ever have made
its write-count scan OVER-conservative (a shadowed write miscounted as a top-level one can only
inflate a reported count, never deflate one), so it was never an unsound-fold risk the way the
other three were, but is fixed too for consistency (every shadow computation in the file now
agrees on the same rule). Substitution never touches a WRITE position either — an assignment's left-hand side or an
update expression's (`++`/`--`) operand is walked by a dedicated `visitAssignmentTarget` that
recurses into any nested reads (a computed member-access key, a destructuring default's value) but
leaves the bound identifier(s) themselves untouched, mirroring `foldExpression`'s
`ASSIGNMENT_OPERATOR_TOKENS` guard one level down — the same "never fold/substitute an lvalue"
invariant, enforced by a second, independent guard for this second pass. Only the SAME same-file
top-level `consts` map the fold pass already trusts is ever consulted (as of the effectively-const
`let`/`var` feature below, `consts` is no longer real-`const`-only — see there for what else now
feeds it). Dead-declaration elimination is deliberately a simple, NOT scope-aware, whole-file
textual `Identifier` reference count taken AFTER substitution (`countIdentifierRefs`) — a top-level
const that happens to share its name with an unrelated nested shadowing declaration elsewhere in
the file may be kept around (harmlessly inert, its value already fully propagated to every real
reader) rather than removed, but this can never cause an INCORRECT substitution, only an
occasionally-missed cleanup. Tracking itself is not extended by any of this: only the pre-existing
top-level `consts` map is ever consulted or mutated-by-removal; a nested/function-local `const` is
never added to it and stays out of scope, exactly as before.

**Effectively-const `let`/`var` detection** (`analyzeTopLevelConsts` — the function
`collectTopLevelConsts` grew into once it started tracking more than real `const`s; still ONE
top-to-bottom pass, still emitting the SAME `consts` map the paragraph above describes, so
`foldTransformer`/`constPropagationTransformer` need no changes at all): a top-level `let`/`var`
written EXACTLY ONCE across its entire (shadow-respecting) visible scope is semantically
indistinguishable from a `const` — nothing downstream can ever observe a second value, so it's
folded into `consts` exactly like a real top-level `const` (the standard "effectively final"
analysis — the same rule Java applies to lambda capture). Two shapes, both scoped to TOP-LEVEL
declarations only (the identical scope boundary real `const` tracking already used, unchanged — a
function-local/nested-scope `let` stays out of scope):
1. **PRIMARY** — `let x = <init>;` (or `var`) where `x` is never written again anywhere in the
   file — e.g. `let a = 1; let b = a + 3; let c = b + 4; console.log(c);` now collapses to
   `console.log(8n);`, same as the real-`const` version.
2. **STRETCH (landed)** — the two-statement idiom `let x; x = <init>;`: a bare predeclaration (no
   initializer) plus its ONE later assignment, both direct, unconditional statements of the SAME
   top-level statement list (never nested inside an `if`/`for`/`while`/function/block) — including
   the multi-declarator predeclaration form `let a, b, c;` followed by three separate later
   top-level assignments, each resolved independently. This is literally the user-motivating shape
   `let a, b, c;\na = 1;\nb = a + 3;\nc = b + 4;\nconsole.log(c);`, which now ALSO fully collapses
   to `console.log(8n);`.

"Written again"/"written exactly once" is a flat SYNTACTIC count of every assignment/compound-
assignment/update-expression/destructuring-assignment target anywhere in the file that resolves
(respecting the SAME lexical-shadowing rules `substituteConstReads` already applies) to that
top-level binding (`collectWriteCounts`, reusing `substituteConstReads`'s own scope-threading
shape) — deliberately NOT a reachability analysis: a second write inside an `if`/loop/function that
might never execute at runtime still counts and still disqualifies the name, the conservative,
sound rule this feature requires. STRETCH's statement-pair matching only ever looks at
`sourceFile.statements` directly — never recursing into a nested block — so a predeclaration whose
sole assignment lives inside a conditional is correctly never even considered, regardless of the
write-count check. Interaction with the existing while-loop-unroll pairing
(`foldStatementList`/`tryUnrollCountingWhile`, which ALSO recognizes an adjacent
`[counter decl, while]` statement pair): a genuine loop counter is, by construction, written again
inside the loop body (its own increment), so PRIMARY's "zero further writes" check always
disqualifies it before it can reach `consts` — and STRETCH only ever matches a NO-initializer
predeclaration, a shape `tryUnrollCountingWhile`'s own `prev` check never accepts anyway (it
requires `decl.initializer`); since `consts` is fully precomputed once, before `foldTransformer`
(and therefore the while-unroll pass) ever runs, there's no ordering race between the two
mechanisms either. One implementation subtlety worth calling out: `analyzeTopLevelConsts` runs
against its OWN separate `ts.createSourceFile` parse, a different tree instance from the one
`ts.transpileModule` parses internally for the actual transformers — so it (like the paragraph
above) returns NAMES only, never node references; `deadConstEliminationTransformer` RE-DERIVES which
specific statements a STRETCH pair name maps to structurally, fresh, from whichever tree it is
actually handed (`findPairStatements`), since `foldTransformer`/`constPropagationTransformer` ahead
of it may already have rebuilt the assignment statement (e.g. once its RHS itself folds to a
literal) — a node reference captured any earlier would already be stale. DCE-of-a-STRETCH-pair is a
genuinely new kind of elimination (removing a statement PAIR, not a single declarator): once a name
becomes fully dead, BOTH its predeclaration's declarator and its one assignment statement are
removed together, in the same pass — never leaving an orphaned `let x;` behind.

**Folds a call to a same-file, side-effect-free, single-`return`-expression function** (`tsEvalCall`,
another case on `tsEvalConst` itself, alongside Literal/Identifier/Unary/Binary): `function
double(x) { return x * 2n; } const y = double(21n);` folds `double(21n)` to `42n` at the call
site, which then composes for free with the const-propagation/DCE passes above — `const y`
becomes `const y = 42n;` (an ordinary resolved top-level const as far as those two passes are
concerned), so a later `console.log(y)` collapses all the way to `console.log(42n);` and `y`'s
own now-dead declaration is removed, with zero special-casing needed in either pass. **Three hard
boundaries, deliberately not relaxed in this first cut:** (1) the callee's body must have ZERO
`CallExpression`/`NewExpression` anywhere — not just no *recursive* call, no call to ANYTHING,
even another otherwise-foldable function — which is what makes recursion analysis unnecessary (a
body that never calls out trivially can't recurse) and is the entire soundness argument for
folding the call away at all; (2) same-file only, exactly like every other lookup this evaluator
does (`consts`, now `functions` too) — an imported callee is never resolved this way, regardless
of the separate cross-file function-import mechanism; (3) the callee's own `FunctionDeclaration`
is NEVER touched or eliminated — only the call SITE becomes a literal — since it may still be
called elsewhere with non-constant arguments, or itself be pulled across a file boundary by that
same import mechanism; and (4) the callee must be neither a generator nor `async` — calling either
never yields its `return`ed value directly (a generator yields an Iterator, `async` a Promise), so
`foldableReturnExpr` rejects both up front. Parameters bind as a temporary overlay on top of
`consts` (never mutating it), so a body reading a module-level `const` alongside its own
parameter(s) resolves correctly; an omitted argument for a parameter with a default initializer
evaluates that default too (left-to-right, so a later default may see an earlier bound parameter)
— a deliberate choice, not a rejection, since the zero-nested-call check already covers default
initializers as well. Every one of the callee's OWN parameter names is excluded from the overlay's
initial seed (before any are individually bound) so an EARLIER default can never silently fall
back to an outer const sharing a LATER (not-yet-bound) parameter's name — real JS/TS parameter-list
TDZ semantics mean that would actually throw at runtime, so the fold correctly declines instead of
computing the wrong value. Because a zero-argument call is vacuously "every argument constant,"
this also folds calls like `used()` in `ts-frontend.test.ts`'s existing dead-branch-folding
fixture — which is why that fixture's expected `bytecode.length` dropped from 3 to 2 once this
landed (`used`'s own call is inlined away too, so treeshaking drops it exactly like the
already-dead `unused`). `isFoldableValueExpression` now includes `CallExpression` (it's likewise
never an lvalue), and `foldExpression` deliberately never hands a `CallExpression` to the
`ts-evaluator` fallback — call-folding is governed entirely by `tsEvalCall`'s own rules above, not
by whatever ts-evaluator's no-checker `evaluate()` happens to do with a same-file call today
(confirmed to fail closed on every call shape) or in some future version.

**Shadow-safe by construction, not just for calls.** `tsEvalConst`'s Identifier case and
`tsEvalCall`'s callee lookup both consult a `shadowed: ReadonlySet<string>` that `foldTransformer`
grows on the way down through every scope-introducing node it visits (function/method/getter/
setter bodies, blocks, catch clauses, for/for-in/for-of loops) — mirroring
`constPropagationTransformer`'s own shadow tracking one section below. A name reserved by ANYTHING
between the current node and the top level (a parameter, a nested function/let/const/var/
catch-binding of the same name, …) is never resolved against the top-level `consts`/`functions`
maps: a nested `function calc(x) { … }` shadowing an outer top-level `calc`, a parameter named the
same as an outer top-level function (the classic higher-order-function pattern, e.g. `function
callIt(greet) { return greet(1n); }`), a block-scoped `let` of the same name, or simply a
function's own parameter sharing a name with an unrelated top-level `const` (`function f(x) {
return x * 2n; }` beside a top-level `const x`) — all correctly decline to fold rather than
silently resolving against the wrong (top-level) binding.

**Fix (this branch): the `ts-evaluator` fallback wasn't shadow-safe.** `tsEvalConst` itself was
always correctly shadow-aware (above), but `foldExpression`'s fallback to `tryEvaluate`
(`ts-evaluator`'s own `evaluate()`) does its OWN, separate same-file identifier resolution —
confirmed to ignore local (parameter/`let`/`const`) shadowing entirely, resolving straight
through to an outer/top-level binding of the same name regardless. Reachable and confirmed on
this exact shape: `const FLAG = true; function f(FLAG) { if (FLAG) { return 1; } return 2; }` —
`tsEvalConst` correctly failed closed on the shadowed `FLAG` read, but `foldExpression` then fell
through to `tryEvaluate`, which resolved `FLAG` against the OUTER `const FLAG = true` anyway,
silently pruning the whole `if` down to `return 1;` and discarding the parameter (and the
`return 2;` branch) entirely — a genuinely wrong compiled program, not just a missed
optimization. Fixed by a new `containsShadowedIdentifier` guard: `foldExpression` now declines
the `tryEvaluate` fallback outright whenever a shadowed name appears ANYWHERE in the candidate
expression, exactly mirroring the `ASSIGNMENT_OPERATOR_TOKENS`/CallExpression guards it already
applied to the same fallback for other reasons.

**Array/object lookup-table folding.** A top-level `const NAME = [<foldable>, ...]` / `const NAME
= { key: <foldable>, ... }` — a fee-tier table, a tick-spacing table, any table written purely for
readable compile-time reference — where every element/property itself folds to a bigint (the SAME
`tsEvalConst`/`consts` machinery the scalar consts above already use — a table's elements may
reference an earlier scalar top-level const, but never another table: no "tables of tables") is a
candidate lookup table. A candidate is only ever actually tracked once a **whole-file, shadow-aware
soundness scan** (`checkTableSafety`/`isSafeTableRead`, mirroring `constPropagationTransformer`'s
own shadow-tracking) proves every remaining use of its name is a plain, constant-indexed read
(`NAME[k]`/`NAME.prop`/`NAME["prop"]`) that is itself neither a write nor a call target. This is a
strict **allowlist** (only the recognized-safe shape passes), not a blocklist of known-bad shapes,
so an unrecognized escape shape fails closed by construction: the identifier being reassigned or
`++`/`--`-updated; used as the base of ANY method call (`NAME.anything(...)`, regardless of method
name — no whitelist of "safe" methods); an element/property access used as a write target
(`NAME[i] = ...`, `NAME.x = ...`, including one nested — however deeply, climbing through the
object/array-literal "pattern" node shapes TypeScript reuses for destructuring assignment —
inside a destructuring-assignment target like `({ k: NAME.x } = obj)` / `[NAME.x] = arr`); or the
bare identifier passed as a call argument, aliased to another variable, returned, or spread — ANY
of these disqualifies the table from being tracked AT ALL, even if every other access to it would
individually have been perfectly safe (no partial folding of an otherwise-safe table). A
disqualifying use counts even inside unreachable code (`if (false) { ARR.push(1n); }` still
disqualifies) — the scan is purely syntactic, not reachability-aware. `checkTableSafety`
deliberately does NOT reuse the scalar-propagation passes' blanket "class/enum/namespace body →
skip entirely, don't descend" (sound there only because a const scalar's *value* can't be mutated
from inside one without illegally reassigning its binding, already a hard error): a class method
or namespace function CAN mutate a tracked table without reassigning the table's own binding, so
encountering one of these node kinds while scanning instead disqualifies the table outright the
moment its name occurs anywhere inside (a coarser, fail-closed check, not a re-derived "was it
actually a safe read" analysis) — these shapes don't occur in the supported base language surface
and are independently rejected by `compile()` regardless, but `tsPartialEval` is a separately
exported function so this scan fails closed on its own too. Once a table passes the
scan, `tableFoldTransformer` (running right after `foldTransformer`, so a loop-unrolled literal
index like `TABLE[i]` where `i` was just substituted by unrolling is still resolvable) replaces
each resolvable access with its literal element/property value; an access that ISN'T resolvable
(a non-constant index, an out-of-bounds or negative array index, a non-string-literal computed key
into an object table) is simply left untouched and does NOT disqualify other, provably-resolvable
accesses of the same table elsewhere — each access is judged independently once the file-wide
immutability proof holds. **Caveat: "left untouched" only avoids a WORSE fold — it does not, by
itself, guarantee the file still compiles.** The base (non-`tsSource`) SauceScript compiler has no
representation for an array/object literal at all inside a function body — `const TIERS = [500n,
3000n]; function main(idx) { return TIERS[idx]; }` throws `undefined variable: TIERS` with
`tsSource` OFF entirely, independent of this feature. So a table with even ONE access this pass
can't resolve (e.g. an index only knowable via a DIFFERENT function's own local-per-function
constant propagation, which this feature's top-level-only `TopLevelContext` has no visibility
into) still fails the WHOLE compile once handed to `acorn`/the base processor — just with that
same generic, table-fold-unrelated `undefined variable: TIERS` error, not a graceful real-array
runtime-read fallback (there is no such fallback to fall back to) and not a clearer,
table-fold-specific diagnostic either. The now-fully-dead declaration is then removed by the SAME
`deadConstEliminationTransformer` dead-declaration-elimination pass already used for scalar consts
(extended to also track table names). **Explicitly out of scope**, a literal simply never becoming
a candidate (left completely untouched, same as any other non-fully-foldable initializer):
`new Array(n)` (a wholly different, engine-level HEAP-allocated SauceScript concept — untouched
by *this* table-folding feature specifically; a *function-local* `new Array(n)` construction is
folded by a separate mechanism, see "Local `new Array(n)` construction folding" below); a spread
element inside the literal itself (`[...x]`, `{...x}`); an object literal's
shorthand/method/getter/setter property or a COMPUTED property name in the declaration itself
(`{ [k]: v }` — only plain `key: value` / `"key": value` properties are supported); a nested
array/object literal as an element/property value ("tables of tables" — deliberately rejected
rather than supported, keeping the recursive-fold requirement to one flat level); and `for...in`
(this feature only ever folds direct index/property reads, never enumerates).

**Stretch: `for (const x of ARR) {...}` unrolling over a tracked ARRAY table.** Reuses the exact
same safety infrastructure as the numeric `for`/`while` unroller above (`MAX_UNROLL_ITERATIONS`,
`bodyBlocksUnrolling`'s break/continue/return/shadowing bail, `substituteCounter`) adapted to
iterate over the table's ELEMENTS instead of an arithmetic sequence — one copy of the body per
element, the loop variable substituted by its literal value each time, cascading into any nested
`if`/loop/table-access keyed on it exactly like the numeric unroller. Iterating an array table via
`for...of` is always a safe, read-only, non-aliasing use on its own (the elements are immutable
bigints) — so it never disqualifies the table from tracking, independent of whether THIS
particular loop shape can actually be unrolled. The unroll itself declines (leaves the loop as real
runtime code, keeping the declaration referenced) on: `for await...of`; a destructured loop
variable (`for (const [a] of ARR)` — only a single plain identifier loop variable is supported);
a body `bodyBlocksUnrolling` rejects; or the table has **more elements than
`MAX_UNROLL_ITERATIONS`** (256, the same cap the numeric unroller reuses). Because eliding one
`ForOfStatement` in favor of N unrolled statements replaces one statement-list entry with many —
which a single-node visitor cannot express — the attempt only ever fires from a genuine
statement-LIST position (`Block.statements`/`SourceFile.statements`, via a dedicated
`visitStatementList`, mirroring `foldStatementList`'s own role in the numeric/while unroller); a
`for...of` sitting in a single-statement slot (e.g. the un-braced body of an outer `for`/`if`) is
conservatively left un-unrolled. This isn't just a bytecode-shape optimization: plain acorn has
**no** `ForOfStatement` handling at all (`compile()` without `tsSource`/a `.ts` import throws
`not implemented: ForOfStatement` outright), so unrolling this away in the TS front-end is what
makes a `for...of` over a lookup table compilable at all, not merely more efficient — which also
means declining to unroll is a **harder failure here than for the numeric `for`/`while`
unroller**: those gracefully fall back to real `JUMP_BACK` runtime bytecode past their cap, but a
declined `for...of` (e.g. a table with >256 elements) leaves a `ForOfStatement` node with no
runtime-bytecode fallback at all, so `compile()` — even with `tsSource: true` — throws `not
implemented: ForOfStatement` rather than compiling suboptimally.

**Local `new Array(n)` construction folding** (`localArrayFoldTransformer`): a FIFTH `before`
stage, running after `deadConstEliminationTransformer` and strictly BEFORE the local
constant-propagation pass below (which becomes the sixth), that eliminates a function-local
`new Array(n)` — SauceScript's only heap/TUPLE construct (`NEW_ARRAY` 0x9c, written via
`SET_INDEX` 0x9b, read via `INDEX` 0x97) — entirely at compile time when its size, its every
element, and its every read index are all provably constant and the binding provably never
escapes. Concretely: `function main() { const arr = new Array(3); for (let i = 0n; i < 3n; i++)
{ arr[i] = i * 2n; } return arr[1]; }` previously emitted `NEW_ARRAY(3)` + three `SET_INDEX`es +
a real `INDEX` read *even though the loop had already unrolled and every index/value was
already a literal*; it now compiles byte-identically to `function main() { return 2n; }`.

Why it runs where it runs: **after** `foldTransformer`, because it only recognizes straight-line
`arr[k] = v;` statements, which exist solely because `unrollCountingLoop` splices
counter-substituted body copies into the *enclosing* statement list — recognizing an
un-unrolled loop directly would duplicate `extractStep`/`unrollCountingLoop`/
`bodyBlocksUnrolling` and their 256-iteration cap; **after** `tableFoldTransformer`/
`constPropagationTransformer` so a write value spelled `TIERS[0]` or a bare top-level const is
already a literal by the time this pass looks at it; and **before** the local
constant-propagation pass, because a folded element read is what lets that pass finish the job
(`total += fees[0]` → `total += 100n` → `return 3600n`) — the reverse order would leave the
accumulator NAC. The price of this direction, paid deliberately: a write VALUE that only
function-local scalar reasoning can resolve (`let base = 10n; arr[0] = base;`) is NOT folded by
this pass.

Why it is a SEPARATE pass rather than a new `LocalValue` variant in the local pass's own
`Map<name, bigint | NAC>` env: extending that env would make `collectWrittenNames`'s own
documented justification false (it deliberately does not collect an `arr[i] = x` write target
*because* an array-shaped local is always NAC regardless — see that function's own comment
below), turning a non-unrollable `while (cond) { arr[0] = x; }` into a genuine stale-value
unsoundness; and deletion is a whole-function verdict (every index written exactly once, every
remaining use resolvable, or nothing changes) that the local pass's emit-as-you-go forward walk
cannot decide without a separate pre-analysis anyway.

The rules, in the same taxonomy style as the lookup-table section above: the declaration must be
a direct, single-declarator `let`/`const` statement of the function body's own top-level
statement list (`fn.body.statements`) — never nested inside an `if`/loop/block, since
SauceScript shares scope across `if`/`while` bodies (see this file's repeated shadow-fix notes),
so a binding first introduced inside a branch genuinely persists past it and can't be dismissed
as block-scoped; the size must resolve to `1..MAX_FOLDED_ARRAY_ELEMENTS` (256, its own constant,
same value as `MAX_UNROLL_ITERATIONS` but bounding a different thing — the tracked element table
and write-match count, not emitted bytecode growth); every index in `[0, size)` must be written
EXACTLY once by a plain-`=` `arr[k] = v;` statement in the construction region, with every index
and value constant and neither referencing any tracked array (self- or cross-referential
construction is out of scope for v1); write ORDER is unconstrained (unobservable, since every
write in the region necessarily precedes every read — any other occurrence of the name in the
region disqualifies outright); and every remaining occurrence of the name must be the base of an
`ElementAccessExpression` with a constant, in-range index, in read position, after the
construction region, **or** — the one other authorized shape, see below — the SOLE, entire
operand of a `ReturnStatement` in `main()` — a strict ALLOWLIST (now with exactly TWO authorized
shapes) whose default branch disqualifies, so aliasing, a call argument, a spread, `for...of`,
`arr.length`, any method call, rebinding, a compound/update element write, a
destructuring-assignment target, an occurrence before the declaration, an occurrence inside a
nested function-like scope, and a redeclaration of the name anywhere in the function all fail
closed by construction rather than by enumeration.

Two ways this is STRICTER than the lookup-table feature above, and why: (a) safe is not
enough — every surviving occurrence must also be provably RESOLVABLE, because this pass DELETES
the backing allocation, so a single unresolvable read would dangle (the table feature can leave
one unresolvable access untouched precisely because it only ever removes a declaration that
*already* has zero references); (b) all-or-nothing per array, with no partial-fold mode, since
keeping the array alive to serve one runtime-indexed read means keeping every write anyway,
leaving `NEW_ARRAY`/`SET_INDEX` in place for a rounding-error saving.

**The one escaping shape that IS authorized: `main()`'s own `return arr;`.** `return arr;` (or
`return (arr);` — seen through `stripParens`) as the SOLE, entire operand of a `ReturnStatement`,
in a top-level `FunctionDeclaration` named exactly `main`, for a fully-resolved candidate (every
element known, none negative), becomes `return [lit0, …, litN-1];` — the declaration and every
construction write deleted exactly as in the element-reads case (`scanArrayUses`'s Rule 6b →
`LocalArrayPlan.returnArrays` → `rewriteFoldedArrayBody`). Multiple such returns in one `main`
each fold independently, and a return can coexist with an element-read of the same array
(`if (c) { return a; } return a[0];` folds both).

WHY IT IS SAFE, stated as measured facts rather than argued: today a `new Array(n)`-built TUPLE
returned from a Sauce program leaks raw Solidity MEMORY ADDRESSES of per-element structs —
`cook()` on `const arr = new Array(3); arr[0]=0n; arr[1]=2n; arr[2]=4n; return arr;` returns
`0x…03c0 …0480 …0540` (960/1152/1344 decimal), not `0/2/4` and not any recognizable ABI encoding;
v1's `execute()` (`Execution.sol`) returns `ctx.dynamicResult.data` verbatim for a TUPLE, and
`DynamicData.sol`'s own doc comment describes that data as "an array of Dynamic pointers… each
pointer references a Dynamic struct" allocated in a call frame that's discarded the instant the
call returns — meaningless to any external caller. A literal TUPLE return (`return {a:0n,b:2n}` →
`0x260/0x2e0/0x360`) and `return helper()` (calling into a function that itself returns a heap
array) leak the exact same way — of every ARRAY/TUPLE-*shaped* return, the packed STATIC ARRAY
literal this fold produces is the ONLY one with a defined wire encoding (three 32-byte words,
exactly `abi.encode`d `uint256[3]`) — a plain scalar return already had one, unaffected by any of
this. Nothing in this monorepo decodes a Sauce program's TOP-LEVEL return
as an array/tuple today, so this is a strict improvement with no real consumer to regress.

WHY `main()` ONLY, again as measured facts: a HELPER's returned array has no working consumer
today — `let x = helper(); return x[0];` reverts `SauceInvalidOperationArgs` with payload `0x97`
(`INDEX`); `x[0] = 5n;` reverts with payload `0x9b` (`SET_INDEX`) — and reverts IDENTICALLY
(same two payloads) when `helper()` is changed to return a LITERAL array instead of a heap one,
since `Variable.immutablePacked` (the check that would otherwise reject `x[0] = 5n` at COMPILE
time — `processor/statement.ts`, "array literals are immutable (packed)") can only fire when the
compiler statically sees the literal at the assignment site, never across a call boundary — so a
literal escaping via a helper's return degrades to the SAME runtime revert, not a new compile
error. But if this PRE-EXISTING cross-function heap-descriptor gap is ever fixed, a helper
returning a genuinely mutable `new Array(n)` TUPLE would become meaningful — and this fold, having
already turned it into an immutable packed literal, would keep it broken while the un-folded
program started working. `main()` structurally cannot have this exposure: its return value exits
the SauceScript program entirely, and `main` itself is never callable (it's inlined on v12, is the
sole entry point on v1, and `collectImportedFunctions` hard-rejects an imported module defining
`main`). Useful corollary: because an imported module may never define `main`, this fold can NEVER
fire through the `.ts` IMPORT seam (`ctx.transformModule`/`collectImportedFunctions`) — so that
seam needed zero changes, and there is no narrow/wide inconsistency to reconcile there.

**Forcing uint256 element width.** `encodeArray`/`packStaticElements` (`saucer/array.ts`) pick the
SMALLEST byte width across all elements' own magnitudes (via `encodeInt`/`minBytesNeeded` —
`saucer/integer.ts`, the SAME auto-narrowing every plain scalar literal in the language already
gets), so an ordinary `[0n, 2n, 4n]` packs to 1 byte per element (`0x000204` on the wire) —
deterministic, but not ABI-decodable. This fold instead forces BYTE_32 for the literal it
synthesizes, so `cook()` returns three real 32-byte words — exactly `abi.encode`d `uint256[3]`,
verified against the deployed engine (`0x9203` + `20` + three 32-byte words decodes cleanly;
`compiler/integration-test/ts-frontend-array.test.ts`'s "return-escape fold" describe block is the
executable record).

THE CHANNEL, and why it has this shape: `tsPartialEval` returns plain TEXT that `acorn.parse`
re-parses from scratch, so a node this pass SYNTHESIZES can carry no metadata of its own by the
time `compile()` sees it — the width has to ride ALONGSIDE the text, out-of-band, not through the
AST. `tsPartialEvalWithMeta(code, filePath): { text, wideReturnArrays }` is a non-breaking SIBLING
of `tsPartialEval` (whose own `(code, filePath) => string` signature is kept byte-for-byte — it
now just delegates, `return tsPartialEvalWithMeta(code, filePath).text`) — so the `.ts` IMPORT
seam and any external caller of `tsPartialEval` are completely untouched. `wideReturnArrays` is a
`Set<string>` of `elements.join(',')` fingerprints (e.g. `"0,2,4"`), one per fold-synthesized
literal array return, populated by `rewriteFoldedArrayBody` at the moment it builds the literal.
`compile()` (`src/index.ts`) stashes a non-empty set onto a new `CompilerContext.wideReturnArrays`
field; `processReturnStatement` (`processor/index.ts`) checks a return-position array literal's
OWN fingerprint against that set and, on a match, calls `processArrayExpression(...,
forcedWidth: 32)` instead of the ordinary path — which threads through `saucer.array(elements,
forcedWidth)` (all three of `Saucer`/`V12Saucer`/`SaucerLike` gained this same optional parameter)
down to `encodeArray(elements, forcedWidth)`, whose one-line change is `Math.max(forcedWidth,
natural)` for the chosen width — a forced width can only WIDEN an encoding, never truncate one, so
`packStaticElements`/`padToWidth` (which already zero-left-pad to whatever width they're handed)
needed no change at all. One encoder covers all three targets: v1's `Saucer`, v12's `V12Saucer`
(which already delegated to the shared `encodeArray`), and `svm` (a v12 dialect, so it reuses
`V12Saucer` unmodified) all emit the identical wide bytes (v1 with its usual trailing halt byte,
v12/svm without).

THE INVARIANT this channel preserves: an ORDINARY user-written array literal keeps its existing
auto-narrowed encoding, everywhere, on both the `tsSource` and plain paths, INCLUDING in the same
file as a fold — `compile('function main(){ return [0n,2n,4n]; }')` emits the identical narrow
`92030100020400` with `tsSource` on or off, and a single `main` containing both a user-written
`return [1n, 2n];` and a fold-synthesized `return [0n,2n,4n];` emits the narrow form for the first
and the wide form for the second (measured — see the test file above). Two residual, deliberately
accepted imprecisions, both cost-free in practice: (1) the match is a pure VALUE fingerprint, not
a node-identity one, so a user-written return-position literal in `main()` whose elements exactly
equal a fold-synthesized one would ALSO widen — harmless, since the values are identical and the
result is only MORE ABI-conformant, never wrong; narrowed (not eliminated) by gating the whole
mechanism behind a second field, `CompilerContext.isMainBody` (true only while compiling `main`'s
own body — set directly on v1's module-level `ctx` right before compiling `mainFunc`, and copied
onto v12/svm's per-function child context in `processFunctionV12` alongside the existing
`ctx.isMainFunction`), so the same-valued literal would have to sit in `main()` ITSELF to widen,
never in an unrelated helper. (2) A negative element in the source `wideReturnFingerprint` scans
is rejected outright (matching Rule 6b's own guard below), so a user literal with a negative
element never even risks the (harmless) match in the first place.

**The parent-pointer trap**, a mechanism note in the same spirit as this file's others:
`isSafeTableRead`/`isTableAccessUnsafeUsage` classify by walking UP through `node.parent`, but a
node SYNTHESIZED by an earlier transformer stage — exactly what loop unrolling produces — has
`parent === undefined` (confirmed directly against a factory-created node), which would make an
unrolled `arr[0n] = 5n;` look like a *safe read* to that walk-up style of check. This pass
therefore uses a TOP-DOWN scan (`scanArrayUses`) that classifies a node BEFORE descending into
it, and never consults `.parent` at all. Likewise, `tsEvalConst`'s `NumericLiteral` branch calls
`getText()`, which THROWS on a synthesized literal (caught by its own try/catch, returning
`undefined`) — so a plain-number unrolled counter (`for (let i = 0; i < 3; i++)`) would silently
never fold without a fix; `evalArrayConst` adds a synthesized-`NumericLiteral` `.text` fallback
LOCAL to this pass (rather than changing the shared evaluator, which would alter fold behavior
for every other pass in this file).

**Explicitly out of scope** for this first cut (left completely untouched, same as any
non-qualifying shape, and each sound to add later): a top-level `new Array` (uncompilable
regardless — `top-level statements not allowed`, so this scope restriction costs nothing); a
declaration nested inside an `if`/loop/block; holes (a partially-written array, even if only the
read indices are covered); duplicate/last-write-wins writes to one index; self-referential
construction (`arr[1] = arr[0] + 1n`); compound element writes (`arr[i] += x`); `arr.length`
(foldable in principle to the size literal, excluded until an on-chain integration test verifies
`new Array(3).length` actually equals `3n` at runtime); `for (const v of arr)` over a local
array, which remains a hard `not implemented: ForOfStatement` — unrolling it would be an
ENABLING feature (plain acorn has no `ForOfStatement` handling at all), deliberately deferred
rather than folded in this pass; and a ternary index/value resolvable only through
function-local reasoning (this pass has no `LocalResolution`/local-value bridge of its own).

Specific to the `return arr;` return-escape shape (Rule 6b) above: **any NEGATIVE element
disqualifies** the whole candidate — `encodeInt` emits a `[OPS.NEG, opcode, …]` node for a
negative value, so `encodeArray`'s `allStatic`/`allDynamic` check rejects it with `array elements
must be literals or dynamic types`, which would turn a program that compiles TODAY (the heap
`new Array` spelling) into a compile ERROR (confirmed: `compile('function main(){ return [-5n,
1n]; }')` already throws exactly that). A two's-complement widening is a plausible later
extension, deliberately deferred pending engine-side verification of how a NEG scalar actually
materializes on each target. **The bytecode-SIZE direction** is unique to this sub-case: every
OTHER fold in this whole pass SHRINKS bytecode (an eliminated `NEW_ARRAY`/`SET_INDEX`/`INDEX`
costs far more than the literal replacing it), but a forced-wide (BYTE_32) literal element costs
32 bytes against roughly 10 for the `SET_INDEX` it replaces — measured ~3.5× growth at 64 elements
(2052 vs 586 bytes). `MAX_FOLDED_RETURN_ARRAY_ELEMENTS` (64) is therefore its OWN, deliberately
SMALLER cap than `MAX_FOLDED_ARRAY_ELEMENTS` (256) — at the shared 256 cap this sub-case's worst
case would be roughly 8.2 KB, which the pass's own "capped so it can't blow up bytecode size"
charter would no longer actually promise for this one direction. **A helper's `return arr;`**,
however provable, still disqualifies (Rule 6b only ever authorizes a top-level `function main`);
and a returned array actually CONSUMED further by other SauceScript code (`let x = helper();
x[0]`) remains exactly as broken as it is today regardless of this fold (see the "one escaping
shape that IS authorized" note above for the measured revert data that is this scope decision's
entire justification).


**Local (per-function) constant propagation** (`localConstPropagationTransformer`, a SIXTH
`before` stage, appended LAST — after `foldTransformer`, `tableFoldTransformer`,
`constPropagationTransformer`, `deadConstEliminationTransformer`, and `localArrayFoldTransformer`
(the "Local `new Array(n)` construction folding" pass just above), consuming everything above's
output): everything above tracks only same-file TOP-LEVEL `const`s (plus
effectively-const `let`/`var`s and lookup tables — still all top-level). A `let`/`const`
declared and reassigned INSIDE a function body got none of that benefit — this is a NEW,
SEPARATE pass closing that gap: a control-flow-sensitive (but deliberately NOT a real fixpoint
dataflow — see the loop rule below) sequential abstract interpreter, walked fresh and
independently per function-like scope (`FunctionDeclaration`/`FunctionExpression`/
`ArrowFunction`/`MethodDeclaration`/`GetAccessorDeclaration`/`SetAccessorDeclaration` with a
`Block` body), tracking a `Map<name, bigint | NAC>` ("NAC" = not a compile-time constant) per
variable per program point and substituting a read with its known value wherever provable. It
only ever READS the same-file top-level `consts`/`functions` this file's other passes trust (as
a fallback for a name this pass's own function never itself declares/assigns) — it never
mutates them, and doesn't touch, duplicate, or depend on any other pass's own tracking.

Every real `tsEvalConst`/`tsEvalUnary`/`tsEvalBinary` call this pass makes uses the file's ONE
real 4-argument evaluator family (`node, consts, functions, shadowed`) — there is no second
evaluator or lookup abstraction here, only a small per-call-site SNAPSHOT (`resolveLocalEnv`/
`LocalResolution`) of what this pass's own evolving `env` currently resolves each name to,
expressed in exactly those 3 extra arguments: a NAC-tracked name is excluded from the snapshot's
`consts` map entirely (never merely left unresolved — a stale top-level entry of the same name
must not leak through a plain map lookup) and included in `shadowed`; a known-bigint local
overlays the top-level `consts`, correctly shadowing an outer const of the same name with the
REAL current local value; anything else falls through to the top-level `consts`/`functions`
unchanged. A useful, deliberate side effect of reusing the real evaluator family rather than a
separate one: this pass can ALSO fold a call to an eligible same-file top-level function
(`tsEvalCall`) when the call's argument only becomes constant through this pass's OWN local flow
reasoning (e.g. `let x = 3n; let y = double(x);`) — something the top-level-only fold pass could
never see. This is why `collectLexicalNamesInScope` (shared with the bug fix above) also records
a NESTED named `function` declaration's own name, not just `let`/`const`: seeding it NAC keeps it
in `shadowed`, so a call to it can never be wrongly resolved against an unrelated, same-named
TOP-LEVEL function instead of the real (shadowing) nested one.

**Straight-line code**: a declaration's initializer or an assignment/compound-assignment/update's
new value is evaluated against the CURRENT env snapshot; resolving to a bigint updates the
tracked value, otherwise the name becomes NAC. A destructuring ASSIGNMENT target (`[x] =
call()`, `({ x } = call())` — distinct from a destructuring DECLARATION, which is handled
separately) invalidates (marks NAC) every scalar name it writes, via the same
`collectAssignmentTargetNames` helper the loop rule's write pre-scan already uses — not
currently reachable through `compile()` (`processAssignmentMutation` throws "not implemented"
for any assignment target that isn't a bare Identifier/MemberExpression today) but fixed
defensively regardless, so a future compiler extension adding support doesn't silently
resurrect a stale-value bug here. Recognizing an assignment/update expression at the statement
level also unwraps a leading `ParenthesizedExpression` first — an object-destructuring
assignment used as a statement MUST be parenthesized in real JS (`({ x } = obj);`, never a bare
`{ x } = obj;`), so without unwrapping, the assignment inside is never routed through the
env-invalidating path at all. **`if`/`else`** (only when the condition ISN'T already a resolved
compile-time constant — `foldTransformer`, which runs strictly before this whole pass, has
already pruned that case): visits `then` and `else` (or, if absent, an implicit copy that never
touches anything) from independent COPIES of the current env, then merges — a name keeps its
value only if both branches agree (an untouched branch counts as agreeing with the PRE-IF
value); any disagreement, or either side NAC, becomes NAC. The merge only ever revisits names
that are keys of `env` BEFORE the `if` — which is why the function's own env pre-seed covers not
just its parameters but EVERY name `collectLexicalNamesInScope` finds anywhere in its body
(crossing `if`/`while`/bare-block boundaries, only stopping at a nested function-like scope or
class): the REAL SauceScript compiler shares scope across `if`/`while` bodies (see the bug fix
above), so a `let`/`const` first declared inside a branch is NOT block-scoped away once the
branch ends — it is the SAME persisting variable for the rest of the function, and without this
whole-body pre-seed a read of it after the `if` would wrongly fall through to a same-named
TOP-LEVEL const instead of staying an unsubstituted real runtime read (`const FEE = 100n;
function f(cond) { if (cond) { let FEE = 5n; } return FEE; }` must stay `return FEE;`). A name a
branch declares that DOESN'T collide with anything outside the `if` is unaffected either way
(over-shadowing costs at most a missed optimization, never a wrong substitution). **Loops**
(`for`/`while`/`do`/`while` the existing unroller did NOT fully unroll — still real runtime code,
`JUMP_BACK`, by the time this pass sees it): NO fixpoint iteration (bigint is an unbounded
lattice; a real fixpoint needs a widening operator and a termination proof, far more machinery
than this warrants) — instead, every name written ANYWHERE in the loop (any assignment/update/
declaration, at any depth, not crossing into a nested function-like scope) is forced to NAC BOTH
within the loop and from loop-entry onward, even at the first textual reference before its own
write — a later iteration's write could already have happened by then, so there's no
textually-first-safe point to trust the pre-loop value. Untouched names simply keep flowing
through unchanged; this intentionally MISSES a loop-invariant-but-reassigned-to-the-same-value
case, a documented, deliberate tradeoff. **Bails the WHOLE containing function** (left completely
untouched, not even partially analyzed, and not even descended into for nested opportunities) on:
a `switch`/`try`/`catch`/`finally`/labeled `break`/`continue`, or a `for...of`/`for...in` — none
of these 5 shapes has a case in `processStatement`'s switch (`compiler/src/processor/index.ts`/
`statement.ts`) at all, so bailing costs nothing, a source containing one fails to compile
regardless; and a nested function/arrow/method/accessor ANYWHERE within it (at any depth) that
reads or writes a name belonging to the outer function's own parameter/lexical-local scope — a
REAL, non-theoretical concern here, since `something.catch(handler)` (`resolveCatchChain`,
compiler/src/processor/expression.ts) compiles the handler's body with `processBlock` against the
SAME `CompilerContext` as its surrounding code, so a handler that mutates an enclosing local
genuinely reaches through, not a harmless closure no-op; a nested function/arrow that only touches
its OWN locals and/or the outer TOP-LEVEL scope does not trigger this. **Out of scope, on
purpose**: real fixpoint dataflow (see the loop rule above); anything the closure-bail above
already declines to reason about; dead-local-declaration elimination (the read-substitution is
this feature's whole value; a still-live but now-fully-inlined `let x = 8n;` sitting unused is a
nice-to-have cleanup this pass doesn't attempt); and algebraic-identity/dead-code-after-a-
terminator peephole simplifications — skipped here to keep the surface area this change touches
as small as the core requirement allows.

**Ternary (conditional-expression) folding, layered on top of every rule above.** `tsEvalConst`
itself has no case for `ts.isConditionalExpression` anywhere (see the "TWO evaluators" note near
the top of this file) — a ternary's mainstream path folds via `foldTransformer`'s own separate,
MODULE-scope mechanism instead, which this LOCAL, per-function pass has no equivalent of by
construction (it walks fresh per function, against its own evolving `env`/`LocalResolution`, never
`foldTransformer`'s whole-file `consts`). Before this fix, a ternary whose CONDITION was only
resolvable through this pass's own local reasoning (a plain local variable, not a same-file
top-level const `foldTransformer` could ever have seen) fell through to NAC even on a plain
assignment RHS (`x = localCond ? 5n : 6n;`), and the substitution side never restructured/collapsed
a ternary node at all — only visited its children. `evalLocalConst` (used by `foldOrSubstitute`,
the function that decides a declaration/assignment's newly-tracked value) closes the first half of
this gap WITHOUT teaching the shared evaluator family a new node kind: it tries the ordinary
`tsEvalConst` first (unchanged — the common, ternary-free case), and only if that fails, asks
`substituteLocalReads` to structurally COLLAPSE any resolvable `ConditionalExpression` (its own new
dedicated case, mirroring `foldTransformer`'s: evaluate just `.condition` through this pass's
`LocalResolution`, and if it resolves, replace the WHOLE ternary with whichever branch was
selected, itself recursively substituted — so a nested ternary in the taken branch, or any other
locally-known identifier, also resolves, cascading) and re-attempts `tsEvalConst` on the collapsed
result. Together these are what let the motivating shape (`x = localCond ? 5n : 6n;`) propagate
`x`'s new value all the way to a later read, AND let a ternary NESTED inside a larger expression
fold completely too (`let b = (cond ? 2n : 3n) + 1n;` — never itself the whole assignment RHS —
`substituteLocalReads` collapses the ternary first, and the arithmetic around it then folds
normally on the second attempt). **This matters beyond a missed-optimization win**: the base
SauceScript grammar only accepts a ternary directly in assignment/declaration position — a ternary
nested inside another expression, or passed as a call argument, is a hard compile error if it ever
reaches that stage unresolved (`processor/index.ts`'s `processExpression`: `'ternary must be used
directly in an assignment'`). Eliminating a locally-resolvable NESTED ternary here, before `acorn`
ever sees it, is therefore what makes an otherwise genuinely-INVALID program compile at all, not
merely a faster compile of an already-valid one. Composes with every existing rule in this pass
rather than bypassing any of them, by construction — there is no separate lookup path for a
ternary's condition, it is the exact same `tsEvalConst`-against-`LocalResolution` every other
expression in this pass already uses: a ternary depending on a name this pass has forced NAC (the
loop-write rule) correctly declines, since the condition's own lookup fails closed on the
NAC-shadowed name, same as any other read; a ternary whose condition was resolved only via the
if/else merge-at-join rule earlier in the same function correctly uses that ALREADY-MERGED value
(again, the same `env`, no separate path); and a ternary inside a function this pass has already
decided to bail on (the closure-bail rule) is never reached by any of this, since a bailed
function is returned completely untouched before this pass ever walks its body. Whenever the
condition genuinely can't be resolved, `substituteLocalReads`'s fallback rewrites `.condition`/
`.whenTrue`/`.whenFalse` each independently instead of collapsing — so a locally-known identifier
elsewhere inside the ternary still gets substituted, without touching the ternary's own (genuinely
runtime-conditioned) branch structure — matching every other "can't prove it, don't guess" rule
already in this pass. **This also covers a ternary on the RHS of a COMPOUND assignment
(`+=`/`-=`/etc.)**: `evalCompoundAssignmentResult` (the function that decides a compound
assignment's newly-tracked value, one level up from `foldOrSubstitute`) resolves its RHS through
the SAME `evalLocalConst` bridge rather than a bare `tsEvalConst` call, so `x += cond ? 1n : 2n;`
updates the tracked value exactly like the plain-assignment spelling `x = cond ? 1n : 2n;` does —
before this, `substituteLocalReads` already collapsed the ternary in the EMITTED code (`x += 1n;`
printed correctly), but the tracked value independently stayed NAC, so a later read of `x` stayed
un-folded even though the assignment right above it was already a fully-resolved literal — sound
(never a wrong value), just a needlessly missed fold, and now closed the same way every other
asymmetry in this pass is: by routing through the one shared bridge rather than adding a second.

**A function-local declaration that happens to share a name with a top-level const is now ALSO
resolved (to its OWN value), not merely left inert.** Because this pass runs LAST, a shape like
`const RATE = 10n; function f() { const RATE = 2n; return RATE + 1n; }` is no longer completely
untouched end-to-end: the top-level passes above still correctly decline to fold `f`'s own `RATE`
against the outer `10n` (shadow-tracking unregressed), but this pass then separately, correctly
resolves the inner read against `f`'s OWN `RATE = 2n`, so the final output is `return 3n;` — a
strict, sound improvement (the CORRECT own-scope value, never the wrong outer one), not a
regression of the shadow-tracking the earlier passes are responsible for.

**Known limitation (not fixed)**: this only folds/propagates compile-time-known COUNTERS/BOUNDS,
same-file top-level `const` VALUES, function-LOCAL scalar values via the pass above, the narrow
same-file/single-return/constant-args CALL shape, the narrow compile-time-only lookup-table case
above, and — a narrow carve-out, see "Local `new Array(n)` construction folding" above — a
fully-constant, never-escaping, function-local `new Array(n)` construction — not general
array/object DATA processing (`arr[i]`/`.push()`/`for...of` on non-table, non-this-narrow-case
data, mutable arrays, arrays built at runtime with a non-constant size or written with
non-constant values/indices) — ts-evaluator's no-checker mode can't resolve property/array access
or function calls at all, and a full `ts.Program`/TypeChecker is a much bigger lift, out of scope
here.

**Assignment expressions are never folded.** The TS AST represents `=`/`+=`/etc. as a
`BinaryExpression`, and `ts-evaluator`'s `evaluate()` "succeeds" on a bare assignment (e.g.
`evaluate(a = 1)` → `{success: true, value: 1}`), which would silently discard the assignment's
side effect if treated as an ordinary foldable value expression (rewriting `a = 1;` to bare `1;`).
`foldExpression` guards against this up front via an `ASSIGNMENT_OPERATOR_TOKENS` check — a
`BinaryExpression` using any assignment-family operator token always fails closed before either
evaluator runs, so `a = 1` (and `if (a = 1)`) are left untouched.

**Compile cache (`src/cache.ts`) — ON BY DEFAULT** — `compile()` is a pure function of (source,
options, on-disk import contents), so it memoizes: a repeat `(source, options)` returns a cached
`CompileResult` instead of recompiling (~9× on recurring compiles). `options.cache`: omitted/`true`
→ the process-global default store (`getDefaultCompileCache`, bounded LRU); `false` → bypass
(guaranteed-fresh compile); a `Map`/`createCompileCache(maxEntries)` → that store (with hit/miss
stats). The key (`compileCacheKey`) covers every output-affecting option with `compile()`'s own
defaults, so a difference can only MISS, never mis-hit; `baseDirs` resolve to absolute so a relative
dir keys by the file it actually reads (cwd-dependent). **The two inputs the key can't see —
`transformModule` behavior and imported-file bytes — are now a DEFAULT environment contract**: keep
them stable within a process, else a recompile of the same source returns stale bytecode. Escape
hatches: `cache: false` (bypass), `clearDefaultCompileCache()` (after editing an imported file), or
`cacheKeyExtra` (a fingerprint string mixed into the key). Results are cloned in and out, so a
caller can never corrupt the cache and every call returns a fresh mutable result.

**Compiler fixes (this branch):** (a) `new Array(n)` now **infers as DYNAMIC (heap) storage** so the
TUPLE descriptor survives a variable round-trip — scalar/bytes32 storage dropped the descriptor, so
`arr[i]` read/write reverted after `let a = new Array(n)`. (b) v12 `staticCall`/`delegateCall`
`stackEffect` is **-1** (they push a result), not -2 — fixes corrupt SDUP positions when a param is read
after a static call. (c) v12 assembly emits a **no-param ARG-PROLOGUE entry** that pushes the
compile-time args then falls through into `main` (the v12 analogue of v1's appended `CALL_FUNCTION` arg
segment) — so **parameterized programs run on the Huff runtime**. (`main` is inlined, not a table fn →
it can't recurse, same as v1.) (d) **Array destructuring of multi-output call returns**:
`const [price, tick] = pool.slot0()` compiles on v1+v12 and makes ONE external call — raw returndata
lands in a hidden heap temp, each bound element is re-derived via `INDEX(ABI_DECODE(READ(temp)))`, so
the decoded tuple is never stored and the v1 descriptor round-trip fault can't happen. Shape B
(`const s = pool.slot0()` then `s[k]`) keeps its store byte-identical (arrakis/pendle `return result`
bare reads still compile), but the indexed reads/writes that were guaranteed v1 runtime faults
(`SauceInvalidOperationArgs(INDEX)`) are now compile errors pointing at destructuring; v12 untouched.
(e) **`return arr;` in `main()` for a fully-constant local `new Array(n)` now folds to a literal
array** (BYTE_32-forced, so `cook()` returns a real `uint256[N]`) instead of leaking the raw
memory-pointer garbage a `new Array(n)`-built TUPLE return produces today — see "Local `new
Array(n)` construction folding" above (`scanArrayUses` Rule 6b, `wideReturnArrays`, and the
"Forcing uint256 element width" mechanism note) for the full design and the measured proof.
(f) **`let arr = helper();` now infers DYNAMIC (heap) storage when `helper()`'s own body returns a
dynamic value** (a `new Array(n)`-built TUPLE, an array/object literal, a DESTRUCTURED dynamic ABI
output — `const [n, xs] = Contract.at(addr).method(); return xs;` — …), and so does plain aliasing
of an existing dynamic local (`let b = a;`, no call involved) — all previously fell back to scalar
storage and reverted `SET_INDEX`/`INDEX` at runtime on v1, the same failure family as (a) above one
call-boundary further out. See "Same-file user-function return-kind inference" below for the full
design (a new fixpoint pre-pass, `processor/return-kind.ts`) and the measured proof; v12/svm were
already unaffected for an unrelated reason (also documented there). Passing a dynamic local as a
CALL ARGUMENT into a same-file function remains a known, separate, still-open gap.

**Known v12 limit (follow-up):** the Huff runtime's dynamic-value descriptor packs the data pointer in
16 bits (region `0x5000`→`0xFFFF`, ≈45 KB), so a program whose total dynamic data exceeds that gets a
truncated pointer → garbage read → revert. The fix needs a runtime-wide Huff pointer widening — out of
scope here.

**v1 helper-declaration-order fix:** v1's `processProgram` used to `ctx.addFunc` each helper
INTERLEAVED with compiling it, in file-declaration order — so a helper could only call an
EARLIER-declared helper; a forward reference threw `Function X is undefined.` v12 never had this
restriction (`processProgramV12` already registers every helper name in one pass BEFORE compiling
any of them). v1 now mirrors that: two loops (register all names, then compile) instead of one, so a
helper may call a helper declared later in the file, on both targets.

**Inline (arrow-const) functions:** a top-level `const NAME = (params) => body;` (concise or block
body) marks `NAME` INLINE — every call to it, anywhere (same file, or cross-file via the existing
`import { fn } from "./mod"` source-import mechanism), is spliced into the call site's statement list
at compile time instead of emitting a real `CALL_FUNCTION`/function-table entry. A plain
`function NAME() {}` is completely unaffected — this is purely additive/opt-in. Real-world motivation:
a large recipe file was hand-duplicating small pure-arithmetic guard-clause helpers inline because
"the compiler forbids a helper calling another helper" (only true in the sense that helper→helper
calls previously required the ordering above, and there was no lightweight always-inlined option) —
`tickArg`/`kyberOut`-shaped functions (nested `if (cond) { return X; } ... return Y;`, no loops) are
the concrete target shape.

Implementation is a pure acorn-AST-to-acorn-AST rewrite (`src/processor/inline.ts`) that runs ONCE,
right after `collectImportedFunctions`/`extractFunctionDeclarations` build the declaration list but
BEFORE treeshake and the `ctx.isV12` fork — so v1 and v12 both compile the already-expanded, ordinary
SauceScript AST unmodified; neither target needed any inline-specific codegen. Algorithm, per call
site: (1) evaluate each argument once, bind it to a fresh `const` (matching normal call semantics —
never re-evaluated even if the callee reads its parameter more than once); (2) alpha-rename every
local the callee introduces (params + `const`/`let` declarations) with a globally-unique `#`-prefixed
suffix — `#` can never appear in a user-typable SauceScript identifier (acorn rejects a bare `#name`
outside a class body as a syntax error), the same collision-proof convention `CompilerContext.
freshTemp()` already uses (`#tmp<N>`) — so repeated/simultaneous expansions of the same or different
inline functions, and a user local that happens to share a base name, never collide; (3) run
"return-elimination": walk the callee's (renamed) body, turning `return expr;` into
`#inline_result_N = expr; #inline_done_N = 1;` and, for an `if`/`if-else` whose branch(es) contain a
return, recursing into each branch and wrapping everything AFTER the `if` in
`if (#inline_done_N === 0) { … }` (since a taken branch may already have produced the result) — this
is what soundly handles guard clauses WITHOUT unconditionally hoisting a branch-only computation (an
earlier, rejected approach: hoisting a callee's nested/guarded local out of its `if` can silently
compute a wrapping/underflowing value on the branch that never actually runs). Fixpoint: an inline
function calling another inline function expands correctly regardless of order, because a call graph
covering both inline AND real functions is built and checked for cycles FIRST (direct or mutual
recursion — including a cycle that routes through an intervening real function, e.g. inline A calls
real B which calls back into A — is a clear compile error, not a hang; a cycle entirely among real
functions is left alone, since that's ordinary supported runtime recursion bounded only by gas, not a
hazard specific to inlining). A separate hard cap (`MAX_INLINE_EXPANSIONS`, 4096) bounds the total
number of call-site expansions in one compile, so a non-cyclic but exponentially-fanning-out DAG of
inline functions (a "diamond": each level calls a shared lower-level helper more than once) fails
closed with a clear error instead of a multi-minute compile or a V8 argument-count crash.

Bail conditions (fail closed — a compile error, never a silent fallback): a `for`/`while` loop, a
switch, a `try`/`catch`, a labeled or bare-block statement, a destructuring parameter or declaration,
or a nested function/arrow anywhere in an inline body; an inline call inside a `for`/`while`
loop's own header (init/test/update — those are single-expression slots that can't host a
multi-statement splice; an inline call as an ordinary statement INSIDE the loop body works fine); an
inline call inside a ternary branch or the right-hand side of `&&`/`||` (conditionally evaluated —
hoisting there unconditionally would be exactly the same unsoundness the guard-clause handling
above exists to avoid); a callee whose body doesn't return on every path, UNLESS the call is a bare
discarded statement (its value unused, so a validate-or-revert-only helper is fine); more than
`MAX_INLINE_EXPANSIONS` (4096) total call-site expansions in one compile. Known limitation, matching
the real-world need: **loop-free guard-clause functions only** for this version of the feature — a
helper that genuinely needs a loop stays a real `function`.

**Known gap (not fixed, documented):** `validateInlineable`/`detectInlineRecursion` run over EVERY
declared inline function up front, before treeshake — so an inline function that's never actually
reachable from `main()` (unlike an unreachable REAL function, which treeshake silently drops before
it's ever compiled) still fails the whole compile if it violates a bail condition or participates in
a recursive cycle. A fully correct fix needs the splicing pass itself to skip unreachable
declarations too (not just gate validation), since eagerly splicing an unreachable-but-genuinely-
recursive inline function without also skipping its recursion check would trade a clean compile error
for a possible hang during splicing — deliberately left as-is (fail closed, just occasionally eager)
rather than risk that regression.

**Same-file user-function return-kind inference** (`processor/return-kind.ts`'s
`analyzeFunctionReturnKinds`, wired into `processProgram` right after treeshake and BEFORE the
v1/v12 dispatch): the THIRD instance of the exact same bug family as the already-fixed
`new Array(n)` scalar-kind bug (`inference.ts`'s `NewExpression` case, "Compiler fixes (this
branch)" (a) above) and the `multiOutputCall` guard (`processor/statement.ts`) — one call-boundary
further out than either. `let arr = helper();`, where `helper()`'s own body returns a
`new Array(n)`-built TUPLE (or any other dynamic-kind expression), used to infer `arr` as `scalar`:
`inferKindWithContext`'s fallback (`inference.ts`, before this fix) special-cased only
`MemberExpression`, so an `Identifier` or `CallExpression` initializer always fell through to the
ctx-FREE `inferKind`, whose `CallExpression` case (`inferGlobalCallKind(expr) ??
(isDynamicMethod(expr) ? 'dynamic' : 'scalar')`) only recognizes specific GLOBAL/builtin call
shapes — it has no notion of a same-file user function's own return shape at all, so it silently
defaulted to `'scalar'`. On v1 a scalar (`WRITE_VALUE`) store of a dynamic value is fatal: v1's
`_executeWriteValue` (`node_modules/sauce/engine/src/runtime/Memory.sol`) stores only the returned
`bytes32` and never touches `ctx.dynamicResult` (`_writeHeap` in the same file DOES copy it) — the
TUPLE descriptor is destroyed, and the word actually persisted is the array's byte LENGTH (96 for
3 elements), not a descriptor at all. A later `arr[0] = x;` then reverted
`SauceInvalidOperationArgs(0x9b)` (`SET_INDEX`, `DynamicData.sol`) and a bare `arr[0]` read reverted
`SauceInvalidOperationArgs(0x97)` (`INDEX`) — confirmed via real anvil execution, reproducing
IDENTICALLY with and without `tsSource: true` (this is core-acorn-stack, not a ts-frontend
feature). **A second, independent instance of the identical gap**: `inferKindWithContext` had no
`Identifier` case either, so plain ALIASING of a dynamic local with NO function call anywhere
(`const a = new Array(3); let b = a; b[0] = 1n;`) reverted the same way.

The v1 engine itself is not at fault — `runtime/Function.sol::_executeFunction` already propagates
a callee's dynamic result back to the caller correctly (confirmed by hand-patching `main()`'s
compiled bytecode to use `ALLOCATE_HEAP`/`WRITE_HEAP`/`READ_HEAP` instead of the value-slot ops: it
executed correctly on the real deployed engine, non-vacuously round-tripping distinct element
values). The defect is purely a compile-time inference gap, and the fix is purely compiler-side.

Fixed with three changes:

1. **`inferKindWithContext` (inference.ts)** now special-cases `Identifier` (look up
   `ctx.getVar(name)?.kind` — the SOURCE variable's own tracked kind is ground truth, fixing
   aliasing) and `CallExpression` whose callee is a same-file function (look up
   `ctx.getFunctionReturnKind(name)`, fixing the helper-return shape) BEFORE falling through to the
   pre-existing `MemberExpression`-only special case and the ctx-free `inferKind` fallback.
2. **A new fixpoint pre-pass, `analyzeFunctionReturnKinds` (`processor/return-kind.ts`)**, computes
   every declared function's own return kind up front, so `getFunctionReturnKind` has an answer
   BEFORE any function body is compiled. This can't be computed incrementally while compiling each
   function's own body (declaration-order dependent — a caller declared BEFORE its dynamic callee
   would still see the callee's not-yet-analyzed default; confirmed reachable via a 3-level forward-
   reference chain, see below) — it is a monotone fixpoint over a height-1 lattice instead: every
   function seeds `'scalar'`, only ever PROMOTES to `'dynamic'`, over up to `declarations.length + 1`
   full passes (bounding termination — a call chain of N functions needs at most N promotions to
   propagate end to end, plus one final no-change pass to detect convergence). Per function, per
   pass, a flat (deliberately NOT per-branch-scoped) `Map<name, kind>` walks the body in source order
   — flat because the REAL compiler shares scope across `if`/`while` bodies (`processIfStatement`/
   `processWhileStatement` never `ctx.pushScope`; only `processForStatement` does), so a binding
   first declared inside a branch is the SAME persisting variable for the rest of the function, not
   one this analysis could safely forget once the branch ends. A function's own return kind is the
   UNION (OR) of every reachable `return` argument's kind — the sound direction: v1's `_writeHeap`
   stores a non-dynamic result as a plain `BYTE_32` primitive and `_readHeap` decodes it straight
   back, so a scalar value survives a HEAP slot, but a descriptor provably does NOT survive a VALUE
   slot — so a mixed-return function (one path scalar, one dynamic) is safely over-classified
   `dynamic` rather than risking the fatal under-classification. `analyzeFunctionReturnKinds`'s
   result is written onto a NEW `SharedModule.returnKinds: Map<string, VariableKind>` field
   (`context.ts`, alongside `functions`/`funcMeta`/`defines` — shared through `forFunction()`, so a
   v12/svm helper's own child context sees the identical map main's compilation does) via
   `ctx.setFunctionReturnKind`/`getFunctionReturnKind`, run ONCE in `processProgram` right after
   treeshake (so an unreachable function's shape never affects the analysis) and BEFORE the
   `ctx.isV12` dispatch (so both targets see identical results).
3. **`analyzeFunctionReturnKinds`'s own `walkStatement` now also handles a DESTRUCTURING
   declarator** (`const [n, xs] = Contract.at(addr).method();`, an `ArrayPattern` `declarator.id`)
   — see the dedicated "A fourth instance, FIXED" note below for why this needed its own,
   separate fix landed after the three items above (it is a genuinely distinct code path, an
   `ArrayPattern` the original `VariableDeclaration` case silently skipped entirely, not a gap in
   any of the three mechanisms just described).

Deliberately does NOT model per-parameter kinds (a function that merely returns one of its own
parameters stays `'scalar'` from this pass's point of view) — see the open gap below, a DIFFERENT
bug this fix does not touch.

**v1 status: FIXED, verified via real EVM execution** (`integration-test/function-return-kind.test.ts`)
on: the exact motivating shape (helper builds a `new Array(n)` via an unrolled loop; `main()`
assigns, overwrites one element with a genuinely runtime value — `address.balance`, so this can't
be satisfied by a lucky compile-time fold — and returns it); a mutation and a read-only consumption
variant; plain aliasing with no call at all; declaration order (callee declared after its caller);
a 3-level forward-reference chain (`a()` calls `b()` calls `c()`, only `c()` directly dynamic —
the shape that specifically requires the fixpoint's extra iterations, not a single top-to-bottom
pass); a mixed-return helper; and all of the above again with `tsSource: true` (proving this is
core-acorn-stack, not ts-frontend-specific). A scalar-returning helper (`function twice(x){return
x*2n}`) compiles to byte-identical, completely unaffected bytecode (`test/return-kind.test.ts`'s
negative control) — this fix can only ever WIDEN a storage kind from scalar to dynamic when
warranted, never the reverse.

**v12/svm status: was ALREADY WORKING before this fix, for an unrelated reason** — `V12Saucer.store`
(`saucer/saucer-v12.ts`) IGNORES its `_kind` parameter entirely and derives the actual storage kind
from `value.isDynamic` on the value node itself, and `V12Saucer.callFunction` hardcodes `false` for
that flag on its returned node regardless of the callee's real return shape. So the (wrong, pre-fix)
kind `inferKindWithContext` computed was never even consulted on v12/svm — the same conceptually-
wrong-but-harmless bytecode shape (a `WRITE_VALUE` immediately after `CALL_FUNCTION`) executes
CORRECTLY there because the v12/svm postfix design represents a dynamic value as a single 32-byte
descriptor WORD (not a separate out-of-band `ctx.dynamicResult`, as on v1) — `engine-v12/v12/
handlers/Memory.huff`'s `do_write_value`/`do_read_value` and `do_write_heap`/`do_read_heap` are
byte-for-byte the same `mstore`/`mload`, differing only in memory region, so storing a descriptor
in a VALUE-region slot round-trips losslessly. Verified empirically (not just reasoned): a
temporary `V12ExecParity` vectors run against the real Huff runtime (`../sauce/engine-v12` full
checkout, copied to a scratch dir — nothing in the engine repo touched) and the LiteSVM harness
both passed all of the fixture programs above (including the forward-reference chain and mixed-
return shapes) BEFORE this v1 fix even landed — this v1-vs-v12/svm asymmetry on IDENTICAL source
(engine-side calling convention independently proven capable on v1 too, via the hand-patched-
bytecode probe above) is the decisive evidence the defect was compiler-side, not engine-side.
Regression-locked (not merely re-confirmed by reasoning) as transpiler vectors in
`integration-test/v12-execution.test.ts` (`helper_returns_array_mutate`/`_readonly`,
`alias_dynamic_local`) and cases in `integration-test/svm-execution.test.ts`. **A fully-analogous
v12/svm-side consistency fix (`V12Saucer.callFunction` consulting `ctx.getFunctionReturnKind`
instead of hardcoding `false`) was deliberately NOT made** — it is functionally a no-op (v12/svm
already executes correctly either way, per above), while WOULD change v12/svm bytecode shape
(`WRITE_VALUE`→`WRITE_HEAP` + a different slot region) and force re-verification of every pinned
v12/svm bytecode expectation for no behavioral benefit — deferred, not forgotten.

**A fourth instance, FIXED: a helper that DESTRUCTURES a dynamic ABI output and returns it bare.**
`analyzeFunctionReturnKinds`'s `walkStatement` (`processor/return-kind.ts`) originally only handled
a plain `const x = expr;` (`declarator.id.type === 'Identifier'`) declarator — a destructuring
declarator (`const [n, xs] = Contract.at(addr).method();`, `declarator.id.type === 'ArrayPattern'`)
was silently skipped entirely, so a bound name like `xs` never entered the pass's own `locals` map
at all, even though the REAL compiler (`processDestructuringDeclaration`/`abiOutputKind`,
statement.ts) correctly tracks `xs` as `dynamic` for a `uint256[]`/`bytes`/`string` ABI output. A
later `return xs;` in the same helper then fell through `kindOfExpr`'s `locals.get(name) ??
'scalar'` default, so `helper`'s registered return kind was wrongly `'scalar'` — the identical
UNDER-classification this whole feature exists to prevent, reached via a code path (destructuring)
the original fixpoint pass simply didn't model. Confirmed via real EVM execution
(`integration-test/audit-return-kind.test.ts`'s "A7" case,
`integration-test/function-return-kind.test.ts`'s "a FOURTH instance" describe block):
`function helper() { const [n, xs] = Pool.at(addr).list(); return xs; } function main() { let arr
= helper(); return arr[0]; }` compiled
cleanly (a silent miscompile, not a caught error) but reverted at `cook()` on `arr[0]` — the exact
fault code depends on the specific garbage bit pattern the mis-stored `WRITE_VALUE` word happens to
contain (`SauceInvalidOperationArgs(0x97)`, `INDEX`, confirmed on a real deployed-mock-contract
fixture via git-stash bisection; a DIFFERENT repro against an undeployed address instead surfaces
`panic: arithmetic underflow or overflow (0x11)`) — both are the identical root cause, a dropped
TUPLE descriptor.

Fixed by a new `applyDestructuringKinds` helper in `walkStatement`'s `VariableDeclaration` case:
for an `ArrayPattern` declarator, it resolves the initializer's contract-call target via the SAME
`resolveContractCallTarget` (expression.ts) the real compiler's own destructuring lowering uses,
then records each bound name's REAL per-output ABI kind (`abiOutputKind`) into `locals` — exactly
mirroring what `processDestructuringDeclaration` does when it actually compiles the body. Only the
direct `Contract.at(addr).method()`/`.view()`/`.lib()` inline-chain call shape is resolvable this
early: this pre-pass runs against the bare MODULE-level `ctx`, before any statement has actually
been compiled, so `ctx.lookupContract` (populated by `collectImportedFunctions`'s `.json`-import
handling, which runs strictly before this pass) has what it needs, but `ctx.lookupBoundContract` —
the OTHER shape `resolveContractCallTarget` recognizes, for a PRIOR `let pool = Contract.at(addr);`
binding — can never have anything registered yet (that binding is only ever recorded on a
per-function CHILD context while actually compiling a body). Whenever the target can't be resolved
this way, EVERY bound name in the pattern is conservatively marked `'dynamic'` rather than left
unrecorded (which would silently default back to `'scalar'`, reproducing the exact bug this closes)
— the same "when genuinely unsure, promote" rule the fixpoint's own mixed-return handling already
applies; this can only ever cost an unneeded extra heap slot on a shape that was always going to
fail `processDestructuringDeclaration`'s own stricter validation anyway (destructuring requires a
resolvable contract-call initializer, full stop), never a dropped descriptor.

**Known, STILL-OPEN gap, deliberately NOT fixed by this change (a FIFTH, distinct instance of the
same failure family):** passing an existing dynamic local as a CALL ARGUMENT into a same-file
function (`function h(a){ return a[1]; } function main(){ const arr = new Array(3); …; return
h(arr); }`) still reverts `SauceInvalidOperationArgs(0x97)` (`INDEX`) on v1, confirmed reachable
(`integration-test/function-return-kind.test.ts`'s own "KNOWN GAP" test pins this). Two compounding
causes, neither touched by this fix: `processFunction`/`processFunctionV12` always
`ctx.setVar(param.name, argType?.kind ?? 'scalar', …)` for a helper's OWN parameters — there is no
per-call-site parameter-kind inference at all (unlike `main`'s own params, which DO get inferred
kinds via `CompileOptions.args`/`mainArgTypes`) — AND v1's real engine additionally splits a call's
arguments into TWO separate positional index spaces by dynamism
(`runtime/Function.sol::_executeFunction`: a dynamic argument lands in `funcHeap[heapI++]`, a
scalar one in `funcValues[valuesI++]`), which the compiler's own argument-lowering never accounts
for either way. A real fix needs per-parameter kinds derived from call sites AND must respect that
two-array split — a materially bigger change than the return-direction fix above, deliberately left
for a follow-up (or an interim compile-time rejection mirroring the existing `multiOutputCall`
guard) rather than bundled in here.

**v12/svm call-argument gap: CONFIRMED NOT PRESENT, plus a real (unrelated) v12/svm bug found
while proving it.** The FIFTH-instance gap above is documented as v1's own engine-level
funcHeap/funcValues split — a question this branch resolved empirically rather than assuming: does
v12 (the postfix, stack-based dialect) have any equivalent gap? **No.** Verified via real execution
on all three engines (a deployed v1 `Sauce.sol` on anvil, `forge test --ffi` against
`v12/Runtime.huff` on both the pinned engine-v12 checkout and a newer live one, and the vendored
svm `engine.so` via LiteSVM): the exact motivating example
(`function h(a){ return a[1]; } function main(){ const arr = new Array(3); …; return h(arr); }`)
returns the correct value on v12 and svm while still reverting on v1, and so does every variant
tried — mixed scalar/dynamic argument order, a helper chain forwarding the argument two frames
deep, a helper's returned array passed straight into another call, an array-literal argument, a
RECURSIVE call passing a dynamic argument, a two-hop alias (`let b = a; return b[1];`) inside the
callee, and a dynamic parameter's `.length`. This is structural, not incidental: v12 has no
funcHeap/funcValues split to get wrong in the first place — `V12Saucer.callFunction`
(`saucer/saucer-v12.ts`) just emits each argument's own builder (for a dynamic local, a single
`READ_HEAP <slot>` — one 32-byte descriptor word) forward on the ordinary EVM stack, then
`CALL_FUNCTION`; and the callee's parameter is read back via `V12Saucer.read`'s `isParam` branch
(an SDUP sentinel), which **never even looks at the parameter's `kind` tag** — only the *non-param*
branch of `read`/`store` picks `READ_VALUE`/`WRITE_VALUE` vs `READ_HEAP`/`WRITE_HEAP` by kind. So
`processFunctionV12` tagging every helper parameter `kind: 'scalar'` (`processor/index.ts`, same
line the FIFTH-instance gap above cites) is **dead metadata on v12/svm** — confirmed by also
testing the kind-sensitive follow-on shapes explicitly (a callee doing `let b = a; b[0] = 9n; return
b[0] + b[1]*10n;` on its own dynamic parameter round-trips correctly; so does a nested
`o[0][0]` read through a parameter, even with `elementType` undefined). Regression-locked (not
merely re-confirmed by reasoning) as `callarg_*` transpiler vectors in
`integration-test/v12-execution.test.ts` and cases in `integration-test/svm-execution.test.ts`, plus
`self_recursive_dynamic_return`/`mutual_recursive_dynamic_return` (the fixpoint in
`return-kind.ts` converges through a call cycle, and the runtime descriptor round-trips a
recursive RETURN correctly, on v12/svm exactly as it already does on v1 — see
`integration-test/dynamic-kind-sweep.test.ts` for the v1-side proof of the identical shapes). The
v1 gap itself is UNCHANGED and still deliberately unfixed — `function-return-kind.test.ts`'s "KNOWN
GAP" test is retitled "KNOWN GAP (unfixed, v1-only)" so it is never misread as an engine-agnostic
limitation, and `dynamic-kind-sweep.test.ts` extends the same v1-only revert coverage to the
two-hop/recursive/compound-assignment variants. **One shape fails SILENTLY on v1 rather than
reverting**, worth calling out on its own: a dynamic parameter's `.length` — e.g. a `string`
parameter — reads the SCALAR WORD WIDTH (32) instead of the real length, with no revert at all
(`dynamic-kind-sweep.test.ts`'s "SILENT" test pins `"AB".length` via a parameter returning `32n`,
not `2n`); v12/svm read the correct length through the same ordinary stack parameter.

**NEW BUG FOUND while proving the above, and FIXED: v12/svm silently computed the WRONG stack
position for every WRITE to a function parameter** — `V12Saucer.store`'s (`saucer/saucer-v12.ts`)
`isParam` branch used `this.ctx.findStackVar(name)` directly as the `SSWAPn` argument, which is
only the STATIC distance from the top of the param block assuming NOTHING else is on the stack
above the frame's params at that point — true only for `main()` writing its own single parameter
with an empty stack. It silently omitted exactly the two things the READ path (`V12Saucer.read`'s
`isParam` branch, patched in `compile()`) already accounts for: (1) the **+1 call-frame
return-address word** a HELPER's frame carries (main has none — it's inlined, never called), and
(2) the **live expression-stack depth** already built up by the time the `SSWAP` actually executes
(`this.stackEffect` from bytes already emitted, plus the new value's own `stackEffect`). The
consequence, confirmed via a one-byte bytecode patch on the real Huff runtime before any
source-level fix existed (`e1`→`e2` turning `SSWAP1` into `SSWAP2` flipped a wrong-5 result to the
correct 6): a plain scalar parameter write (`function h(x){ x = x + 1n; return x; }` called as
`h(5n)`) **silently returned the PRE-write value (5) with NO revert at all** — a materially worse
failure mode than every other bug in this family, all of which at least revert. Every OTHER
parameter-write shape either corrupted a DIFFERENT, wrong stack slot (writing the middle of three
params, a write inside an `if`/`while` body, two writes to the same parameter) or reverted outright
(any DYNAMIC write — `a[0] = 9n;`, `a[0] += 10n;`, `a = new Array(2);` — through a parameter).
Reproduced identically on both the pinned engine-v12 checkout and a newer live one, so this is
compiler-side, not engine-side. Fixed by computing the real position the same way the read path
already does, one level lower (an `SSWAPn` exchanges the top with the `(n+1)`th item — EVM
`SWAP1` swaps position 1 with position 2 — so it needs one LESS than the "position from top" a
`SDUPn`/EVM `DUPn` consumes directly):

```ts
const depth = this.stackEffect + value.stackEffect;
const frame = this.ctx.isMainFunction ? 0 : 1;
const pos = depth + frame + this.ctx.findStackVar(name) - 1;
```

Verified end to end: fixes every one of the shapes above on both v12 and svm, leaves every
`main()`-level parameter write byte-compatible (the new formula collapses to the old value there —
`main` has `frame = 0` and, for its own top-level statements, `depth` starts at 0 too), and the full
compiler suite (all 64 files, 1582/1582 with `SAUCE_ENGINE_V12` pointed at a full checkout so
`v12-execution`/`svm-execution` actually run) and sdk suite (1782/1782) stay green.
Regression-locked as `param_write_*` transpiler vectors in `integration-test/v12-execution.test.ts`
and matching cases in `integration-test/svm-execution.test.ts` (a scalar write in a helper, the
middle of three params, inside an `if`, inside a `while`, two writes to one param, a dynamic
element write, and a write two call frames deep) — plus `callarg_compound_assign_on_param` /
`callarg_string_param_length`, which additionally lock in that a param write that reverts on v1 (a
DIFFERENT, unfixed gap — see above) now correctly round-trips on v12/svm.

**A SIXTH instance of the return-kind bug family, FIXED: a single, non-destructured dynamic ABI
output stored directly in a variable.** `let xs = List.at(addr).list2();`, where `list2()` returns
exactly ONE dynamic component (e.g. `uint256[]`) — NOT a multi-output call, so the pre-existing
`multiOutputCall` tag mechanism (`processor/statement.ts`) never applied — used to under-classify
`xs` as `'scalar'`: `inferKindWithContext`'s `CallExpression` case only special-cases a same-file
user function's own analyzed return kind, so a direct contract-method call fell through to the
ctx-free `inferKind`, whose generic `CallExpression` case has no notion of a contract call at all
and defaults to `'scalar'` — the identical descriptor-drop hazard as the three original instances,
confirmed via real EVM execution against an etched single-output mock contract
(`integration-test/dynamic-kind-sweep.test.ts`): `xs[1]` reverted `SauceInvalidOperationArgs(0x97)`
(INDEX), `xs.length` silently returned 32 instead of the real length, and both faults propagated
identically through aliasing and through a HELPER that stores-then-returns the call. Two coordinated
fixes, mirroring the shape of the destructuring fix's own two-site pattern: (a)
`processor/statement.ts`'s `storeExpression` default branch now tries a new
`singleDynamicAbiOutputKind(expr, ctx)` helper BEFORE falling back to `inferKindWithContext` — it
resolves the call's target via the same `resolveContractCallTarget` the destructuring lowering
uses, and returns `'dynamic'` only when the call resolves to EXACTLY one dynamic-kind ABI output
(never `'scalar'` — an override, not a replacement — so a multi-output call, an unresolvable
target, a resolvable-but-scalar output, or a `.catch()` chain all fall through unchanged); (b)
`processor/return-kind.ts`'s `kindOfExpr` (the fixpoint pre-pass's own per-expression classifier)
gained the identical case, so a HELPER that stores and returns such a call is classified correctly
too — without it, fix (a) alone only helped the DIRECT store site, and a helper doing the same
thing stayed mis-classified (the fourth-instance bug's exact shape, recurring one level shallower).
Verified: direct read, `.length`, aliasing, the helper-return shape, two sequential calls (proving
one doesn't clobber the other's stored result on v1), and a call with an unrelated `.catch()`-chain
call in between all round-trip correctly now; v12/svm bytecode is completely unchanged by this fix
(`V12Saucer.store` ignores `_kind` regardless, per the established pattern above), and the only
shape still failing afterward is passing the result as a call ARGUMENT — the separate, still-open
gap documented above.

**A SEVENTH instance, FIXED: a ternary whose branches are dynamic, on its FIRST declaration.**
`let x = cond ? arr : other;` used to always store `x` via a bare `'scalar'` default —
`processTernaryStore` (`processor/statement.ts`) never consulted ANY kind inference at all before
this fix, unlike the ordinary (non-ternary) assignment path in the very same file. Confirmed via
real EVM execution that this silently dropped whichever branch's dynamic descriptor was actually
taken (`SauceInvalidOperationArgs(0x97)` on the later `x[1]`), on both a compile-time-resolvable
condition and a genuinely runtime one (`main(cond)`'s own parameter), and on the structurally
identical `if (cond) { let x = arr; } else { let x = other; }` idiom (SauceScript shares scope
across `if`/`else`, so this is the SAME persisting `x`, not two block-scoped ones — see this file's
repeated shadow-fix notes elsewhere). Fixed by computing a `branchKind` — `'dynamic'` if EITHER
`inferKindWithContext(expr.consequent, ctx)` or `…(expr.alternate, ctx)` resolves dynamic, else
`'scalar'` — and passing it into BOTH branches' `store()` calls; this can only happen HERE, not in
`inferKindWithContext` itself, because `storeExpression`'s own `switch` routes a
`ConditionalExpression` to `processTernaryStore` directly, bypassing `inferKindWithContext`
entirely — a case added there would simply never be consulted for a ternary declaration/
assignment. The promote-when-either-branch-is-dynamic rule mirrors the exact same "sound direction"
`analyzeFunctionReturnKinds`'s mixed-return-function handling already relies on (storing a scalar
in a HEAP slot round-trips losslessly on v1; the reverse does not). Verified: both branches of the
FIRST-declaration ternary round-trip correctly now (`integration-test/dynamic-kind-sweep.test.ts`),
and v12/svm — already correct before this fix, for the same "the tag is dead metadata" reason as
everywhere else in this family — are unaffected.

**A companion compile-time REJECTION, new in this branch: a v1 REASSIGNMENT that would need to
re-class an already-scalar variable to dynamic.** The ternary fix above only helps a FIRST
declaration — `Saucer.store` (v1) always uses an EXISTING variable's OWN tracked kind once
`ctx.getVar(name)` finds one, silently ignoring whatever kind a LATER store computes, so `let x =
5n; x = arr;` (a plain reassignment), the analogous `if (cond) { x = arr; }`, and a ternary
REASSIGNMENT (`x = cond ? arr : other;` where `x` was already scalar) all used to compile cleanly
and then drop the descriptor at runtime — confirmed via real EVM execution
(`SauceInvalidOperationArgs(0x97)` on the later indexed read in every case). v1 cannot repair this
(there is no mechanism to re-class a slot after declaration), so `rejectV1ScalarToDynamicReassignment`
(`processor/statement.ts`, called from both `storeExpression`'s default branch and
`processTernaryStore`) now rejects it at compile time instead — a strict improvement (a clear error
beats a silent runtime revert) — whenever `!ctx.isV12 && existing?.kind === 'scalar' && newKind ===
'dynamic'`. This SUPERSEDES two existing unit tests in `test/destructuring.test.ts`
(`'clears the tag on reassignment'` / `'ternary reassignment clears a stale tag'`) that had
previously asserted these exact shapes "kept compiling" — they did, but only because nothing before
this fix noticed the reassignment was unsafe; both are updated to assert the new rejection instead,
with the real-execution evidence that motivated the change recorded in their comments. The reverse
direction (a scalar stored into an ALREADY-dynamic slot) is untouched and still round-trips fine,
exactly like the mixed-return-function case; only `existing.kind === 'scalar'` triggers the
rejection. v12/svm are exempt outright (`V12Saucer.store` derives the real kind from
`value.isDynamic`, never from an existing variable's stale tag) and every rejected v1 shape compiles
cleanly there — see `test/dynamic-reassignment-guard.test.ts` for the full compile-time matrix
(rejected shapes, the one shape correctly NOT rejected, and the v12 unaffected-control).

**A pre-existing v12/svm FEATURE GAP found and closed with a compile-time rejection (not a
kind-inference bug): a NESTED array literal.** `const a = [[1n, 2n], [3n, 4n]]; return a[1][0];`
compiles and executes correctly on v1 in every form tried (direct, aliased, returned from a helper —
`elementType`/kind inference already handles it) — only passing one as a call ARGUMENT hits the
separate, already-documented v1 call-argument gap above. But on v12 AND svm, the identical literal
fails in EVERY form (an empty revert on v12, `InvalidInstructionData` on svm), confirmed via real
execution — while a FLAT literal (`[1n, 2n, 3n]`) and an equivalent NESTED structure built with
`new Array(n)` (`outer[0] = inner;`) both work fine on v12/svm, isolating the fault to the nested
literal's own STATIC encoding specifically, not to nesting or dynamism in general. This is a
pre-existing engine-v12/svm feature gap (no nested-ARRAY encoding in `DynamicData.huff`/the svm
engine yet), not a compiler kind-inference defect, so there is no descriptor to "fix" — but leaving
it as an opaque runtime revert is worse than necessary. `processor/collection.ts`'s
`processArrayExpression` now calls a new `assertNoNestedArrayLiteral` guard that rejects, at compile
time, any array literal with an `ArrayExpression` element whenever `ctx.isV12` — pointing at the
working `new Array(n)` alternative — while leaving v1 (and a flat/`new Array`-nested literal on
every target) completely untouched. See `test/array.test.ts`'s "nested array literal" describe
block for the full matrix (v1 unaffected, v12/svm rejected with a clear message, flat/`new
Array`-nested unaffected).

**Sweep findings investigated and confirmed NOT reproduced (documented so they are not
re-investigated as this same bug family):**
- **`&&`/`||` are boolean operators, not JS-style value-returning short-circuits** — SauceScript
  lowers them to `BOOL_AND`/`BOOL_OR` (`processor/expression.ts`'s `processLogicalExpression`), so
  `cond && arr` yields a boolean engine-consistently on every target; indexing the result is a
  meaningless program (`x[1]` on a boolean), not a dropped descriptor. Confirmed via real execution
  that `let c = 1n; let x = c && 3n; return x;` returns `1n` (never `3n`) on v1 — locked in
  `integration-test/dynamic-kind-sweep.test.ts`.
- **A recursive same-file function's fixpoint convergence, and the runtime round-trip across a
  recursive RETURN, are both already correct** — confirmed for self-recursion AND mutual recursion,
  on v1 (`integration-test/dynamic-kind-sweep.test.ts`) and on v12/svm
  (`self_recursive_dynamic_return`/`mutual_recursive_dynamic_return`). The height-1-lattice fixpoint
  in `analyzeFunctionReturnKinds` (`return-kind.ts`) converges through a call CYCLE exactly as
  designed, non-vacuously (both vectors require at least one promotion to propagate through the
  recursive call before the fixpoint stabilizes).
- **`.catch(handler)` introduces no descriptor-kind gap of its own** — a handler mutating an
  enclosing dynamic local, and a dynamic local declared before an unrelated intervening `.catch()`
  chain, both round-trip correctly on v1 (`integration-test/dynamic-kind-sweep.test.ts`, reusing the
  existing `MockTarget.revertWithMessage()` fixture from `try-catch.test.ts`) — consistent with
  `resolveCatchChain` compiling the handler against the SAME `CompilerContext` as its surrounding
  code, a real (not merely theoretical) closure-sharing mechanism documented elsewhere in this file.
- **Compound assignment (`+=`) and its aliasing composition are clean** — `arr[0] += 10n;` and the
  same through an alias (`let b = a; b[0] += 10n;`, proving the write lands on the shared backing
  array) both round-trip correctly on every target; `arr[0]++` remains a clean `not implemented:
  update on MemberExpression` compile error everywhere, a feature gap, not a miscompile. Only a
  compound assignment through a CALL-ARGUMENT parameter inherits the pre-existing (v1-only, now
  regression-locked both ways) call-argument gap.
- **Object-literal property read/write and a bare parameter's property read are already rejected
  outright at compile time** (`test/index.test.ts`) — there is no object-shaped LOCAL variable or
  parameter whose storage kind could ever be mis-inferred, since the struct/object path only exists
  for ABI struct call arguments (`processAbiArg`), never for a local value.

**Deliberately NOT actioned in this branch: a separate, PRE-EXISTING v12 ENGINE bug found while
investigating the above, affecting the PINNED engine only.** While proving the single-dynamic-output
fix's `.catch()`-composition case, a later heap allocation or external call was found to clobber an
ALREADY-DECODED dynamic ABI output on the currently-PINNED `engine-v12` (including through the
SHIPPED `const [n, xs] = …` destructuring syntax) — but the identical vectors all PASS against a
newer, live `engine-v12` checkout, so the fix already exists upstream; this is not a compiler defect.
Actioning it means repinning the `sauce` git dependency to a fixed commit and following this file's
own repin ritual (`sync-engine-artifacts` + committing the refreshed EVM/svm artifacts) — deliberately
NOT done here: identifying the exact upstream commit that fixed it needs its own investigation, and a
repin changes engine artifacts widely enough (affecting far more than this branch's own scope) that
it belongs in its own dedicated change, not bundled into a compiler-focused fix. Left as an open
follow-up; the pinned-vs-live split itself is the only evidence needed that this is engine-side.

**RESOLVED by the repin.** The dep now pins **`release/beta`** (was `feat/router-flash-callback`),
which carries the upstream v12 fixes — `fix(v12): port 10 Octane audit findings`, `fix(v12-saucer):
one stack model for REF/SET/DROP`, INDEX bounds checks across the v12 interpreter and SVM engine,
and the ABI_DECODE static-array operand-order fix. With that pin, the FULL compiler suite passes
with **nothing skipped** — 64/64 suites, 1622/1622 tests, including both `SAUCE_ENGINE_V12`-gated
suites (`v12-execution`, `v12-solidity-parity`) run against a `release/beta` `engine-v12` checkout.
Note the repin target: `main` is **not** a valid pin — it diverged from the engine line on
2026-06-18 onto a `compiler-rs` (Rust rewrite) track and does **not** contain `CAST_BE`/`CAST_LE`
(0x54/0x55), which this compiler emits for the svm `uint()`/`accountUint` lowering and for scalar
destructuring slot reads, so pinning `main` would break the svm target outright. `release/beta`
contains the previous pin as an ancestor, so a repin to it is a strict superset — no engine feature
is lost.

**Adversarial-audit fixes (this branch), three more instances of the same failure families:**

1. **The SIXTH-instance return-kind fix's `kindOfExpr` gap: a variable-BOUND contract call
   (`let pool = Contract.at(addr); pool.method();`) inside a HELPER couldn't resolve during the
   fixpoint pre-pass.** `analyzeFunctionReturnKinds` (return-kind.ts) runs against the bare
   module-level `ctx`, strictly before any function body is actually compiled — so
   `ctx.lookupBoundContract` (only ever populated on a per-function CHILD context via
   `consumePendingContractBinding`, which runs while REALLY compiling a body) has nothing
   registered yet. `kindOfExpr`'s single-dynamic-output-call case therefore fell through to the
   ctx-free `inferKind` fallback for a bound-variable call specifically (the INLINE
   `Contract.at(addr).method()` chain shape was already fine, resolvable via `ctx.lookupContract`
   alone) — silently under-classifying a helper like `function helper() { let pool =
   List.at(addr); return pool.list2(); }` as `'scalar'`, dropping the descriptor exactly like the
   original bug. Fixed by tracking a `let pool = Contract.at(addr);` declarator into a NEW,
   pass-local `localBoundContracts` map (mirroring `consumePendingContractBinding`'s real
   registration, but never mutating the shared `ctx` itself — see `matchStandaloneBindingShape`,
   a new side-effect-free sibling of `resolveStandaloneBinding` in expression.ts) so
   `resolveMethodTarget` (return-kind.ts) can resolve the later `pool.method()` call within the
   SAME function during this pass too. `applyDestructuringKinds` (the sibling destructuring-
   declarator case) is DELIBERATELY left untouched: it already handles this exact unresolvable
   shape by conservatively promoting every bound name to `'dynamic'` — see
   `integration-test/function-return-kind.test.ts`'s own "conservative fallback" test, which pins
   that as intentional, already-safe behavior, not a bug. Regression-locked in
   `test/return-kind.test.ts` (compile-time bytecode-shape proof) and
   `integration-test/dynamic-kind-sweep.test.ts` (real EVM execution).

2. **Inline (arrow-const) functions could no longer return ANY dynamic-kind value on v1 — a
   hard, unconditional compile-time regression caused by this same session's OWN
   `rejectV1ScalarToDynamicReassignment` guard.** The inline splicer shares ONE variable
   (`#inline_result_N`) across every reachable `return` in a guard-clause body, always seeded
   with the scalar placeholder literal `0n` — so a callee that actually returns a dynamic value
   (a `new Array(n)` TUPLE, an array/object literal, a `.concat()`/`.slice()` string, …) tripped
   the reassignment guard on its first real return assignment: a hard compile error, for EVERY
   dynamic-returning inline function, with no way to write one at all. Confirmed genuinely part
   of this bug family, not a false positive: on the pre-guard commit the identical source
   compiled cleanly and then reverted `SauceInvalidOperationArgs(0x97)` (INDEX) on real EVM
   execution — the guard was correctly catching a real, previously-SILENT descriptor drop; the
   sentinel's own kind was simply never classified dynamic in the first place. Fixed by
   `couldReturnBeDynamic` (inline.ts): a conservative, ctx-free scan of the callee's own
   (pre-splice) return expressions — mirroring return-kind.ts's OR-across-every-reachable-return
   rule — that seeds `#inline_result_N` with a dynamic-kind placeholder (an empty string literal;
   any dynamic value's storage kind is generic on both engines, so the specific placeholder shape
   is irrelevant) whenever the callee MIGHT return dynamic. Deliberately biased toward
   "unsure → assume dynamic" for anything not specifically recognized as scalar (a call, a
   property/index-access base of unknown kind, …), while still recognizing the common,
   purely-arithmetic guard-clause shape (`tickArg`/`kyberOut`, this feature's own motivating
   case) as scalar, so EXISTING scalar-only inline functions keep their byte-identical
   (`WRITE_VALUE`) bytecode. A parameter returned unchanged is checked against the ACTUAL
   call-site argument expression, not the callee's own (opaque) parameter name — but a bare
   Identifier argument (as opposed to a directly-dynamic-LOOKING one) is deliberately left
   scalar-seeded rather than blanket-promoted, since promoting every identifier argument would
   regress the `tickArg(shifted, OFFSET)` motivating shape itself (two ordinary scalar
   identifiers). Residual, deliberately accepted gap: identity-style passthrough of an EXISTING
   dynamic caller-scope local through an inline function (`identity(arr)` where `arr` is a `new
   Array(n)` local) still hits the reassignment guard — a real but narrower gap than the
   original finding, and still SAFE (a clear compile error, never a silent drop). Regression-
   locked in `test/inline-functions.test.ts` (compile-time, including the negative control that
   pins the unaffected scalar bytecode shape byte-for-byte) and
   `integration-test/inline-functions.test.ts` (real EVM execution).

3. **A NINTH instance of the dynamic-value storage-kind family, structurally different from the
   other eight: an object-literal FIELD reading an EXISTING dynamic-kind variable.**
   `processObjectExpression` (collection.ts) had no safety check analogous to
   `processArrayExpression`/`encodeArray`'s own static/dynamic element-consistency check — `{ a:
   inner, b: 5n }` (`inner` a `new Array(2)` local) compiled cleanly on BOTH v1 and v12, and then
   silently returned a raw internal heap-descriptor artifact instead of the real data when `s.a`
   was read back (confirmed via real execution on v1 — anvil + deployed `Sauce.sol` — AND v12 —
   the real Huff runtime via a local `engine-v12/test/V12-execparity` checkout — both returning
   the identical wrong word, not `[111,222]` or any recognizable ABI encoding; the sibling scalar
   field `s.b` read back correctly, isolating the fault to the dynamic FIELD specifically, so
   `s`'s own storage kind is inferred fine). Contrast, ALSO verified via real execution on both
   targets: a DIRECTLY-CONSTRUCTED dynamic value at the property position — a string/array
   literal, a `.concat()` call, a nested plain object literal — round-trips correctly, since each
   allocates its OWN fresh dynamic value at that exact point rather than re-embedding an EXISTING
   heap descriptor from elsewhere; only a plain READ of a pre-existing dynamic variable (or an
   alias of one) is broken. Fixed by `assertNoDynamicVariableObjectField` (collection.ts): rejects
   a property whose PROCESSED value's leading opcode is `READ_HEAP` (the exact, empirically-
   isolated broken shape) — a directly-constructed dynamic value at the property position is
   untouched, and a violation nested inside an object literal's own nested-struct field is still
   caught, since `processExpression` routes a nested `ObjectExpression` back through this same
   function regardless of depth. Applies to BOTH v1 and v12/svm (unlike `assertNoNestedArrayLiteral`
   just above, which is v12-only) — this is the first guard in this whole family confirmed broken
   on both engines by direct execution rather than reasoned about from the postfix-descriptor
   design. Regression-locked in `test/struct.test.ts` (the compile-time rejection matrix, including
   negative controls for every already-supported shape) and `integration-test/struct.test.ts` (real
   EVM execution proving the working alternative the error message itself points at).

**Second-round adversarial-audit fixes (this branch): three more defects found by an
independent review of the fixes above — none caught by that diff's own tests.**

1. **`return-kind.ts`'s `localBoundContracts` went stale on a REASSIGNMENT, not just on first
   declaration.** `walkStatement`'s `VariableDeclaration` case tracks a `let pool =
   Contract.at(addr);` declarator into the fixpoint pre-pass's own pass-local
   `localBoundContracts` map (see the "SIXTH-instance" fix above), but the sibling
   `ExpressionStatement`/`AssignmentExpression` case never updated that map when `pool` was
   later REASSIGNED to a DIFFERENT bound contract (`pool = Contract2.at(addr2);`) — the stale
   FIRST binding stayed there for the rest of the function, even though the REAL compile
   stage's own `ctx.boundContracts` updates correctly on this exact reassignment
   (`consumePendingContractBinding` fires for every store whose RHS was a standalone binding
   call, real or pre-pass). Two confirmed failure modes, both reachable and both fixed:  a
   false-positive **compile CRASH** — `resolveMethodTarget` still consulted the stale contract
   for a method that exists only on the NEW one, throwing `Unknown method "..." on contract
   "..."` and aborting the compile of a program the real, `ctx.boundContracts`-backed compile
   stage accepts just fine (confirmed: `compile()` throws before the fix, doesn't after,
   `test/return-kind.test.ts`'s "does NOT throw" case); and a **silent under-classification** —
   when the two contracts share a method NAME but differ in output shape, the stale entry's
   output shape (e.g. scalar) masks the new binding's REAL one (e.g. dynamic), so `helper`'s
   registered return kind is wrong and a caller storing the result drops the descriptor via
   WRITE_VALUE instead of WRITE_HEAP — confirmed via real EVM execution
   (`integration-test/dynamic-kind-sweep.test.ts`'s "a reassigned variable-bound contract"
   describe block): `SauceInvalidOperationArgs(0x97)` on the caller's indexed read before the
   fix, `2211n` (the real, dynamic-branch value) after. Fixed by making the
   `AssignmentExpression` case mirror the `VariableDeclaration` case's own tracking exactly:
   `matchStandaloneBindingShape` on the RHS resolves a NEW binding into `localBoundContracts`,
   and anything else (a plain value, an aliasing read, an unresolvable name) `delete`s the
   stale entry instead of leaving it around — costs at most a missed optimization (falling back
   to the generic `inferKind` guess), never a wrong classification, the same "when unsure, don't
   guess against stale state" rule this whole file already applies elsewhere. (A THIRD shape —
   reassigning to something that ISN'T a resolvable contract binding at all, then still calling
   `.method()` on it — was investigated but turns out not to be independently observable in a
   unit test: the REAL compile stage's own `ctx.boundContracts` has the identical, separate,
   pre-existing staleness characteristic for a non-rebinding reassignment, so the pre-pass's own
   choice to delete vs. leave-stale doesn't change `compile()`'s overall outcome for that
   specific probe, verified empirically while writing the test. The deletion is still correct
   and still implemented — it just doesn't have its own clean red/green unit test the way the
   two confirmed failure modes do.)

2. **`processTernaryStore`'s `branchKind` had no notion of a direct dynamic-ABI-output contract
   call.** The SEVENTH-instance fix above taught `processTernaryStore` to promote a ternary's
   storage to `dynamic` when either branch's `inferKindWithContext` resolves dynamic — but
   `inferKindWithContext` alone has NO notion of a direct external contract call
   (`Contract.at(addr).method()`) with a single dynamic ABI output; only `singleDynamicAbiOutputKind`
   (a few lines above, in the SAME file) closes that gap, and the plain (non-ternary) store path
   already tries it first (`singleDynamicAbiOutputKind(expr, ctx) ?? inferKindWithContext(expr,
   ctx)`) — `processTernaryStore`'s `branchKind` computation never consulted it, only
   `inferKindWithContext` directly. So `let x = cond ? List.at(addr).list() : 0n;` (`list()`
   returning a single `uint256[]`) was always classified `'scalar'`, even though the IDENTICAL call
   shape outside a ternary already correctly infers `'dynamic'`. Confirmed via real EVM execution
   (`integration-test/dynamic-kind-sweep.test.ts`'s "ternary branchKind" case, reusing the existing
   `List2` single-dynamic-output mock): `SauceInvalidOperationArgs(0x97)` on the caller's indexed
   read whenever the dynamic branch was taken, before the fix; `2211n` after. Fixed by computing
   `consequentKind`/`alternateKind` the SAME way the plain store path does —
   `singleDynamicAbiOutputKind(branch, ctx) ?? inferKindWithContext(branch, ctx)` — for each branch
   independently, then promoting `branchKind` to `'dynamic'` if either resolves dynamic, exactly as
   before. Regression-locked in `test/destructuring.test.ts`'s "ternary branchKind" describe block
   (compile-time bytecode-shape proof for both the consequent- and alternate-branch positions, plus
   a both-scalar negative control) and the integration test above (real-EVM value proof).

3. **`assertNoDynamicVariableObjectField` (the NINTH-instance fix just above) false-positived on
   v12/svm for a SCALAR-producing postfix operator applied directly to an existing dynamic
   variable.** The guard's check (`processed[i]._bytes[0] === OPS.READ_HEAP`) is correct on v1's
   PREFIX encoding, where an outer operator's own opcode is always the LEADING byte — `arr.length`
   there emits `[LENGTH, READ_HEAP, slot]`, so `bytes[0] === LENGTH`, not `READ_HEAP`. But on
   v12/svm's POSTFIX encoding, `V12Saucer.unary()` (and `binary`/`ternary`/`nary`) APPEND their own
   opcode AFTER the operand's bytes (`concat(this._bytes, operand._bytes, [op])`), so `arr.length`
   (`V12Saucer.length` → `unary(OPS.LENGTH, arr, false)`) emits `[READ_HEAP, slot, LENGTH]` — the
   dynamic base's `READ_HEAP` is still the LEADING byte even though the overall expression
   (`isDynamic: false`) is a genuine scalar. This made `{ x: arr.length, y: 5n }` throw on
   `target: 'v12'`/`'svm'` even though the identical shape compiles (and is intended to be treated
   as a safe, directly-computed scalar, per the existing v1 tests) on v1 — confirmed reachable via
   both `keccak256(arr)` (same `unary()` path, `V12Saucer.keccak256`) and `.length`, though only
   `.length` is exercised in the regression tests below. Fixed by ALSO requiring
   `_bytes.length === 2`: a bare `READ_HEAP` read is always EXACTLY 2 bytes on EITHER encoding
   direction — `[READ_HEAP, slot]`, since a slot index is always a single byte (`context.ts`'s own
   "slot indices are 1 byte" invariant) — so this narrows the check to "the whole processed
   expression IS just a bare variable read" without reopening the real bug: a genuine bare
   dynamic-variable read (or an ALIAS of one) is still exactly 2 bytes and is still correctly
   rejected on every target, confirmed by re-running the EXISTING "rejects ... on v12 too" test
   alongside new ones for svm and for an aliased local. On v1 this is a no-op change (a bare read
   was ALREADY exactly 2 bytes there too, so `length === 2` never excludes anything v1 used to
   reject). Verified via real execution on BOTH v12 (a transpiler vector run against the real Huff
   runtime, `integration-test/v12-execution.test.ts`'s `object_field_length_of_dynamic_var` —
   before the fix this vector doesn't even COMPILE, crashing `buildVectors()` outright; after, it
   executes and returns the correct length, `3`) and svm (`integration-test/svm-execution.test.ts`,
   offline via the vendored `engine.so` — same before/after contrast). Regression-locked in
   `test/struct.test.ts`'s "object literal field applying a SCALAR-producing postfix op" describe
   block: the false positive fixed on v12/svm, a v1 negative control proving no behavior change
   there, and the real bug (a bare read, and a bare-read-of-an-alias) still rejected on v1, v12,
   AND svm.

**`sdk/`** — a data registry, no runtime logic. `src/protocols/<slug>/` per protocol (`info`,
`addresses`, `abis` as-const, `functions` SauceScript templates); `src/protocols/index.ts` is the
query registry. `src/skills/*.md` are AI-ready per-protocol docs (loaded by `loader.ts`, shipped in
the package). `src/chains/`, `src/recipes/`, `src/core/types.ts`. **SDK tests compile every protocol's
`sauceFunctions` through the real compiler — build the compiler first or they fail.**

`src/std/` is the SauceScript **standard library** — source shipped for the compiler to consume, not
TypeScript. `src/std/token/` is `@sauce/token` (an ERC20/SPL token interface behind one import), a
**byte-identical copy** of the sauce repo's conformance fixture
(`compiler/crates/sauce-cli/tests/fixtures/node_modules/@sauce/token/`), kept identical on purpose so
drift between the two repos shows up as a diff rather than as silently divergent behavior — **do not
edit it here; change it in sauce and re-copy.** Nothing here enforces that: since the `sauce` git dep
went away there is no fixture on disk to compare against, so the check is manual —
`diff -r sdk/src/std/token <sauce>/compiler/crates/sauce-cli/tests/fixtures/node_modules/@sauce/token`
against a local checkout. What CI *does* pin is the SPL Token program id the SVM arm guards on:
`test/std/token/compile.test.ts` derives it from the canonical base58 address and counts it in the
emitted bytecode, so a wrong digit or a deleted `require` fails there. It has two per-target arms (`token.evm.js`, `token.svm.js`) and
**deliberately no neutral `token.js`**: a token program is inherently target-specific, and a neutral
file would turn a missing arm into a confusing missing-EXPORT error instead of a clear failure to
import the package (`package.json`'s `main` names the neutral BASE the compiler suffixes per target).
The per-arm signatures genuinely differ where the account models force it — SVM `totalSupply`/
`decimals` take the mint as an `Account` while the EVM takes an `Address`, and the SVM writes take
5 args to the EVM's 3–4. Verified in `sdk/test/std/token/`: `compile.test.ts` (both targets, all seven
methods, the SVM account manifest, and the no-neutral-arm packaging invariant — always runs, no engine
needed) plus `svm.e2e.test.ts`/`evm.e2e.test.ts`, which EXECUTE the compiled bytecode against real SPL
accounts and a real deployed ERC20 — see `SAUCE_RUST_ENGINE_SO`/`SAUCE_RUST_V12_RUNTIME` above for why
those two are gated. `src/std/` is **not** in the package `files` list yet, so it does not ship to
consumers — this is validation-only for now.

**`actions/`** — `actionsToSauce(actions)` lowers routing intents (`uniswapV3ExactInput`, bridges,
wraps, stakes) to bytecode. Actions **chain**: output feeds the next implicitly (no `amountIn`) or via
`saveOutputAs`/`amountRef`. See `actions/AMM_SWAP_INTERFACES.md`.

**`dev-tools/`** — harness: `start:local`/`start:fork` boot a hardhat net + deploy the engine;
`npm run sauce <file.js> [args]` compiles+runs a SauceScript; `npm run recipe …` runs recipes.

## The swap Router (`../sauce/engine/src/Router.sol`)

Lives in the **private engine repo**, not here, but recipes target it (its `Router`/`SauceRouter`
artifacts are what `cook()` runs against). `SauceRouter` is a thin delegatecall proxy → `Router`
(`~1218` lines). Recipes import the minimal `ISauceRouter` ABI from `dev-tools/artifacts/`.

**Entry points** (all the `swap*` ones are `onlySelf` — callable only via `cook()` from the same
contract, so a recipe calls them as `ISauceRouter.at(address.self).swapX(...)`):
- `swap(SwapParams)` — unified swap; dispatches on `params.poolType` to `_swapV2/_swapV3/_swapV4/
  _swapCurve/_swapBalancerV2/_swapDODOV2/_swapTraderJoeLB/_swapMaverickV2/_swapWOOFi`.
  `SwapParams` embeds a `PoolKey` struct (`currency0,currency1,fee,tickSpacing,hooks`) used **only by
  V4** (ignored for V2/V3). Calling this from SauceScript **now works**: the compiler orders
  object-literal struct fields by the ABI's declared component order at the call boundary (recursively
  for nested tuples) — see `compiler/src/processor/expression.ts` `processAbiArg`/`orderedStructTuple`,
  unit-pinned by `compiler/test/struct-arg-order.test.ts`. (Previously it sorted fields alphabetically,
  scrambling the nested `PoolKey` → empty revert.) The flat methods below remain valid alternatives.
- `swapV3(pool, tokenIn, tokenOut, amountSpecified, sqrtPriceLimitX96, payer, recipient)` and
  `swapV4(...)` — **flat** legacy methods (no nested struct), verified working from SauceScript.
- `quote(QuoteParams)` — off-chain simulation; performs the swap and reverts with `QuoteRevert(amountIn,
  amountOut, sqrtPriceAfter, gas)` (caught by `shared/quoting.ts`). Never lands a swap.

**`amountSpecified` sign is inconsistent by path** (this bit us): the flat `swapV3` passes through to
Uniswap, where **positive = exact input** (verified on fork). The unified `swap()`/V4 path and the
`SwapParams`/`QuoteParams` doc say **negative = exact input** (Uniswap-V4/quote convention). For
recipes using flat `swapV3`, pass a **positive** amount.

**`SwapPoolType` enum** (must match recipe constants): `UniV2=0, UniV3=1, UniV4=2, Curve=3,
BalancerV2=4, DODOV2=5, TraderJoeLB=6, MaverickV2=7, WOOFi=8`.

**Callbacks vs callback-free** — the key architectural split for "where does swap logic live":
- **V2/Solidly/Curve/DODO** are *callback-free*: `_swapV2` reads reserves, computes out (V2 fee
  hardcoded 0.3% via `_getAmountOut`'s `*997/1000`), transfers tokenIn to the pool, calls
  `pair.swap(...)`. A recipe can replicate this **entirely in SauceScript** (transfer + `pool.swap`),
  bypassing the router — so new callback-free sources need only new SauceScript, no engine change.
- **V3/V4 (and Maverick)** use *callbacks*: the pool re-enters the contract mid-swap
  (`uniswapV3SwapCallback`/`pancakeV3SwapCallback`/`unlockCallback`/`maverickV2SwapCallback`) to pull
  input, reading transient-storage context set by `_swapV3`. A reentrant call during `cook()` hits the
  contract's Solidity dispatcher, **not** the paused bytecode interpreter — so callbacks can only be
  serviced by the router's compiled code. These swaps **must** go through the router (`swapV3`/`swapV4`).

## Publishing

Tag-driven (`.github/workflows/publish.yml`): `git tag v1.2.3 && git push origin v1.2.3` (or manual
`workflow_dispatch`). Builds all areas, runs `prepack` (syncs artifacts), stamps the **root**
`package.json` version, and publishes the single `@eco-incorp/sauce-sdk` to **both** npmjs.com
(`NPM_TOKEN`) and GitHub Packages (`GITHUB_TOKEN`). Only the root version is published; workspace
packages stay `private`.

**The root `publishConfig.registry` pin (npmjs.com) is kept as a defensive, explicit anchor.** It used to be load-bearing: a committed root `.npmrc` mapped the whole `@eco-incorp` scope to `https://npm.pkg.github.com` (to fetch the `@eco-incorp/sauce-compiler-wasm` devDependency), and a scope registry governs PUBLISHING as well as resolution — so without the pin this repo's own `@eco-incorp/sauce-sdk` could have published to GitHub Packages instead of npmjs.com. That `.npmrc` is now GONE, and the wasm compiler is a public npmjs package (`@eco-incorp/sauce-compiler`, aliased `sauce-next`) resolved from the default registry — so the pin is no longer strictly required, but it is kept as an explicit npmjs.com anchor. If a scoped `@eco-incorp` registry mapping is ever reintroduced, this pin becomes load-bearing again.
