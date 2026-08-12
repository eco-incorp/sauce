# SauceScript compiler — complete feature inventory (TS implementation)

**Purpose.** A per-feature catalog of everything `sauce-sdk/compiler` (the TypeScript SauceScript
compiler) does, written so a Rust engineer can reimplement each feature independently. Every entry
cites the real source path(s) in `compiler/src/**`.

**De-scoped, explicitly.** This is a feature inventory of the TS compiler. It is **not** a
per-feature gap analysis against `compiler-rs` (that is a separate pass) — nothing outside
`sauce-sdk/compiler`, `sauce-sdk/CLAUDE.md`, and `compiler/README.md` was read. But see **Porting
scope** below for the two target-model assumptions the port makes (v1 dropped; partial eval
generalized to JS).

## What the compiler is

`compile(source, options) → CompileResult` turns **SauceScript** — a uint256-only JavaScript subset
(no closures, classes, `async`, `var`, `==`) — into Sauce engine bytecode. The pipeline is
**acorn AST → processor walk → a `Saucer` builder that emits bytes as the walk proceeds**. There is
no separate IR: builder nodes (`{_bytes, …}`) *are* the intermediate representation, which is why
several analyses (capability gating, dynamic-field guards) inspect emitted bytes rather than a typed
tree.

Three **targets**, all from one processor:

| Target | Engine | Encoding | Variables | Notes |
| --- | --- | --- | --- | --- |
| `v1` (default) | Solidity tree interpreter (`Sauce.sol`) | **prefix** `[OP][a][b]` | all in memory slots | dynamic values carry an out-of-band `ctx.dynamicResult` |
| `v12` | Huff runtime (`engine-v12`) | **postfix** `[a][b][OP]` | locals in slots, **params on the EVM stack** | dynamic value = one in-band 32-byte descriptor word |
| `svm` | Solana engine (`engine.so`) | postfix — a **v12 dialect** | same as v12 | divergent CALL/SLOAD/SSTORE shapes, account plan, packet budget, `staged` mode |

Two front doors into the parser: plain acorn (`.js`/`.sauce`), or the **TypeScript front-end**
(`tsSource: true`, or any `.ts`/`.sauce.ts` import) which runs six constant-folding transformer
stages *before* acorn ever sees the text.

## Porting scope (compiler-rs)

Two target-model assumptions the port makes. Everything else in this doc describes the *current* TS
compiler faithfully — read these two first so you can map it onto `compiler-rs`:

- **v1 is NOT a port target.** v1 is deprecated and **deleted in sauce `main`**, so `compiler-rs`
  targets **`v12` + `svm` only**. Throughout this doc, wherever a feature's **TARGETS** is `all` or
  `v1/v12`, only the **v12/svm** behavior is a porting concern. Features and guards that are
  **v1-specific are legacy context, not things to port** — notably: v1's out-of-band
  `ctx.dynamicResult` dynamic-value model (v12/svm use one in-band 32-byte descriptor word instead);
  the v1 `funcHeap`/`funcValues` two-index calling convention and the **K15** call-argument gap that
  rides on it; the **K8/K9** v1 scalar→dynamic reassignment *rejections* (v12/svm derive kind from
  the value node, so they never need them); v1 helper-declaration-order; and the v1 function-table
  index layout that `treeshake: false` exists to preserve. Skip these.
- **Partial evaluation is IN scope and must cover JS, not just TS.** In the current compiler the
  entire **partial-eval / fold family (Category TS, 16 features)** is reachable *only* via the
  TypeScript front-end — **but that is a reuse artifact, not a design boundary.** Those passes were
  built on the `typescript` library + `ts-evaluator` because they were already on hand (the TS
  entries below repeatedly note working *around* `ts-evaluator@2.0.0`'s inability to evaluate
  bigint). `compiler-rs`'s objective is to compile **JS and TS**, so partial evaluation should be
  reimplemented **language-agnostically** and run on the **JS path too**. Treat Category TS as *the
  partial-evaluation specification* — const folding, branch/ternary folding, constant propagation +
  dead-declaration elimination, effectively-const detection, same-file call folding, lookup-table
  folding, `for...of`/loop unrolling, local `new Array` folding, per-function const propagation — to
  be implemented once, for both source languages, not gated behind a TS surface.

## How to read this doc

Features are grouped into 12 categories and given a stable ID (`A1`, `TS7`, `G12`, …) used by the
summary table. Each entry carries:

- **WHAT** — one line.
- **EXAMPLE** — a tiny SauceScript snippet, where it clarifies.
- **EDGE / BAIL** — fail-closed behavior. *Almost every* analysis in this compiler fails closed:
  an unresolvable fold leaves the node untouched, an unprovable safety property declines the
  optimization. Where a feature instead **rejects at compile time**, that is called out — it is
  always because the alternative is a *silent* runtime miscompile.
- **SOURCE** — file(s), with function names (prefer names over line numbers; lines drift).
- **TARGETS** — v1 / v12 / svm support.
- **PORTING** — priority (P0 highest … P3) plus the invariant a reimplementation must preserve.

Priority legend: **P0** = correctness-critical or foundational (something else depends on it);
**P1** = real user-facing capability; **P2** = narrow/ergonomic; **P3** = optional, or only
meaningful if a matching engine constraint exists.

## Summary table (porting checklist)

| ID | Feature | Category | Targets | Prio |
| --- | --- | --- | --- | --- |
| A1 | `compile()` entry + `CompileResult` | API | all | P0 |
| A2 | `CompileOptions` surface | API | all | P0 |
| A3 | Target dispatch + `staged` gate | API | all | P0 |
| A4 | Fixed pipeline stage order | API | all | P0 |
| A5 | v1 `main()` args (appended CALL_FUNCTION segment) | API | v1 | P1 |
| A6 | v12 arg-prologue (inlined-main fall-through) | API | v12/svm | P1 |
| A7 | Staged svm args over CALLDATA (`ArgsLayout`) | API | svm | P2 |
| A8 | Arg value encoding (scalar/bytes/array/struct) | API | all | P1 |
| A9 | svm `accountPlan` + budget warnings in result | API | svm | P2 |
| L1 | uint256-only type model + literals | Language | all | P0 |
| L2 | Operator set (incl. strict-equality-only) | Language | all | P0 |
| L3 | Control flow + the unsupported-statement list | Language | all | P0 |
| L4 | Functions, `main()`, recursion, decl order | Language | all | P0 |
| L5 | Arrays: literal vs `new Array(n)`, index/length/concat/slice | Language | all | P0 |
| L6 | Objects / structs | Language | all | P1 |
| L7 | bytes / string / Uint8Array | Language | all | P1 |
| L8 | `storage.read/write` + `tRead/tWrite` | Language | all* | P1 |
| L9 | `crypto.keccak256` / `ecdsaVerify` | Language | all | P1 |
| L10 | `abi.encode` / `abi.decode` + type specs | Language | all | P1 |
| L11 | `msg.*` / `tx.*` / `block.*` / `address.*` / `gasLeft` | Language | all | P1 |
| L12 | CREATE family + address prediction | Language | v1/v12 | P2 |
| L13 | `contract.call/static/delegate` (raw) | Language | all* | P1 |
| L14 | `emit()` events | Language | all | P2 |
| L15 | `eval()` compile-time nested compilation | Language | all | P2 |
| L16 | svm intrinsics: `uint`, `accountData`, refs | Language | svm(+v12 `uint`) | P1 |
| L17 | Reserved names, `var` rejection, top-level shape | Language | all | P1 |
| L18 | `` $`...` `` tagged-template bytecode construction (quasiquote) | Language | all | P2 |
| D1 | `evalConst` / `evalConstBool` | Defines | all | P0 |
| D2 | `literalToBigint` `.raw` precision fix | Defines | all | P0 |
| D3 | Top-level `const` registration + read substitution | Defines | all | P0 |
| D4 | `CompileOptions.defines` | Defines | all | P1 |
| D5 | `if`/`else if` constant folding | Defines | all | P0 |
| D6 | Ternary constant folding | Defines | all | P1 |
| T1 | `treeshake` (drop unreachable functions) | Deadcode | all | P0 |
| T2 | `collectCalls` fold-aware reachability | Deadcode | all | P0 |
| TS1 | `tsPartialEval` / `WithMeta` + both wiring seams | Frontend | all | P1 |
| TS2 | `tsEvalConst` / Unary / Binary (bigint evaluator) | Frontend | all | P0 |
| TS3 | Numeric-literal precision (`getText()`) | Frontend | all | P0 |
| TS4 | `tsEvalCall` same-file call folding | Frontend | all | P2 |
| TS5 | `foldExpression` + ts-evaluator fallback + guards | Frontend | all | P1 |
| TS6 | Shadow-safety discipline (cross-cutting) | Frontend | all | P0 |
| TS7 | If-branch flattening + splice-collision guard | Frontend | all | P1 |
| TS8 | Module-scope ternary folding | Frontend | all | P1 |
| TS9 | Constant propagation to reads | Frontend | all | P1 |
| TS10 | Dead-declaration elimination | Frontend | all | P2 |
| TS11 | Effectively-const `let`/`var` (PRIMARY + STRETCH) | Frontend | all | P2 |
| TS12 | Array/object lookup-table folding | Frontend | all | P1 |
| TS13 | Local `new Array(n)` construction folding | Frontend | all | P2 |
| TS14 | `return arr;` escape fold + forced BYTE_32 channel | Frontend | all | P2 |
| TS15 | Local per-function constant propagation | Frontend | all | P1 |
| TS16 | Ternary folding in the local pass (+compound RHS) | Frontend | all | P1 |
| U1 | Numeric `for` unrolling | Unroll | all | P1 |
| U2 | `while`-counting-idiom unrolling | Unroll | all | P2 |
| U3 | `for...of` over a tracked array table | Unroll | all | P1 |
| U4 | Statement-list splice drivers + 256 cap | Unroll | all | P0 |
| I1 | Inline (arrow-const) declaration + extraction | Inline | all | P1 |
| I2 | Inline validation / bail conditions | Inline | all | P0 |
| I3 | Splicing: hygiene, hoisting, return-elimination | Inline | all | P1 |
| I4 | Inline recursion / cycle detection | Inline | all | P0 |
| I5 | Dynamic-return placeholder seeding | Inline | v1 | P2 |
| I6 | Known gap: unreachable inline validated eagerly | Inline | all | P3 |
| M1 | Source-file function imports (recursive collection) | Imports | all | P0 |
| M2 | Per-target arm selection (`.v12.js`/`.svm.js`) | Imports | all | P1 |
| M3 | Bare-specifier / node_modules resolution | Imports | all | P2 |
| M4 | Escape-root guard | Imports | all | P1 |
| C1 | ABI JSON contract imports | Contracts | v1/v12 | P0 |
| C2 | `.at()/.view()/.lib()` binding + call lowering | Contracts | v1/v12 | P0 |
| C3 | Struct-arg reordering + static-tuple flattening | Contracts | v1/v12 | P0 |
| C4 | `.catch(handler)` chaining | Contracts | all | P1 |
| C5 | `CompileOptions.contracts` | Contracts | v1/v12 | P2 |
| C6 | Bidirectional capability gate | Contracts | all | P0 |
| C7 | `SVM_UNSUPPORTED` + svm profile | Contracts | svm | P1 |
| K1 | The scalar-vs-dynamic storage-kind model | Kinds | all | P0 |
| K2 | `inferKind` (ctx-free baseline) | Kinds | all | P0 |
| K3 | `inferKindWithContext` | Kinds | all | P0 |
| K4 | `analyzeFunctionReturnKinds` fixpoint | Kinds | v1 (fatal) | P0 |
| K5 | Fixpoint `localBoundContracts` tracking | Kinds | v1 | P1 |
| K6 | `applyDestructuringKinds` | Kinds | v1 | P1 |
| K7 | `singleDynamicAbiOutputKind` | Kinds | v1 | P1 |
| K8 | v1 scalar→dynamic reassignment rejection | Kinds | v1 | P1 |
| K9 | `multiOutputCall` tagging | Kinds | v1 | P2 |
| K10 | Multi-output-call destructuring lowering | Kinds | all (v12 fast path) | P0 |
| K11 | Ternary storage-kind promotion | Kinds | v1 | P1 |
| K12 | Nested-array-literal rejection | Kinds | v12/svm | P2 |
| K13 | Dynamic-variable object-field rejection | Kinds | all | P1 |
| K14 | Immutable packed-array write rejection | Kinds | all | P1 |
| K15 | Known open gaps (call-arg, silent `.length`) | Kinds | v1 | P1 |
| G1 | `SaucerLike` abstraction + `newSaucer()` | Codegen | all | P0 |
| G2 | `OPS` opcode table | Codegen | all | P0 |
| G3 | `OPS_V12` stack opcodes | Codegen | v12/svm | P0 |
| G4 | Integer auto-narrowing (`encodeInt`, BYTE_OPS) | Codegen | all | P0 |
| G5 | bytes/string encoding | Codegen | all | P0 |
| G6 | Array encoding + `forcedWidth` + packed-immutability | Codegen | all | P0 |
| G7 | Tuple encoding | Codegen | all | P1 |
| G8 | v1 memory model + ALLOCATE prefix + 255-slot cap | Codegen | v1 | P0 |
| G9 | Slot allocation, scope free-list reuse, `freshTemp` | Codegen | all | P0 |
| G10 | v1 prefix builder: control flow, calls, catch, return | Codegen | v1 | P0 |
| G11 | V12Saucer postfix core (order, swaps, composition) | Codegen | v12/svm | P0 |
| G12 | v12 parameter frame (SDUP read / SSWAP write) | Codegen | v12/svm | P0 |
| G13 | v12 sentinel patching + blob assembly layout | Codegen | v12/svm | P0 |
| G14 | v12 ALLOCATE frame-stride prefix | Codegen | v12/svm | P0 |
| G15 | `return()` / FUNC_RETURN semantics | Codegen | v12/svm | P0 |
| G16 | `dropIfUnused` | Codegen | v12/svm | P0 |
| G17 | v12 heap-array ops + `binaryRaw`/`ternaryRaw` | Codegen | v12/svm | P1 |
| G18 | svm divergent call/storage lowering | Codegen | svm | P1 |
| G19 | svm empty-stack `build()` + staged `msg.data` reject | Codegen | svm | P1 |
| G20 | v12 if/loop encoding + wide-jump upgrades | Codegen | v12/svm | P0 |
| G21 | v12 `break`/`continue` unsupported (gap) | Codegen | v12/svm | P1 |
| G22 | svm `AccountRegistry` | Codegen | svm | P1 |
| G23 | Packet budget estimator + `stagingTransactionCount` | Codegen | svm | P2 |
| G24 | Dynamic-value descriptor model (v1 vs v12/svm) | Codegen | all | P0 |
| X1 | Compile cache + `compileCacheKey` | Cache | all | P2 |
| X2 | `cloneCompileResult` defensive copy | Cache | all | P2 |
| X3 | Bounded LRU store + stats + clear | Cache | all | P3 |

\* `storage.*` and `contract.call/static` exist on all three targets but with **different
semantics/shapes** on svm — see C6/G18.

---

# Category A — `compile()` API, targets, pipeline

### A1. `compile()` entry + `CompileResult`

**WHAT.** `compile(source, options) → { bytecode: Uint8Array[], warnings: string[],
accountPlan?, argsLayout? }`. `compile()` itself only handles caching (X1) and delegates to
`compileFresh`, which parses (acorn, `ecmaVersion: 'latest'`, `sourceType: 'module'`,
`allowReturnOutsideFunction: true`), builds a `CompilerContext`, runs `processNode`, then assembles
per target.

**EDGE / BAIL.** `bytecode` is an ARRAY because v1 emits one blob per top-level function plus an
optional trailing arg-call segment; v12/svm always produce exactly one element (a single assembled
blob). `warnings` on svm additionally carries the packet-budget warnings (A9) — budget overflow is
**non-fatal**.

**SOURCE.** `compiler/src/index.ts` (`compile`, `compileFresh`, `CompileResult`).

**TARGETS.** all.

**PORTING (P0).** Preserve the array-of-blobs return shape for v1 (downstream SDK/dev-tools feed
each blob separately) and the "budget problems are warnings, not errors" rule.

### A2. `CompileOptions` surface

**WHAT.** Every knob, with its default:

| Option | Default | Effect |
| --- | --- | --- |
| `label` | — | filename for TS front-end diagnostics; has no default of its own — when `tsSource` is set it falls back to `'source.ts'` (`label ?? 'source.ts'`, index.ts:307); unused when `tsSource` is false |
| `baseDirs` | `[]` | roots imports may resolve inside (M1–M4) |
| `contracts` | — | pre-register ABIs without an import (C5) |
| `args` | — | compile-time `main()` args (A5–A8) |
| `target` | `'v1'` | `'v1' \| 'v12' \| 'svm'` |
| `staged` | `false` | svm-only staged buffer mode (A7) |
| `transformModule` | — | override the import-time text transform (M1) |
| `tsSource` | `false` | treat top-level source as TypeScript (TS1) |
| `treeshake` | `true` | drop functions unreachable from `main()` (T1) |
| `fold` | `true` | fold constant `if`/ternary conditions (D5/D6) |
| `defines` | — | compile-time constants; booleans → `1n`/`0n` (D4) |
| `cache` | `true` | process-global cache, `false` to bypass, or an instance (X1) |
| `cacheKeyExtra` | — | fingerprint for inputs the key cannot see (X1) |

**SOURCE.** `compiler/src/index.ts` (`CompileOptions`).

**PORTING (P0).** Defaults are load-bearing twice over: they define the compiler's behavior *and*
they are duplicated inside `compileCacheKey` (X1) — a Rust port must derive both from one place or
keep them provably in sync.

### A3. Target dispatch + `staged` gate

**WHAT.** `target` selects the builder class (`Saucer` vs `V12Saucer`) via
`ctx.newSaucer()`, and the assembly path. `ctx.isV12` is true for **both** `v12` and `svm`
(`svm` is a v12 dialect); `ctx.isSvm` distinguishes them.

**EDGE / BAIL.** `staged: true` with any target other than `'svm'` throws immediately
(`staged compilation requires target 'svm'`).

**SOURCE.** `compiler/src/index.ts` (`compileFresh`), `compiler/src/context.ts`
(`isV12`, `isSvm`, `setStaged`, `newSaucer`).

**PORTING (P0).** The `isV12 = v12 || svm` conflation is deliberate and pervasive — dozens of sites
mean "postfix dialect" when they say `isV12`. Reproduce it as an explicit dialect predicate rather
than an equality test on the target enum.

### A4. Fixed pipeline stage order

**WHAT.** `processProgram` runs stages in an order where each step's correctness depends on its
neighbours:

1. `collectImportedFunctions` (+ inline declaration extraction) — M1, I1
2. `registerTopLevelConsts` — D3
3. top-level statement shape validation — L17
4. build inline map → expand inline calls — I3
5. `treeshake` — T1 (**after** inlining, so a function reachable only through a spliced inline body
   still counts; **before** the return-kind fixpoint, so an unreachable function's shape can't
   influence it)
6. `analyzeFunctionReturnKinds` — K4 (before any body is compiled, and before the target fork, so
   all targets see identical results)
7. v1 / v12 dispatch → per-function compilation

**SOURCE.** `compiler/src/processor/index.ts` (`processProgram`, `processProgramV12`).

**PORTING (P0).** Port the order as a first-class contract, not an implementation accident. Each
adjacency has a documented failure mode if swapped.

### A5. v1 `main()` args — appended CALL_FUNCTION segment

**WHAT.** With `options.args`, v1 appends one extra blob:
`[CALL_FUNCTION][mainIndex][argCount][…encoded args]`. Arg *types* are inferred
(`inferArgType`) into `ctx.mainArgTypes`, so `main`'s parameters get real kinds
(`scalar`/`dynamic`, plus `elementType`/`structType`) — unlike a helper's parameters, which are
always tagged scalar (K15).

**SOURCE.** `compiler/src/index.ts` (`compileFresh`, `inferArgType`, `encodeArgValue`).

**TARGETS.** v1.

**PORTING (P1).** `main`'s args are the only place per-parameter kind inference exists at all.

### A6. v12 arg-prologue (inlined-main fall-through)

**WHAT.** The v12 runtime jumps to offset 0 with only a stack-bottom sentinel — it does **not**
marshal `main`'s params. With args, the assembler synthesizes a no-param ENTRY that pushes each arg
(forward order, so `arg0` is deepest) and then **inlines main's body immediately after** so
execution falls through with the args already on the stack.

**EDGE / BAIL.** Deliberately *not* a `CALL_FUNCTION` wrapper: a call frame adds a frame-pointer
word above the params, pushing a `main` reading its first param under ~7 live locals to `SDUP17` —
past the EVM `DUP16` ceiling. Consequence: **`main` can never be recursive on v12** (it is inlined,
not a table entry); `patchCalls` raises `calling main() is not supported` if a `CALL_FUNCTION`
targets it. v1 likewise cannot call `main`.

**SOURCE.** `compiler/src/index.ts` (`assembleV12`, `assembleV12WithArgs`, `patchCalls`).

**TARGETS.** v12, svm.

**PORTING (P1).** Preserve the ceiling reasoning: the arg-passing strategy is chosen by *stack-depth
budget*, not elegance. Any port that switches to a call frame must re-derive the SDUP16 headroom.

### A7. Staged svm args over CALLDATA (`ArgsLayout`)

**WHAT.** With `target: 'svm', staged: true`, args are **not** baked into the blob (restaging 16 KB
to change one amount is the failure this avoids). The prologue materializes the
`program ++ args` composite **once** via `CALLDATA`, parks the descriptor in VALUES slot 0, then
per arg emits `[READ_VALUE 0][BYTE_2 L+offset][len][SLICE]` (+`CAST_BE` for scalars). `ArgsLayout`
(`mode:'calldata'`, `programLength`, `byteLength`, `slots[]`) is returned as the SDK's encoding
contract.

**EDGE / BAIL.** Array and struct args are rejected in staged mode (ABI-encode into a bytes arg
instead). Scalars are fixed 32-byte big-endian words; bytes args take their compile-time length, no
padding. Prologue length is a *pure function of the layout* — which breaks the circularity that
offsets embed the total program length. `programLength + byteLength > 65_535` throws
(`MAX_COMPOSITE_BYTES`, the engine's `MAX_BUFFER_CAPACITY`). Net stack effect is +1 per arg —
identical to the inline literal pushes it replaces, so SDUP patching is untouched.

**SOURCE.** `compiler/src/index.ts` (`buildArgsLayout`, `stagedSlotReadLen`, `stagedPrologueLen`,
`buildStagedPrologue`, `ArgsLayout`).

**TARGETS.** svm only.

**PORTING (P2).** The fixed-width per-slot cost (hence a length independent of the offsets it
encodes) is the trick that makes this terminate in one pass. Keep it.

### A8. Arg value encoding

**WHAT.** `ArgValue = bigint | string | ArgValue[] | ArgObject`. bigint → `encodeInt`; hex string →
`encodeBytes`; array → `TUPLE` of encoded elements; plain object → `TUPLE` of its fields **sorted
alphabetically** (`localeCompare`), recursively. Two mirrored encoders exist: `encodeArgValue`
(v1 prefix bytes) and `encodeArgValueV12` (built through `V12Saucer` methods).

**EDGE / BAIL.** The alphabetical field order is not cosmetic — it must match
`extractStructType`/`processObjectExpression` so `main()` reads `param.field` with the same
`INDEX` lowering as an in-script object literal. `structTypeFromArg` reproduces the same order for
the *type* side.

**SOURCE.** `compiler/src/index.ts` (`encodeArgValue`, `encodeArgValueV12`, `structTypeFromArg`,
`sortedArgObjectKeys`, `hexToBytes`).

**PORTING (P1).** One rule, two encoders, and a third consumer (field-index lookup) — a port should
derive all three from a single canonical "sorted field list" helper.

### A9. svm `accountPlan` + budget warnings in the result

**WHAT.** For `target: 'svm'`, the result additionally carries `accountPlan`
(`ctx.buildAccountPlan()`, G22) and folds `estimatePacket(...)`'s warnings into `warnings`
(G23), budgeted as `'staged'` or `'inline'` per mode with `argsBytes` from the layout.

**SOURCE.** `compiler/src/index.ts` (`compileFresh`'s svm branch).

**PORTING (P2).** Budget checks are advisory by design — never fail a compile on them.

---

# Category L — language surface & intrinsics

*(The authoritative prose surface is `compiler/README.md`; every claim below was checked against
the dispatch tables in `globals.ts` / `processor/*`.)*

### L1. uint256-only type model + literals

**WHAT.** Every numeric value is an unsigned 256-bit integer (bigint). Literal kinds accepted:
`number`, `bigint`, `string`, `boolean` — anything else throws `not implemented: <typeof> literal`.
There is no `typeof`/`instanceof`, no float, no regex. `address` is a plain scalar (the `0x…n`
bigint idiom); `bool` is not a distinct wire type (comparisons yield 0/1 scalars).

**EDGE / BAIL.** A bare negative literal is a `UnaryExpression` in JS, and unary `-` is only
supported on a `Literal` operand (two's-complement folded at compile time) — `not implemented:
unary - on <type>` otherwise. Literals are converted from **raw source text** (`literal.raw`), never
via a parsed JS `number`, on both the runtime path (`processLiteral`/`literalToInt`) and the
constant path (D2) — see D2 for the precision bug this avoids.

**SOURCE.** `compiler/src/processor/expression.ts` (`processLiteral`, `literalToInt`),
`compiler/src/processor/const-eval.ts` (`literalToBigint`).

**PORTING (P0).** Parse literals into arbitrary-precision integers directly from source text.

### L2. Operator set

**WHAT.**

- Arithmetic `+ - * / % **` → `ADD SUB MUL DIV MOD EXP`; `Math.sqrt`→`SQRT`,
  `Math.mulDiv`→`MUL_DIV` (full-precision 512-bit), `Math.neg`→`NEG`.
- Bitwise `& | ^ ~ << >>` → `AND OR XOR NOT SHL SHR`.
- Comparison `> < >= <=` → unsigned `BOOL_GT/LT/GTE/LTE`.
- Equality: **`===`/`!==` only** → `BOOL_EQ`/`BOOL_NEQ`, with a cheaper `isZero`/`isNotZero`
  special case when one side is literal `0`.
- Logical `&& || !` → `BOOL_AND`/`BOOL_OR`/`BOOL_NOT` — **genuine boolean operators, not
  JS value-returning short-circuits**: both operands always evaluate and the result is 0/1.
- `++`/`--` on a **bare Identifier only**; compound assignment `+= -= *= /= %= &= |= ^= <<= >>=`
  on Identifier or MemberExpression.
- Ternary `?:` — valid **only** directly in declaration/assignment position.

**EDGE / BAIL.** `==`/`!=` and `>>>` are hard compile errors (`>>>` says "use >> instead").
`arr[i]++` → `not implemented: update on MemberExpression`. A ternary anywhere else →
`ternary must be used directly in an assignment` (which is why the front-end's ternary folds,
TS8/TS16, can *enable* otherwise-invalid programs). `BOOL_SGT/SLT/SGTE/SLTE` and `BOOL_XOR` exist
in the opcode table with **no** SauceScript surface (flagged, see "Unverified" at the end).

**SOURCE.** `compiler/src/processor/expression.ts` (`applyBinaryOp`, `processLogicalExpression`),
`compiler/src/globals.ts` (`Math.*`), `compiler/src/saucer/ops.ts`.

**PORTING (P0).** The non-short-circuit `&&`/`||` is the single easiest thing to get wrong in a
naive port (a tree-walking evaluator naturally short-circuits). Both operands must always be
emitted, and the value is a boolean, never the taken operand.

### L3. Control flow + the unsupported list

**WHAT.** Supported: `if`/`else if`/`else`, `while`, `for` (incl. `for(;;)`) with `break`/
`continue`, `throw` (revert), `return` (incl. early return).

**EDGE / BAIL.** **No case exists** in the statement switch for: `switch`, `try`/`catch` (the real
JS form — `.catch()` on a call chain is a different, supported mechanism, C4), `for...of`,
`for...in`, `do...while`, labeled statements. Each throws `not implemented: <NodeType>`. `for...of`
compiles **only** when the TS front-end unrolls it away (U3). Scoping subtlety that ripples through
half this document: **only `for` pushes a scope** — `processIfStatement`/`processWhileStatement`
never call `ctx.pushScope`, so a `let` first declared inside an `if` body is the *same persisting
variable* after the branch.

**SOURCE.** `compiler/src/processor/statement.ts` (`processIfStatement`, `processWhileStatement`,
`processForStatement`), `compiler/src/processor/index.ts` (statement dispatch).

**PORTING (P0).** The if/while-share-scope rule is a *language* fact that at least six separate
analyses in this compiler must agree on. Decide it once, expose it as one predicate.

### L4. Functions, `main()`, recursion, declaration order

**WHAT.** Top-level `function name(params) {}` only; `main()` is the mandatory entry point.
Parameters must be plain identifiers. Real recursion (self and mutual) is supported and bounded only
by gas. Helper→helper calls work, **including forward references**, on both targets (G/`processProgram`
registers every name before compiling any body). Arrow functions are permitted only as a `.catch()`
handler (C4) or as an inline-function declaration (I1). No classes, `async`, closures, or `var`.

**EDGE / BAIL.** `main` is never callable: v1 has no mechanism, v12 inlines it (A6), and an imported
module defining `main` is rejected outright (M1).

**SOURCE.** `compiler/src/processor/index.ts` (`processProgram`, `processProgramV12`,
`processFunction`, `processFunctionV12`).

**PORTING (P0).** Adopt "register all function names, then compile all bodies" for every target from
day one.

### L5. Arrays

**WHAT.** Two distinct things:

- **Array literal** `[1n, 2n, 3n]` — packed at the *minimum* byte width across elements (G4/G6),
  and **immutable**: the engine reverts `SET_INDEX` on a packed static array, so the compiler
  rejects element assignment at compile time (K14).
- **`new Array(n)`** — a heap TUPLE (`NEW_ARRAY` 0x9c), writable via `SET_INDEX` (0x9b), readable
  via `INDEX` (0x97). This is SauceScript's only heap/allocation construct.

Shared surface: `arr[i]`, `.length` (`LENGTH`), `.concat(other)` (`CONCAT`), `.slice(start,end)`
(`SLICE`, strict arity 2), `arr[i] = v` and compound `arr[i] += v` on mutable containers.

**EDGE / BAIL.** Nested array *literals* work on v1 but are rejected at compile time on v12/svm
(K12) with a pointer at the working `new Array(n)` construction. A `new Array(n)` local that is
fully constant and never escapes may be folded away entirely (TS13/TS14).

**SOURCE.** `compiler/src/processor/collection.ts`, `compiler/src/saucer/array.ts`,
`compiler/src/processor/expression.ts` (`NewExpression`).

**PORTING (P0).** The literal-vs-heap split, and *which* is mutable, is a core semantic — not an
optimization detail.

### L6. Objects / structs

**WHAT.** Object literals `{k: v}` (shorthand `{x}` supported), nested objects, arrays of structs,
field read `obj.a.b`, field mutation `obj.field = x` (object-literal bindings only). Encoded as a
`TUPLE` with fields **sorted alphabetically** (`localeCompare`), matching A8's arg encoding and
`abi.decode`'s struct type spec.

**EDGE / BAIL.** Two guards: an object-literal field that is a **bare read of an existing dynamic
variable** is rejected on all targets (K13); `saucer.tuple()` performs *no* static/dynamic
consistency check of its own (unlike array encoding), which is exactly why that guard exists.
Object-literal *property* reads/writes on a bare parameter are rejected — there is no object-shaped
local whose storage kind could be mis-inferred. Spread properties are rejected.

**SOURCE.** `compiler/src/processor/collection.ts` (`processObjectExpression`,
`extractStructType`), `compiler/src/saucer/tuple.ts`.

**PORTING (P1).** If a port's tuple encoding *does* box its fields, K13's guard may become
unnecessary — verify against the engine, don't copy blindly.

### L7. bytes / string / Uint8Array

**WHAT.** String literals lower to `BYTES`/`BYTES_2` dynamic values; `new Uint8Array([...])` and
`Uint8Array.from([...])` build bytes from byte literals; the array surface (`[i]`, `.length`,
`.concat`, `.slice`) applies uniformly to bytes and strings.

**EDGE / BAIL.** `extractByteLiteral` rejects a non-integer or out-of-range (`>255`) element.
`encodeBytes` throws above 65 535 bytes.

**SOURCE.** `compiler/src/globals.ts` (`Uint8Array` handling), `compiler/src/saucer/bytes.ts`.

**PORTING (P1).** Straightforward; the length-prefix width switch (1 vs 2 bytes) is the only
subtlety.

### L8. Persistent + transient storage

**WHAT.** `storage.read(slot)` → `SLOAD`, `storage.write(slot,v)` → `SSTORE`,
`storage.tRead(k)` → `TLOAD`, `storage.tWrite(k,v)` → `TSTORE`. Arities checked (1 / 2).

**EDGE / BAIL.** On **svm** the same opcodes mean something else entirely — `SLOAD`/`SSTORE` are
account-data read/write — so `storage.read`/`storage.write` are capability-gated off svm (C6),
while `tRead`/`tWrite` are **not** gated (fork-parity transient storage exists there).

**SOURCE.** `compiler/src/globals.ts` (`storage.*`), `compiler/src/capabilities.ts`.

**PORTING (P1).** Note the asymmetry: two of the four are gated, two are not.

### L9. Cryptography

**WHAT.** `crypto.keccak256(data)` → `KECCAK256`; `crypto.ecdsaVerify(signer, hash, sig)` →
`ECDSA_VERIFY` (arity 3). Not gated on any target.

**SOURCE.** `compiler/src/globals.ts` (`crypto.*`).

**PORTING (P1).** Trivial once the ops exist.

### L10. `abi.encode` / `abi.decode`

**WHAT.** `abi.encode(v)`, `abi.encode(a, b, …)` (wrapped in a `TUPLE`), or `abi.encode(objLiteral)`
→ `ABI_ENCODE`. `abi.decode(data, ...typeSpecs)` → `ABI_DECODE`, where a type spec is a bare string
from `ABI_TYPE_SPECS` (`uint8…uint256`, `bool`, `address`, `bytes`, `string`), an object (struct —
fields alphabetized), or a single-element array (`['uint256']`, exactly one element enforced).

**EDGE / BAIL.** Explicitly **not** capability-gated on svm — the codec is universal; only the
ABI-*typed-binding* surface (C2) is EVM-only.

**SOURCE.** `compiler/src/globals.ts` (`abi.*`, `resolveAbiTypeSpec`, `ABI_TYPE_SPECS`).

**PORTING (P1).** Keep the three type-spec spellings; recipes use all of them.

### L11. Blockchain context globals

**WHAT.** `msg.sender`/`msg.value`/`msg.data`; `tx.origin`/`tx.gasPrice`;
`block.number/timestamp/coinbase/prevrandao/gasLimit/baseFee/blobBaseFee/chainId`;
`address.self`/`address.balance`, and unary `address.balanceOf/codeSize/codeHash/isContract/isEOA`;
`gasLeft()`, `blockHash(n)`, `blobHash(i)`. All fixed-arity, all mapped to dedicated opcodes.

**EDGE / BAIL.** None are capability-gated (the svm engine has fork-parity analogues), with one
exception: `msg.data` is rejected in **staged svm** mode because the prologue owns the single
`CALLDATA` (G19).

**SOURCE.** `compiler/src/globals.ts` (`GLOBALS` table), `compiler/src/saucer/ops.ts`.

**PORTING (P1).** Port as a data table, not a match arm per global.

### L12. CREATE family

**WHAT.** `contract.create/create2/create3(...)` → `CREATE`/`CREATE2`/`CREATE3`, and
`contract.predictCreate/predictCreate2/predictCreate3(...)` →
`CREATE_ADDRESS`/`CREATE2_ADDRESS`/`CREATE3_ADDRESS`. Fixed arities.

**EDGE / BAIL.** All six are **rejected on svm at compile time** (the engine raises
`UnsupportedOpcode` for 0x82–0x87) — C6/C7.

**SOURCE.** `compiler/src/globals.ts`, `compiler/src/saucer/svm-profile.ts`.

**PORTING (P2).** Gate at emission, not at parse — see C6's rationale.

### L13. Raw external calls

**WHAT.** `contract.call(target, value, calldata)` → `CALL`;
`contract.static(target, calldata)` → `STATIC`; `contract.delegate(target, calldata)` → `DELEGATE`.

**EDGE / BAIL.** On **svm**, `call`/`static` are reshaped to `(target, calldata, accounts[])` where
`accounts` is a static array of interned account indices, capped at 64 (the CPI limit); passing an
svm-shaped accounts array on an EVM target is a guarded compile error (closing a confirmed silent
miscompile where it used to encode as garbage calldata). `delegate` is svm-rejected outright.

**SOURCE.** `compiler/src/globals.ts` (`contract.*`, `svmAccountsArray`,
`assertAccountsListNotOnEvm`), `compiler/src/saucer/saucer-v12.ts` (`svmCall`, `svmStaticCall`).

**PORTING (P1).** The EVM↔svm argument-shape divergence is the single most error-prone builtin.

### L14. `emit()` events

**WHAT.** `emit(signature, data?, ...indexedFieldNames)` → `LOG`. Signature must be a string
literal; topic0 = `keccak256(signature)`; up to 3 indexed field names; non-indexed fields are
ABI-encoded into `data` (an object literal).

**SOURCE.** `compiler/src/globals.ts` (`emit`).

**PORTING (P2).** Not gated on any target.

### L15. `eval()`

**WHAT.** `eval(codeStringLiteral)` compiles the nested source **at compile time**, for the same
target, auto-wrapping in `function main(){…}` if absent, and embeds the resulting bytecode as a
bytes literal operand of `EVAL` (0x9a). A non-literal argument is left as a runtime value (no
compile-time compilation).

**EDGE / BAIL.** On svm: symbolic account refs inside `eval()` are rejected (the nested compile has
its own registry); raw numeric indices propagate a "raw mode" flag out to the enclosing compile so
mixing raw and symbolic modes across the eval boundary still fails loud (G22). Per the svm profile,
`EVAL` runs in static mode (no CPI inside eval'd code).

**SOURCE.** `compiler/src/globals.ts` (`eval`), `compiler/src/planner/registry.ts`.

**PORTING (P2).** Recursive self-invocation of the compiler — keep the registry isolation.

### L16. svm-only intrinsics

**WHAT.**

- `uint(data)` — native-endian cast: `CAST_BE` (0x54) on `v12`, `CAST_LE` (0x55) on `svm`.
  Unavailable on **v1** (its builder has no cast surface at all).
- `accountData(ref, offset, len)` — svm `SLOAD` over account data → bytes descriptor.
- `writeAccountData(ref, offset, value)` — svm `SSTORE`.
- `accountUint(ref, offset, width)` — sugar for `uint(accountData(...))`, `width` pinned to an
  integer literal 1..32.
- Account refs: a string literal (symbolic), `{ref, writable?, signer?}` (computed keys rejected),
  or a raw integer index 0–255.

**EDGE / BAIL.** Raw and symbolic ref modes cannot be mixed in one compile (G22). `uint` is the one
"v12-dialect-only" capability row — allowed on v12 *and* svm, denied on v1.

**SOURCE.** `compiler/src/globals.ts`, `compiler/src/saucer/saucer-v12.ts`
(`castBe`, `castLe`, `svmAccountData`, `svmWriteAccountData`), `compiler/src/capabilities.ts`.

**PORTING (P1).** The endianness rule lives on the *builtin*, not the opcode — one surface, two
lowerings.

### L17. Reserved names, `var` rejection, top-level shape validation

**WHAT.** Three independent gates:

- `RESERVED_NAMES` = every top-level key of `GLOBALS` ∪ `GLOBAL_FUNCTIONS`; `setVar`/`addFunc`
  throw `'<name>' is a reserved name`.
- `var` is rejected in a function body: `var is not supported, use const or let`.
- `isAllowedTopLevel` restricts top-level statements to imports, function declarations,
  `export` wrappers, `EmptyStatement`, and **`const`-kind** variable declarations — anything else
  (a bare expression, a top-level `if`, a top-level `let`) throws
  `top-level statements not allowed, use function main()`.

**SOURCE.** `compiler/src/globals.ts` (`RESERVED_NAMES`), `compiler/src/context.ts`
(`setVar`, `addFunc`), `compiler/src/processor/statement.ts`
(`processVariableDeclaration`), `compiler/src/processor/index.ts` (`isAllowedTopLevel`).

**PORTING (P1).** Also note `setVar` rejects redeclaration in the same scope
(`variable '<n>' is already declared`).

### L18. `` $`...` `` tagged-template bytecode construction (quasiquote)

**WHAT.** A tagged template whose tag is **exactly `$`** builds raw bytecode from the template
text (a metaprogramming / quasiquote primitive). Any other tag throws ``tagged template
expressions must use $`...` ``.

- **No interpolations** — the template text is compiled as a nested standalone program
  (auto-wrapped in `function main(){...}` if it isn't already), threading `ctx.target`/`baseDirs`/
  `contracts`, and the raw inner bytecode is returned as a **`bytes` value** (`saucer.join`).
- **With `${}` interpolations** — each interpolation is classified via `inferKindWithContext`; the
  inner source is compiled with **sentinel placeholders**, the resulting bytecode is split at the
  sentinel positions (`splitBySentinels`), and the static bytecode segments are `CONCAT`-interleaved
  with the runtime-encoded outer expressions (scalar → `encodeScalarAsBytecode`, dynamic →
  `encodeDynamicAsBytecode`).

**EXAMPLE.** `` const bc = $`function main(){ return ${x} + 1n; }`; `` → raw spliced bytecode with
`x`'s runtime value encoded in place.

**EDGE / BAIL.** Distinct from `eval()` (L15): `eval()` embeds the nested program behind an `EVAL`
(0x9a) operand, whereas the `$` tag produces **raw spliced bytecode with no EVAL wrapper**. A plain
(untagged) `` `...` `` template literal has **no** runtime `processExpression` case — only the
`$`-tagged form is a real expression. Sentinel prefixes: `SCALAR_SENTINEL_PREFIX = 0xdead5a0c01`,
`DYNAMIC_SENTINEL_PREFIX = [0xde,0xad,0x5a,0x0c,0x02]`.

**SOURCE.** `compiler/src/processor/expression.ts` (`processTaggedTemplateExpression`:1069,
`splitBySentinels`/`sentinelToSource`:970–1052), dispatched via `case 'TaggedTemplateExpression'`
in `compiler/src/processor/index.ts:681`.

**TARGET.** all (v1/v12/svm).

**PORTING (P2).** A metaprogramming primitive; reimplement the sentinel-split-and-splice carefully —
the invariant is that static segments stay verbatim bytecode and only interpolations are
runtime-encoded by kind. (Also: an array literal with a **spread or a hole** is rejected —
`sparse/spread arrays are not supported`, `expression.ts:323` — the array-literal analogue of the
object-spread rejection L6.)

---

# Category D — conditional compilation & constant folding (acorn core)

### D1. `evalConst` / `evalConstBool`

**WHAT.** A pure compile-time evaluator over `Literal`, `Identifier`, `UnaryExpression`,
`LogicalExpression`, `BinaryExpression` returning `bigint | undefined` (undefined = "not knowable").
Consulted **only** at fold sites (D5, D6) and by the reachability walk (T2) — never on the runtime
emission path, so ordinary bytecode is byte-identical whether a fold succeeds or not.

**EXAMPLE.**
```js
const HAS_CURVE = true;
if (HAS_CURVE) { curve(x); } else { other(x); }   // → just curve(x); other() becomes unreachable
```

**EDGE / BAIL.** Operators: unary `! - + ~`; binary `+ - * / % ** === == !== != < <= > >= & | ^ <<
>>`. Division/modulo by zero and a negative exponent yield `undefined` (never a crash). `&&`/`||`
resolve correctly with only **one** side known (a falsy left collapses `&&` to `0n` regardless of the
right). Any unrecognized node kind → `undefined`. `evalConstBool` is `v !== 0n` layered on top.
Identifier resolution is `ctx.getConstant(name)` — the union of `defines` and folded top-level
consts (D3/D4).

**SOURCE.** `compiler/src/processor/const-eval.ts`.

**TARGETS.** all.

**PORTING (P0).** Foundation for D5/D6/T2. Preserve: the never-throw fail-closed contract, one-sided
short-circuit resolution, and div/mod-by-zero → unknown.

### D2. `literalToBigint` — the `.raw` precision fix

**WHAT.** Converts an acorn `Literal` to a bigint by parsing the literal's **own source text**
(`literal.raw`), not the already-parsed `.value`.

**EDGE / BAIL.** Acorn lossily rounds any suffix-less integer literal above `2^53 − 1` through an
IEEE-754 double **at parse time**, so `.value` can already be wrong. The confirmed real case:
`0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000` (`2^256 − 2^24`, legal uint256)
rounds **up to exactly `2^256`**, which then throws `value exceeds 32 bytes (uint256 max)`; a smaller
over-`2^53` value instead folds silently to the *wrong* constant. Non-integer forms (float,
exponential) still decline to fold — `BigInt()` throws and is caught → `undefined` — which
generalizes the old `Number.isInteger` reject via an exact parse. The TS front-end has the
independent twin of this bug/fix (TS3).

**SOURCE.** `compiler/src/processor/const-eval.ts` (`literalToBigint`); the runtime-value twin is
`processor/expression.ts` (`processLiteral`/`literalToInt`), which already parsed raw text.

**TARGETS.** all.

**PORTING (P0), low effort.** Never route a compile-time literal through a float. Audit *every*
literal path (there are three in this compiler; two had the bug).

### D3. Top-level `const` registration + constant read substitution

**WHAT.** `registerTopLevelConsts` folds each top-level (incl. `export`ed) `const NAME = <init>`
whose initializer resolves via D1 into the same constant environment as `defines`. Beyond folding
conditions, a registered constant is substituted at **ordinary read sites**: `processExpression`'s
`Identifier` case emits `saucer.int(constant)` whenever `ctx.getConstant(name)` resolves **and** no
runtime variable of that name shadows it — so `rt + SCALE` emits an immediate, no variable read.

**EDGE / BAIL.** `const` only (a top-level `let` is a hard error anyway, L17). Destructuring
declarators are skipped. A non-foldable initializer is simply never registered (no error here; a
later read fails as an undefined variable if nothing else declares it). **`defines` wins on a name
collision** (checked at registration: `if (!this.defines.has(name))`).

**SOURCE.** `compiler/src/processor/index.ts` (`registerTopLevelConsts`, `processExpression`'s
Identifier case), `compiler/src/context.ts` (`registerConstant`, `getConstant`, `setDefines`).

**TARGETS.** all (the map lives on `SharedModule`, so every function's child context sees it).

**PORTING (P0).** One flat environment shared by `defines` and source consts, with `defines`
priority resolved **at registration time**.

### D4. `CompileOptions.defines`

**WHAT.** Caller-supplied `Record<string, bigint | boolean | number>`; booleans map to `1n`/`0n`.
The mechanism behind protocol-handler conditional compilation: `if (HAS_CURVE) curve(...)` vanishes
when the flag is false, and with T1 the now-unreferenced handler disappears from the bytecode.

**SOURCE.** `compiler/src/index.ts` (`CompileOptions.defines`), `compiler/src/context.ts`
(`setDefines`).

**PORTING (P1).** This plus T1 is the SDK's whole "ship only in-play protocols" strategy.

### D5. `if` / `else if` constant folding

**WHAT.** With `ctx.foldEnabled` (default true) and a D1-resolvable test, emits **only** the taken
branch; `else if` chains recurse. A non-constant test falls through to ordinary runtime codegen.

**EDGE / BAIL.** `taken === false` with no `alternate` returns the input saucer unchanged (neither
branch exists). Folding is safe standalone (independent of T1): `evalConst` only ever resolves a real
compile-time constant.

**SOURCE.** `compiler/src/processor/statement.ts` (`processIfStatement`).

**TARGETS.** all.

**PORTING (P0).** Must stay bit-for-bit consistent with T2's copy of the same rule.

### D6. Ternary constant folding

**WHAT.** `processTernaryStore` mirrors D5 for a ternary in declaration/assignment position:
with a foldable test it recurses through `storeExpression` on the taken side only.

**EXAMPLE.**
```js
const FLAG = true;
let x = FLAG ? handlerA() : handlerB();   // → let x = handlerA(); handlerB becomes unreachable
```

**EDGE / BAIL.** When the test is *not* foldable, both branches compile and their storage kinds are
reconciled — a separate concern, see K11.

**SOURCE.** `compiler/src/processor/statement.ts` (`processTernaryStore`).

**PORTING (P1).** Same mirrored-rule hazard as D5/T2.

---

# Category T — dead code elimination (tree-shaking)

### T1. `treeshake`

**WHAT.** After all functions are collected (local + imported + inline-expanded), keeps `main` plus
everything transitively reachable from it, dropping the rest before any body is compiled. Default
**on**.

**EDGE / BAIL.** `treeshake: false` restores "emit every declared/imported function" — needed by
tests that pin an exact v1 function-table index layout, since dropping a function shifts every later
index. `main` is always kept regardless of reachability. Runs **after** inline expansion and
**before** the return-kind fixpoint (A4).

**SOURCE.** `compiler/src/processor/index.ts` (`treeshake`).

**TARGETS.** all (runs pre-dispatch on the shared declaration list).

**PORTING (P0).** Note the interaction with I6: an *unreachable inline* function is still validated,
unlike an unreachable real function which is silently dropped.

### T2. `collectCalls` fold-aware reachability

**WHAT.** A conservative generic walk (`eachChild` visits every child by default) with exactly two
special cases: (a) `IfStatement`/`ConditionalExpression` — when `ctx.foldEnabled` **and** the test
resolves via `evalConstBool`, only the taken branch is walked (mirroring D5/D6 exactly); (b) a
`CallExpression` with an `Identifier` callee present in the declaration map marks that name reachable.

**EDGE / BAIL.** Deliberately **not** special-cased (walked in full, so the walker can never
under-approximate): loop bodies, and `&&`/`||` in value position. With `fold: false` both branches
are always walked. A malformed/non-AST value is a no-op guard.

**SOURCE.** `compiler/src/processor/index.ts` (`collectCalls`, `eachChild`).

**PORTING (P0).** **The hazard to design out:** the fold decision exists in three places (T2, D5,
D6) that must agree bit-for-bit. Under-approximating drops a function the emitter still calls (a
`CALL_FUNCTION` to an unregistered index — a broken program); over-approximating merely retains dead
code. Factor "does this if/ternary fold, and to which branch" into one shared helper consulted by
both the walker and the emitter.

---

# Category TS — the TypeScript front-end (fold / eval / propagate)

> **Porting scope:** this category is TS-gated in the *current* compiler **only because it was built
> on the `typescript` library + `ts-evaluator`** — a reuse artifact, not a design boundary. For
> `compiler-rs`, partial evaluation is in scope for **JS as well as TS**; treat these 16 features as
> the language-agnostic partial-eval spec, run on both source languages. (See "Porting scope" up top.)

Applies to `.ts` / `.sauce.ts` sources and imports only. Six ordered `before` transformer stages run
inside `ts.transpileModule`, then types are stripped and **plain JS text** is handed to acorn. Every
pass fails closed: an unresolvable fold leaves the node exactly as found.

Stage order (fixed): `foldTransformer` → `tableFoldTransformer` → `constPropagationTransformer` →
`deadConstEliminationTransformer` → `localArrayFoldTransformer` → `localConstPropagationTransformer`.

### TS1. `tsPartialEval` / `tsPartialEvalWithMeta` + both wiring seams

**WHAT.** `tsPartialEvalWithMeta(code, filePath) → { text, wideReturnArrays }` is the real entry;
`tsPartialEval` is the signature-preserving wrapper returning just `text`. Up front (outside the
transformer pipeline): `collectTopLevelFunctions`, `analyzeTopLevelConsts` (TS11),
`collectTopLevelTables` (TS12).

Two triggers: **top-level** `CompileOptions.tsSource` (index.ts stashes a non-empty
`wideReturnArrays` onto `ctx.wideReturnArrays`), and the **import seam** — any imported module whose
path ends in `.ts` runs through `tsPartialEval` automatically unless a caller-supplied
`ctx.transformModule` overrides it. `.js`/`.sauce`/`.mjs` never invoke any of this.

**EDGE / BAIL.** The import seam uses the **plain** wrapper, so the wide-return-array signal is
*not* threaded through imports — provably safe because TS14's fold is gated to `function main` and an
imported module may never define `main` (M1). A ts-evaluator policy caps runtime
(`deterministic: true`, no io/network/process/console, `maxOps` 100 000, `maxOpDuration` 2000 ms,
`environment: { preset: 'NONE' }` — hence **no `ts.Program`/checker**, so no cross-file or
property/call resolution).

**SOURCE.** `compiler/src/ts-frontend.ts` (`tsPartialEval`, `tsPartialEvalWithMeta`, `POLICY`),
`compiler/src/index.ts` (`compileFresh`), `compiler/src/processor/index.ts` (import seam).

**TARGETS.** all (output is target-agnostic text).

**PORTING (P1) — or skip entirely.** SauceScript proper is JS-syntax; this whole category is
optional unless a TypeScript surface is wanted. Much of the file's structural awkwardness
(name-only analysis results, structural re-derivation of statements) is a workaround for
`ts.transpileModule` re-parsing between stages — a single stable AST/arena design does not need it.

### TS2. `tsEvalConst` / `tsEvalUnary` / `tsEvalBinary`

**WHAT.** The primary hand-rolled bigint evaluator over `ts.Node` — the TS-side analogue of D1.
Handles parenthesized expressions, BigInt literals, numeric literals (TS3), `true`/`false`,
Identifier (via the `consts` map, shadow-checked), prefix unary `- + ~ !`, binary arithmetic
(`+ - * / % **`, negative exponent declines), comparisons, bitwise, equality, short-circuit
`&&`/`||` resolvable from one side, and `CallExpression` via TS4.

**EDGE / BAIL.** Any other node kind → `undefined`. Division/modulo by zero → `undefined`. Exists at
all because **`ts-evaluator@2.0.0` cannot evaluate bigint arithmetic**: `BigInt(node.text)` on a bare
`3n` literal throws (the constructor rejects the literal's own `n`), and bigint binary expressions
fail silently — and SauceScript is bigint-only.

**SOURCE.** `compiler/src/ts-frontend.ts` (`tsEvalConst`, `tsEvalUnary`, `tsEvalBinary`).

**PORTING (P0 within this category).** The 4-argument signature `(node, consts, functions, shadowed)`
is reused verbatim by every other pass in the file — that uniformity is what lets later features
(TS15, TS16) compose without their own evaluator. Keep it.

### TS3. Numeric-literal precision (`getText()`)

**WHAT.** The numeric-literal branch parses `node.getText().replace(/_/g, '')` into a `BigInt` —
**not** `Number(node.text)`.

**EDGE / BAIL.** `ts.NumericLiteral.text` is *not* raw source: the TS scanner normalizes it through
the same lossy float round-trip, so `getText()` (the literal exactly as written) is required, with
numeric separators stripped because `BigInt()` rejects them. `getText()` **throws** on a
factory-synthesized node (no source position) — caught by the evaluator's own try/catch, which is why
TS13 needs its own `synthesizedNumericValue` fallback reading `.text` directly rather than changing
the shared evaluator.

**SOURCE.** `compiler/src/ts-frontend.ts` (`tsEvalConst` numeric branch, `synthesizedNumericValue`).

**PORTING (P0).** Same rule as D2, second implementation. Plus: decide up front how synthesized
literals carry their value, because the unroller produces them.

### TS4. `tsEvalCall` — same-file call folding

**WHAT.** Folds a call to a same-file top-level function whose body is exactly one
`return <expr>;` when every argument resolves to a constant.

**EXAMPLE.**
```ts
function double(x) { return x * 2n; }
const y = double(21n);      // → const y = 42n;  (then TS9/TS10 can inline and delete y)
```

**EDGE / BAIL.** Three hard boundaries, deliberately not relaxed: (1) the callee body must contain
**zero** `CallExpression`/`NewExpression` anywhere — not merely no recursive call, no call to
*anything* — which is the entire soundness argument (a body that never calls out cannot recurse, so
no recursion analysis is needed); (2) same-file only; (3) the callee's own declaration is **never**
touched or eliminated (it may still be called with non-constant args, or imported cross-file).
Also declines: generators and `async` functions (neither returns its value directly), destructuring
or rest parameters, too many arguments, a shadowed callee name. Parameters bind as a temporary
overlay on `consts` (never mutating it); an omitted argument evaluates its default left-to-right;
**every** parameter name is excluded from the overlay's initial seed so an earlier default cannot
silently read an outer const sharing a *later* parameter's name (real parameter-list TDZ would
throw).

**SOURCE.** `compiler/src/ts-frontend.ts` (`tsEvalCall`, `foldableReturnExpr`, `containsCallOrNew`).

**PORTING (P2).** Cheap and self-contained; the zero-nested-calls rule is what keeps it sound.

### TS5. `foldExpression` + the ts-evaluator fallback and its guards

**WHAT.** Tries `tsEvalConst` first; only for shapes it cannot resolve does it fall back to
`ts-evaluator`'s `evaluate()` (wrapped in try/catch, since it *throws* on a bare BigInt literal).

**EDGE / BAIL.** Three guards refuse the fallback outright:
- **`ASSIGNMENT_OPERATOR_TOKENS`** — TS models `=`/`+=`/`&&=` as `BinaryExpression`, and
  `evaluate(a = 1)` "succeeds" with `1`, which would rewrite `a = 1;` to bare `1;`, silently
  discarding the write. Checked before either evaluator runs.
- **`CallExpression`** — call folding is governed entirely by TS4's rules, never delegated to
  whatever a no-checker `evaluate()` happens to do today.
- **`containsShadowedIdentifier`** — the fallback does its *own* identifier resolution and is
  confirmed to ignore local shadowing entirely. The reproduced bug:
  `const FLAG = true; function f(FLAG) { if (FLAG) { return 1; } return 2; }` — `tsEvalConst`
  correctly declined, then the fallback resolved the *parameter* `FLAG` against the outer const and
  pruned the function to `return 1;`, discarding the parameter and the other branch. A genuinely
  wrong program, not a missed optimization.

**SOURCE.** `compiler/src/ts-frontend.ts` (`foldExpression`, `tryEvaluate`,
`ASSIGNMENT_OPERATOR_TOKENS`, `containsShadowedIdentifier`).

**PORTING (P1).** A from-scratch Rust port most likely has **no** third-party fallback evaluator —
then drop it and extend the hand-rolled evaluator with the few shapes the fallback covered (bare
boolean/string identifiers, template literals). That removes an entire class of shadow-safety risk.

### TS6. Shadow-safety discipline (cross-cutting)

**WHAT.** Every pass threads a `shadowed: ReadonlySet<string>` grown on the way down through
scope-introducing nodes (function/method/getter/setter bodies, blocks, catch clauses,
`for`/`for-in`/`for-of`). A name reserved by *anything* between the current node and top level is
never resolved against the top-level `consts`/`functions`/`tables` maps.

**EDGE / BAIL.** Helpers: `collectBindingNames`; `collectVarNames` (`var` hoists to the enclosing
**function**, not block, via a pre-scan that stops at nested functions/classes);
`collectLexicalNamesInScope` (`let`/`const`/nested named `function`, crossing
`if`/`while`/bare-block boundaries but stopping at function/class); `collectDirectlyDeclaredNames`.
**The rule that makes this non-obvious:** the real compiler shares scope across `if`/`while` bodies
(L3), so a name first declared inside a branch is the *same* variable after it — a shadow set built
only from a scope's direct statement list is wrong. Reproduced bug family: `const FEE = 100n;
function f(c) { if (c) { let FEE = 5n; } return FEE; }` wrongly substituted `100n`. This was fixed
independently in **five** places that each compute their own shadow set:
`substituteConstReads`, `foldTransformer`, `checkTableSafety`/`tableFoldTransformer`, and
`collectWriteCounts`. Over-including a name costs at most a missed optimization; under-including it
is a wrong substitution.

**SOURCE.** `compiler/src/ts-frontend.ts` (the `collect*Names` family and each pass's scope
handling).

**PORTING (P0 — the highest-leverage invariant in this category).** Compute the scope/shadow model
**once**, in one place, and have every pass consume it. The TS implementation's copy-paste is the
documented source of at least four separate bugs.

### TS7. If-branch flattening + splice-collision guard

**WHAT.** `if (constCond) { A } else { B }` is replaced by the taken branch's own statements
**spliced into the enclosing statement list** — never wrapped in a nested block, because the base
SauceScript statement processor does not accept a bare block as a standalone statement.

**EDGE / BAIL.** `collidesWithSurroundingDeclarations` inspects the **already-expanded** output for a
`let`/`const`/nested-`function` name that repeats within it or collides with an outer enclosing name;
either declines the whole flatten (falling back to visiting the branch as a real, genuinely-scoped
block). Without it, `let x = 1n; if (true) { let x = 2n; … }` flattens to two declarations of `x` in
one scope — text `ts.transpileModule` happily prints and `acorn.parse` then rejects with
`SyntaxError: Identifier 'x' has already been declared`, crashing the compile. A non-block taken
branch (`if (true) return 5;`) cannot trigger this (JS grammar forbids a lexical declaration there).

**SOURCE.** `compiler/src/ts-frontend.ts` (`foldTransformer`'s if case,
`collidesWithSurroundingDeclarations`).

**PORTING (P1).** If the target IR *does* support a nested block statement, keep the block and skip
this entire mechanism — strictly simpler.

### TS8. Module-scope ternary folding

**WHAT.** `foldTransformer` has its own dedicated `ts.isConditionalExpression` visitor branch:
it evaluates **only** `.condition`, and on success replaces the whole ternary with the selected
branch, recursing into it (so a nested ternary in the taken branch cascades).

**EDGE / BAIL.** `tsEvalConst` has **no** case for conditional expressions anywhere — this is a
separate mechanism by design, not a gap. The fallback path (`tryEvaluate` on a whole ternary node) is
only reached from a calling context that bypasses this branch, e.g. an `if` whose test *is* a bare
ternary. **This can be enabling, not just optimizing:** the base grammar rejects a ternary outside
assignment position (L2), so folding a nested one away is what makes such a program compile at all.

**SOURCE.** `compiler/src/ts-frontend.ts` (`foldTransformer`).

**PORTING (P1).**

### TS9. Constant propagation to reads

**WHAT.** Substitutes every unshadowed bare-`Identifier` **read** of a top-level const (or
effectively-const, TS11) name with its literal — closing the gap that `foldTransformer` only folds
composite expressions, never a bare identifier (which might be an lvalue). Chains collapse:
`const a = 1; const b = a + 3; const c = b + 4; console.log(c);` → `console.log(8n);`.

**EDGE / BAIL.** `visitAssignmentTarget` walks an assignment/update **target** without substituting
the bound identifier(s), while still substituting genuine nested reads (a computed member key, a
destructuring default's value) — necessary because TypeScript represents destructuring *assignment*
with the same node kinds as an object/array literal *value*; only position distinguishes them.
Shadow sets are computed once per scope up front (matching real TDZ, where a block-scoped name is
reserved from the top of its scope). Entirely skipped (not even recursed into):
type nodes/parameters, class/enum/module/interface/type-alias declarations, import/export
declarations, `break`/`continue`.

**SOURCE.** `compiler/src/ts-frontend.ts` (`constPropagationTransformer`, `substituteConstReads`,
`visitAssignmentTarget`, `isOutOfScopeForPropagation`).

**PORTING (P1).** The read-vs-write-position classifier is the most reusable piece here — it is
hand-duplicated three times in the TS version (`visitAssignmentTarget`,
`visitLocalAssignmentTarget`, `scanAssignmentTarget`). Factor it once, parameterized by a callback.

### TS10. Dead-declaration elimination

**WHAT.** Deletes any tracked top-level declaration (const, effectively-const, or lookup table) left
with **zero** `Identifier` occurrences of its name anywhere in the file after substitution. For a
TS11 STRETCH pair, both the predeclaration's declarator and its single assignment statement are
removed together — never leaving an orphaned `let x;`.

**EDGE / BAIL.** Deliberately a simple **whole-file, not scope-aware** reference count
(`countIdentifierRefs`, which does skip label-ish positions such as a non-computed property key): a
const sharing its name with an unrelated nested declaration may be kept (inert, its value already
propagated) — a missed cleanup, never a wrong substitution. Because it runs *after* fold+unroll, a
const used only as a now-unrolled loop bound or only inside a pruned branch is correctly removed.
`findPairStatements` **re-derives** a STRETCH pair's statements structurally from whichever tree it
is handed, since earlier stages may have rebuilt the assignment (a node reference would be stale).

**SOURCE.** `compiler/src/ts-frontend.ts` (`deadConstEliminationTransformer`, `countIdentifierRefs`,
`findPairStatements`).

**PORTING (P2).** The re-derivation dance is a `ts.transpileModule` artifact — unnecessary with a
stable AST.

### TS11. Effectively-const `let` / `var`

**WHAT.** A top-level `let`/`var` written **exactly once** across its whole visible scope is
semantically a `const` (the classic "effectively final" analysis) and is folded into the same
`consts` map. Two shapes:

1. **PRIMARY** — `let x = <init>;` never written again anywhere in the file.
2. **STRETCH** — the idiom `let x; x = <init>;`: a bare predeclaration plus its one later
   assignment, both **direct, unconditional statements of the same top-level statement list**,
   including the multi-declarator form `let a, b, c;` followed by three separate assignments, each
   resolved independently.

**EDGE / BAIL.** "Written once" is a flat **syntactic** count (`collectWriteCounts`, shadow-aware) of
every assignment/compound-assignment/update/destructuring target — *not* a reachability analysis: a
second write inside a never-executed branch still disqualifies. STRETCH **poisons** a pending
predeclared name the moment any other statement references it (since `let x;` is legally readable as
undefined before its assignment, folding despite an intervening read would substitute a *future*
value into an earlier read). Interaction with U2: a genuine loop counter is always written again by
its own increment, so PRIMARY disqualifies it; STRETCH only matches a **no-initializer**
predeclaration, which U2's own pairing check never accepts — and `consts` is fully precomputed before
any transformer runs, so there is no ordering race. `analyzeTopLevelConsts` runs against its own
separate `ts.createSourceFile` parse, so it returns **names only**, never node references.

**SOURCE.** `compiler/src/ts-frontend.ts` (`analyzeTopLevelConsts`, `collectWriteCounts`).

**PORTING (P2).** PRIMARY is standard and cheap; STRETCH is a real user-motivated ergonomic
(a recipe file's `let a, b, c;` idiom) but separable.

### TS12. Array / object lookup-table folding

**WHAT.** A top-level `const NAME = [<foldable>, …]` or `{ key: <foldable>, … }` — a fee-tier table,
a tick-spacing table — becomes a compile-time lookup table whose `NAME[k]` / `NAME.prop` /
`NAME["prop"]` accesses fold to literals, after which TS10 deletes the declaration.

**EXAMPLE.**
```ts
const TIERS = [500n, 3000n, 10000n];
function main() { return TIERS[1]; }     // → return 3000n;  (TIERS deleted)
```

**EDGE / BAIL.** Candidacy requires every element/property to fold via `tsEvalConst` (it may
reference an earlier **scalar** const, never another table — no "tables of tables"). Then a
**whole-file, shadow-aware soundness scan** (`checkTableSafety`/`isSafeTableRead`) must prove every
remaining occurrence is a plain constant-indexed read that is neither a write nor a call target —
a strict **allowlist**, so any unrecognized escape fails closed: reassignment, `++`/`--`, **any**
method call (`NAME.anything(...)`, no whitelist), an element/property write (including one nested
arbitrarily deep inside a destructuring-assignment pattern — TS reuses literal node shapes for
patterns), or the bare identifier passed as an argument / aliased / returned / spread. **One**
disqualifying use kills the whole table (no partial tracking), and a use inside unreachable code
(`if (false) { ARR.push(1n); }`) still disqualifies — the scan is purely syntactic. Unlike the
scalar passes, encountering a class/enum/namespace body **disqualifies** rather than being skipped
(a method could mutate the table without reassigning its binding).

An access that *isn't* resolvable (non-constant index, out-of-bounds/negative array index,
non-string-literal computed key) is left untouched and does **not** disqualify other accesses.
**Important caveat:** "left untouched" only avoids a worse fold — it does not guarantee the file
compiles, because the base compiler has no representation for an array/object literal inside a
function body at all (`const TIERS = […]; function main(i){ return TIERS[i]; }` throws
`undefined variable: TIERS` with `tsSource` off entirely). Out of scope by design: `new Array(n)`
(see TS13), spread elements, shorthand/method/getter/setter/computed-key properties, nested
literals, `for...in`.

**SOURCE.** `compiler/src/ts-frontend.ts` (`collectTopLevelTables`, `foldArrayLiteralElements`,
`foldObjectLiteralProps`, `checkTableSafety`, `isSafeTableRead`, `isTableAccessUnsafeUsage`,
`tableFoldTransformer`, `foldTableAccess`).

**PORTING (P1).** Allowlist, never blocklist. And note the *base-compiler* consequence: this feature
is closer to enabling than optimizing.

### TS13. Local `new Array(n)` construction folding

**WHAT.** Eliminates a function-local `new Array(n)` entirely when its size, every element, and every
read index are provably constant and the binding provably never escapes.

**EXAMPLE.**
```ts
function main() {
  const arr = new Array(3);
  for (let i = 0n; i < 3n; i++) { arr[i] = i * 2n; }
  return arr[1];
}
// compiles byte-identically to: function main() { return 2n; }
```

**EDGE / BAIL — pipeline position is load-bearing at both ends.** It runs **after**
`foldTransformer` (it only recognizes already-straight-line `arr[k] = v;` statements, which exist
*because* U1 splices counter-substituted body copies into the enclosing list — recognizing an
un-unrolled loop would duplicate the whole unroller and its cap), **after** the table/const passes
(so a write value spelled `TIERS[0]` is already a literal), and **before** TS15 (a folded element
read is what lets the local scalar pass finish an accumulator: `total += fees[0]` → `total += 100n` →
`return 3600n`; the reverse order leaves the accumulator NAC). The price paid deliberately: a write
value only local scalar reasoning could resolve (`let base = 10n; arr[0] = base;`) is not folded.

**Why a separate pass rather than a new value in TS15's env:** TS15's `collectWrittenNames`
deliberately does not collect `arr[i] = x` *because* an array-shaped local is NAC regardless —
teaching that env about arrays would falsify that justification and make a non-unrollable
`while (cond) { arr[0] = x; }` a genuine stale-value unsoundness. Also, deletion is a whole-function
verdict that an emit-as-you-go forward walk cannot decide.

**Rules.** Declaration must be a direct, single-declarator `let`/`const` of the function body's own
top-level statement list (never nested in an `if`/loop/block — SauceScript shares that scope, L3);
size must resolve to `1..MAX_FOLDED_ARRAY_ELEMENTS` (256); **every** index in `[0, size)` must be
written exactly once by a plain-`=` statement with constant index and value, neither referencing any
tracked array; write **order** is unconstrained (unobservable — every write precedes every read by
construction, since any other occurrence of the name in the construction region disqualifies); and
every remaining occurrence must be an in-range constant-index element read after the construction
region, **or** TS14's authorized `return arr;`. A strict allowlist whose default branch disqualifies:
aliasing, call argument, spread, `for...of`, `.length`, any method call, rebinding, compound element
write, destructuring target, an occurrence before the declaration (TDZ), an occurrence inside a
nested function-like scope (a real hazard: `.catch()` handlers compile against the *same*
`CompilerContext`), or a redeclaration anywhere in the function.

**Two ways it is stricter than TS12, and why:** (a) safe is not enough — every surviving occurrence
must also be **resolvable**, because this pass *deletes the allocation*, so one unresolvable read
would dangle (TS12 can leave an access untouched because it only removes an already-zero-reference
declaration); (b) all-or-nothing per array — keeping it alive for one runtime-indexed read means
keeping every write anyway.

**Two mechanism notes.** *The parent-pointer trap:* TS12's classifiers walk **up** through
`node.parent`, but a node synthesized by an earlier stage (exactly what unrolling produces) has
`parent === undefined`, which would make an unrolled `arr[0] = 5n;` look like a safe read — so this
pass uses a **top-down** scan (`scanArrayUses`) that classifies before descending and never consults
`.parent`. *Post-condition guard:* after rewriting, `localArrayFoldTransformer` re-checks that no
deleted name still occurs anywhere in the body, discarding the whole rewrite if it does — sound by
construction, not only by argument.

**Out of scope (each sound to add later):** a top-level `new Array` (uncompilable regardless), a
declaration nested in a block, holes (partially-written arrays), duplicate/last-write-wins writes,
self-referential construction (`arr[1] = arr[0] + 1n`), compound element writes, `.length` on a
folded array (never verified on-chain to equal the allocation size), `for...of` over a local array
(still a hard `not implemented: ForOfStatement`), and a ternary index/value resolvable only through
local reasoning.

**SOURCE.** `compiler/src/ts-frontend.ts` (`analyzeLocalArrays`, `newArraySize`,
`classifyConstructionRegion`, `isCandidateWriteStatement`, `scanArrayUses`, `scanAssignmentTarget`,
`rewriteFoldedArrayBody`, `localArrayFoldTransformer`, `evalArrayConst`,
`MAX_FOLDED_ARRAY_ELEMENTS`).

**TARGETS.** all.

**PORTING (P2).** Narrow but well-specified. If ported, keep the separate-pass rationale and the
top-down scan.

### TS14. `return arr;` escape fold + forced BYTE_32 width channel

**WHAT.** For a fully-resolved TS13 candidate, `return arr;` (or `return (arr);`) as the **sole**
operand of a `ReturnStatement` in a top-level `function main` becomes
`return [lit0, …, litN-1];`, with the declaration and all writes deleted. Multiple such returns fold
independently, and a return may coexist with element reads of the same array.

**Why safe, and why `main` only — measured, not argued.** A `new Array(n)`-built TUPLE returned from
a Sauce program today leaks raw Solidity **memory addresses** (measured `0x…03c0 0480 0540` =
960/1152/1344 for elements `0/2/4`): v1's `execute()` returns `ctx.dynamicResult.data` verbatim, and
that data is an array of pointers into a call frame discarded on return. A literal TUPLE return and
`return helper()` leak identically. Of every array/tuple-shaped return, the **packed static array
literal this fold produces is the only one with a defined wire encoding** (N 32-byte words, exactly
`abi.encode`d `uint256[N]`) — a strict improvement with no consumer to regress. A **helper's**
returned array has no working consumer today either (`x[0]` reverts identically whether the helper
returned a heap array or a literal one), but if that pre-existing gap is ever fixed, a helper fold
would keep it broken while the un-folded program started working. `main`'s return exits the program
entirely and `main` is never callable, so it is structurally exempt.

**EDGE / BAIL.** Any **negative** element disqualifies (a NEG scalar makes `encodeArray` throw
`array elements must be literals or dynamic types` — folding must never turn a compiling program into
a compile error). A separate, **smaller** cap `MAX_FOLDED_RETURN_ARRAY_ELEMENTS` (64, vs 256)
because this is the one direction that **grows** bytecode: a forced 32-byte element costs ~32 bytes
against ~10 for the `SET_INDEX` it replaces (~3.5× growth measured at 64 elements). Gated to a
top-level `FunctionDeclaration` named exactly `main` (sees through `export function main`, excludes
an arrow-const `main` and any method named `main`).

**The out-of-band width channel.** `tsPartialEval` returns plain text that acorn re-parses, so a
synthesized node can carry no metadata — the width must ride **alongside** the text.
`tsPartialEvalWithMeta` returns `wideReturnArrays: Set<string>` of `elements.join(',')` value
fingerprints; `compile()` stashes a non-empty set on `ctx.wideReturnArrays`; `processReturnStatement`
matches a return-position array literal's own fingerprint **and** `ctx.isMainBody`, then calls
`processArrayExpression(..., forcedWidth: 32)` → `saucer.array(elements, forcedWidth)` →
`encodeArray`'s `Math.max(forcedWidth, natural)`. A forced width can only **widen**.

**Invariant preserved.** An ordinary user-written array literal keeps its auto-narrowed encoding
everywhere, including in the same file as a fold (`return [0n,2n,4n]` still emits the narrow
`92030100020400` with `tsSource` on or off). Two accepted imprecisions: the match is a **value**
fingerprint, not node identity (a user literal in `main` with identical values would also widen —
harmless, only more ABI-conformant), narrowed by the `isMainBody` gate so it can never affect a
helper; and a negative element is rejected up front so it never risks the match.

**SOURCE.** `compiler/src/ts-frontend.ts` (`scanArrayUses` rule 6b, `rewriteFoldedArrayBody`,
`wideReturnFingerprint`, `MAX_FOLDED_RETURN_ARRAY_ELEMENTS`), `compiler/src/context.ts`
(`wideReturnArrays`, `isMainBody`), `compiler/src/processor/index.ts` (`processReturnStatement`),
`compiler/src/saucer/array.ts` (`encodeArray`'s `forcedWidth`).

**TARGETS.** v1, v12, svm — one shared encoder covers all three (v1 adds its trailing halt byte).

**PORTING (P2).** If a port fixes the cross-function heap-descriptor gap, revisit whether to extend
this to helpers *before* copying the `main`-only restriction.

### TS15. Local (per-function) constant propagation

**WHAT.** A control-flow-sensitive (but deliberately **not** fixpoint) sequential abstract
interpreter, walked fresh per function-like scope, tracking `Map<name, bigint | NAC>` per program
point and substituting reads with known values. It is the only pass that reasons about a `let`
declared and reassigned **inside** a function.

**EDGE / BAIL — the rules.**
- **Snapshot, not a second evaluator.** Every evaluation uses the same 4-arg `tsEvalConst` family;
  `resolveLocalEnv`/`LocalResolution` translates the evolving env into `(consts, functions,
  shadowed)`: a NAC name is **excluded from the consts map entirely** (never merely unresolved — a
  stale top-level entry of the same name must not leak) *and* added to `shadowed`; a known local
  overlays the top-level map. Free consequence: it can fold a TS4 call whose argument only becomes
  constant through local flow (`let x = 3n; let y = double(x);`).
- **Straight-line.** A declaration/assignment/compound/update's value is evaluated against the
  current env; resolvable → tracked, else NAC. A destructuring assignment target invalidates every
  name it writes (not currently reachable through `compile()`, fixed defensively). An
  expression-statement's leading `ParenthesizedExpression` is unwrapped first — object-destructuring
  assignment *must* be parenthesized in real JS, so without unwrapping the write never reaches the
  invalidating path.
- **`if`/`else`.** Both branches walk from independent env copies, then merge: a name keeps its value
  only if both agree (an untouched branch agrees with the pre-`if` value); any disagreement or either
  side NAC → NAC. The merge only revisits names already keyed in `env`, which is why the function's
  env is **pre-seeded** with every parameter *and* every `collectLexicalNamesInScope` name in the
  whole body (TS6's rule).
- **Loops.** **No fixpoint** (bigint is an unbounded lattice; a real fixpoint needs widening plus a
  termination proof). Instead every name written anywhere in the loop is forced NAC both inside it
  and from loop entry onward — even at a textually-earlier reference, because a later iteration's
  write could already have happened. Misses a loop-invariant-reassigned-to-the-same-value case, a
  documented tradeoff.
- **Whole-function bails** (left completely untouched, not even descended into): a
  `switch`/`try`/`catch`/`finally`/labeled statement, or `for...of`/`for...in` — none has a case in
  the real `processStatement`, so bailing costs nothing; **or** any nested function/arrow/method at
  any depth that reads or writes a name in the outer function's own parameter/lexical scope — a
  real, non-theoretical hazard because `.catch(handler)` compiles the handler against the **same**
  `CompilerContext`.
- **Out of scope on purpose:** real fixpoint dataflow, dead-local elimination, algebraic-identity or
  dead-code-after-terminator peepholes.

Note a strict improvement it enables: `const RATE = 10n; function f() { const RATE = 2n; return RATE
+ 1n; }` → `return 3n;` (the *own-scope* value — earlier passes correctly declined the outer one).

**SOURCE.** `compiler/src/ts-frontend.ts` (`localConstPropagationTransformer`, `resolveLocalEnv`,
`foldOrSubstitute`, `walkStatement`/`walkIfStatement`/`walkLoopStatement`/`walkStatementList`,
`collectWrittenNames`, `functionBails`, `containsDisallowedConstruct`, `bailsForOuterClosure`,
`transformFunctionLikeScopeBody`, `updateFunctionLikeBody`).

**PORTING (P1).** Preserve the bail list *and* keep it tied to what the statement processor actually
supports — over-bailing is always safe, under-bailing is not.

### TS16. Ternary folding in the local pass (+ compound-assignment RHS)

**WHAT.** `substituteLocalReads` gains its own `ConditionalExpression` case (mirroring TS8 but
against the local `LocalResolution`): evaluate only `.condition`; if resolved, replace the whole
ternary with the selected branch, itself recursively substituted (cascading). If unresolvable,
rewrite `.condition`/`.whenTrue`/`.whenFalse` independently — substituting known identifiers inside
without touching the genuinely runtime branch structure.

**EDGE / BAIL.** `evalLocalConst` is the bridge: try plain `tsEvalConst` first (the common
ternary-free case, unchanged cost), and only on failure hand the expression to `substituteLocalReads`
to collapse any resolvable ternary and re-attempt. This is what makes a ternary **nested inside a
larger expression** fold (`let b = (cond ? 2n : 3n) + 1n;`) — which matters beyond optimization,
since the base grammar rejects a nested ternary outright (L2). `evalCompoundAssignmentResult` routes
its RHS through the *same* bridge, so `x += cond ? 1n : 2n;` updates the tracked value exactly like
the plain-assignment spelling (previously the emitted code was already correct but the tracked value
stayed NAC — sound, needlessly missed). A ternary whose condition depends on a NAC name declines
naturally; one resolved via the `if`/`else` merge uses the already-merged value; one inside a bailed
function is never reached.

**SOURCE.** `compiler/src/ts-frontend.ts` (`substituteLocalReads`, `evalLocalConst`,
`evalCompoundAssignmentResult`).

**PORTING (P1).** One bridge, consulted by every value-producing site — do not add a second lookup
path for ternaries.

---

# Category U — loop unrolling

**Placement correction, verified against source:** loop unrolling lives **exclusively** in
`compiler/src/ts-frontend.ts`, gated behind `tsSource: true` or a `.ts` import. The acorn core has
none: `processor/statement.ts`'s `processForStatement`/`processWhileStatement` always emit real
runtime loop bytecode (`saucer.for(...).loop(...)` / `saucer.while(...).loop(...)`, i.e.
`JUMP_BACK`). A grep for `unroll` under `compiler/src/processor/` finds one hit — a comment in
`inline.ts` pointing *out* to `ts-frontend.ts`. Plain `.js`/`.sauce` sources never unroll anything.

### U1. Numeric `for` unrolling

**WHAT.** `for (let i = <const>; i <cmp> <const bound>; <step>)` unrolls into N copies of the body
with the counter substituted by its per-iteration literal. Accepted steps: `i++`, `i--`, `i += s`,
`i -= s`, `i = i + s`, `i = i - s`. The bound may be a literal or a same-file const.

**EXAMPLE.**
```ts
const N = 3n;
for (let i = 0n; i < N; i++) { total += FEES[i]; }   // → three literal-indexed statements
```

**EDGE / BAIL (all fall back gracefully to real `JUMP_BACK` runtime code).** Direction sanity: a
forward comparison (`<`/`<=`) needs a positive step, backward needs negative — a mismatch bails
rather than looping forever. Step resolving to 0 bails. `bodyBlocksUnrolling` bails on a body
containing `break`/`continue`/`return` or redeclaring the counter name. Over
`MAX_UNROLL_ITERATIONS` (256) bails. Output colliding with surrounding declarations bails (TS7's
guard — the confirmed crash was a body declaring any *other* local, e.g. `let doubled = i * 2n;`,
unrolling into N same-named declarations in one scope). Each unrolled iteration **re-enters** the
fold pass, so a nested `if`/inner loop keyed on the counter cascades to fully-resolved literals.

**SOURCE.** `compiler/src/ts-frontend.ts` (`tryUnrollForLoop`, `unrollCountingLoop`, `extractStep`,
`bodyBlocksUnrolling`, `substituteCounter`, `MAX_UNROLL_ITERATIONS`).

**TARGETS.** all.

**PORTING (P1).** Standard technique; keep the 256 cap and the graceful (never fatal) fallback.

### U2. `while`-counting-idiom unrolling

**WHAT.** The `while` spelling of the same idiom: the **statement pair**
`let i = <const>; while (i <cmp> bound) { …; i +/- step; }` — increment as the body's own **last**
statement — recognized at the statement-**list** level, since eliding a pair to produce N statements
cannot be expressed by a single-node visitor.

**EDGE / BAIL.** Unrolling **elides the counter declaration entirely**, so it only fires when nothing
after the loop still reads the counter (scanned via `referencesIdentifier` over the remaining
statements) — a "found index" pattern correctly keeps its loop. Shares U1's cap, body checks, and
collision guard. Interaction with TS11 is race-free (see TS11).

**SOURCE.** `compiler/src/ts-frontend.ts` (`tryUnrollCountingWhile`, `foldStatementList`).

**TARGETS.** all.

**PORTING (P2).** Pure ergonomics — the user can always write the `for` form.

### U3. `for...of` unrolling over a tracked array table

**WHAT.** `for (const x of ARR) { … }` over a TS12-tracked array table unrolls to one body copy per
element, the loop variable substituted by its literal, cascading into nested `if`/loops/table
accesses exactly like U1.

**EDGE / BAIL — a harder failure than U1/U2.** Plain acorn has **no `ForOfStatement` handling at
all** (`compile()` throws `not implemented: ForOfStatement` outright), so unrolling is what makes
`for...of` compilable *at all* — there is no runtime-bytecode fallback. Therefore a decline is a hard
error, not suboptimal code: a table with more than 256 elements still throws
`not implemented: ForOfStatement` even with `tsSource: true`. Also declines: `for await...of`, a
destructured loop variable (single plain identifier only), a body `bodyBlocksUnrolling` rejects, and
a `for...of` sitting in a single-statement slot (an un-braced `for`/`if` body) rather than a genuine
statement list. Iterating an array table this way is always a safe read-only use, so it never
disqualifies the table from tracking regardless of whether *this* loop unrolls.

**SOURCE.** `compiler/src/ts-frontend.ts` (`tryUnrollForOfArrayTable`, `visitStatementList`).

**TARGETS.** all.

**PORTING (P1).** Decide explicitly: either implement real `for...of` codegen, or reproduce this
"only ever via unrolling, hard error past the cap" limitation.

### U4. Statement-list splice drivers + the 256 cap

**WHAT.** Two list-level drivers exist because every unroll replaces one/two list entries with N:
`foldStatementList` (numeric + while idiom) and `visitStatementList` (`for...of`). Both operate on
`Block.statements` / `SourceFile.statements`. `MAX_UNROLL_ITERATIONS` = 256 bounds emitted bytecode
growth; TS13's `MAX_FOLDED_ARRAY_ELEMENTS` is a *separate* constant with the same value bounding a
different thing (tracked elements), and TS14's is deliberately smaller (64).

**SOURCE.** `compiler/src/ts-frontend.ts` (`foldStatementList`, `visitStatementList`,
`MAX_UNROLL_ITERATIONS`).

**PORTING (P0 within this category).** Splicing, the collision guard (TS7), and the caps are shared
infrastructure — implement once and reuse across all three unrollers, as the TS version does.

---

# Category I — inline (arrow-const) functions

Motivation, from the real recipe files: small pure-arithmetic guard-clause helpers
(`tickArg`/`kyberOut`-shaped: nested `if (cond) { return X; } … return Y;`, no loops) were being
hand-duplicated at each call site. Inline functions make that a language feature. **Entirely
additive** — a plain `function NAME() {}` is unaffected.

### I1. Declaration convention + extraction

**WHAT.** A top-level `const NAME = (params) => body;` (concise or block body, `export const`
included) marks `NAME` inline: every call site — same file, or cross-file via the source-import
mechanism (M1) — is spliced in at compile time instead of emitting a `CALL_FUNCTION` / function-table
entry.

**EXAMPLE.**
```js
const tickArg = (tick, offset) => {
  if (tick < 0n) { return (tick + offset) | HIGH_MASK; }
  return tick + offset;
};
function main(t) { return tickArg(t, 5n); }   // spliced; no CALL_FUNCTION emitted
```

**EDGE / BAIL.** A concise `=> expr` body normalizes to `[ReturnStatement(expr)]`. Every parameter
must be a plain identifier (no destructuring/defaults). `RESERVED_NAMES` collisions and duplicate
inline names are rejected at extraction time; a real function colliding with an inline name is
rejected in the same namespace check as imports (M1).

**SOURCE.** `compiler/src/processor/inline.ts` (`extractInlineDeclarations`, `InlineFnEntry`).

**TARGETS.** all — expansion is a pure AST→AST rewrite that runs strictly **before** the target fork,
so neither backend is inline-aware.

**PORTING (P1).** Keep it target-agnostic: do not leak inline-awareness into any emitter.

### I2. Validation / bail conditions (fail closed, as compile errors)

**WHAT.** `validateInlineable` enforces a strict **allowlist** of statement kinds inside an inline
body: `VariableDeclaration` (plain identifier target), `IfStatement`, `ReturnStatement`,
`ExpressionStatement`, `ThrowStatement`.

**EDGE / BAIL — every one is a clear compile error, never a silent fallback.**
- A `for`/`while` loop, `switch`, `try`/`catch`, labeled or bare-block statement, destructuring
  parameter/declaration, or a nested function/arrow anywhere in the body (deep-scanned by
  `assertNoNestedFunction`) — the error names the construct and points at using a real `function`.
- An inline call in a `for`/`while` **header** (init/test/update) — single-expression slots that
  cannot host a multi-statement splice. Inside the loop **body** is fine.
- An inline call in a **ternary branch** or the RHS of `&&`/`||` — conditionally evaluated, so
  unconditional hoisting would be exactly the unsoundness I3's return-elimination exists to avoid.
- A callee that does not terminate (return/throw) on every path, **unless** the call is a bare
  discarded statement (a validate-or-revert helper is fine there).
- More than `MAX_INLINE_EXPANSIONS` (4096) total expansions in one compile — bounds a non-cyclic but
  exponentially fanning "diamond" DAG that would otherwise take minutes or crash V8 with a
  `RangeError` from spreading a huge array.
- Direct or mutual recursion, including a cycle routing through a real function (I4).

**SOURCE.** `compiler/src/processor/inline.ts` (`ALLOWED_INLINE_STATEMENTS`, `bail`,
`assertNoNestedFunction`, `validateInlineable`; the header/ternary/`&&`-`||` bails live in
`hoistExpr`/`hoistStatementOwnExprs`).

**PORTING (P0 within this category).** Get the allowlist right; the numeric cap value is tunable but
*some* cap must exist.

### I3. Splicing algorithm — hygiene, hoisting, return-elimination

**WHAT.** Per call site: (1) evaluate each argument **once**, binding it to a fresh
`#inline_p_<id>_<param>` const (matching normal call semantics even if the callee reads a parameter
twice); (2) **alpha-rename** every local the callee introduces to `#inline_l_<id>_<name>`;
(3) **return-elimination** — rewrite `return expr;` to
`#inline_result_<id> = expr; #inline_done_<id> = 1;`, and for an `if`/`if-else` containing a return,
recurse into each branch and wrap everything textually **after** the `if` in
`if (#inline_done_<id> === 0) { … }`.

**EDGE / BAIL.** The `#` prefix can never collide with a user-typable identifier (acorn rejects a
bare `#name` outside a class body) — the same convention `ctx.freshTemp()` uses for `#tmp<N>`.
The done-flag shape is what handles guard clauses **without** unconditionally hoisting a branch-only
computation (a rejected earlier design hoisted a callee's guarded local out of its `if`, which can
silently compute a wrapping/underflowing value on a branch that never runs). `hoistExpr` pulls a
**nested** inline call out of a value position into preceding statements, innermost-first /
left-to-right (normal JS argument order), replacing it with its `#inline_result_N` — which is why an
inline function calling another inline function expands regardless of declaration order.
`expandStatementList` drives `main` and every real function body, recursing into nested
`if`/`for`/`while` bodies; a bare discarded inline-call statement collapses entirely into its
generated statements. A `.catch(handler)` body is routed through the statement-list engine rather
than expression hoisting, so inline calls inside a catch handler expand correctly.

**SOURCE.** `compiler/src/processor/inline.ts` (`hoistExpr`, `eliminateReturns`,
`hoistStatementOwnExprs`, `expandStatementList`, `expandInlineCall`, `collectLocalDeclNames`,
`renameExpr`/`renameStatement`/`renameBlock`, the `make*` node builders,
`buildInlineMap`, `expandInlineFunctionsInDeclarations`).

**TARGETS.** all.

**PORTING (P1, high implementation care).** Preserve: the guaranteed-collision-free renaming scheme
(a gensym/de Bruijn approach is fine and probably better than textual `#` names); the
done-flag+result-var shape (specifically: a branch's computation is *not* unconditionally hoisted);
evaluate-arguments-once, left-to-right; innermost-first hoisting.

### I4. Recursion / cycle detection

**WHAT.** One combined call graph over **both** inline and real functions
(`collectKnownCallees` walking every `CallExpression` with a bare-identifier callee in the combined
name set), with a gray/black DFS cycle detector.

**EDGE / BAIL.** A cycle is rejected **only if it touches at least one inline function** — a cycle
entirely among real functions is ordinary supported runtime recursion, bounded by gas, and is left
alone. This is what catches `inline A → real B → A`: no direct inline→inline edge, but genuinely
unbounded compile-time splicing.

**SOURCE.** `compiler/src/processor/inline.ts` (`collectKnownCallees`, `detectInlineRecursion`).

**PORTING (P0 within this category).** A missed cycle is a hang, not a missed optimization; and
over-rejecting would break working recursive programs.

### I5. Dynamic-return placeholder seeding (`couldReturnBeDynamic`)

**WHAT.** `#inline_result_N` is one variable shared across every reachable `return`, so its first
declaration needs an initializer before any real value is known. Seeding it with the scalar literal
`0n` broke **every dynamic-returning inline function** once K8's v1 reassignment guard landed (the
guard correctly refused to re-class the sentinel scalar→dynamic). Fixed by a conservative, ctx-free
scan of the callee's pre-splice return expressions (mirroring K4's OR-across-all-returns rule): when
it might return dynamic, seed with `makeDynamicPlaceholder()` (an empty string literal — any dynamic
value's storage kind is generic, so the shape is irrelevant).

**EDGE / BAIL.** `exprCouldBeDynamic` is biased to **`true`** for anything not provably scalar (a
call of any kind, a property/index base of unknown kind). Recognized-scalar: numeric/boolean
literals, arithmetic/logical/unary composition of scalars, a ternary with both branches scalar, and —
critically — an indexed/property access is **always** scalar regardless of its base (reading an
element or count never yields the container's descriptor). A parameter returned unchanged is checked
against the actual **call-site argument**, but a bare identifier argument is deliberately left
scalar-seeded to avoid regressing the motivating `tickArg(shifted, OFFSET)` shape. **Residual
accepted gap:** identity-style passthrough of an existing dynamic caller-scope local
(`identity(arr)`) still hits K8's guard — narrower than the original bug and still safe (a clear
compile error, never a silent drop). Confirmed on the pre-guard commit that this exact source
compiled and then reverted `SauceInvalidOperationArgs(0x97)` on real EVM execution — the guard was
catching a real silent drop; only the sentinel's classification was wrong.

**SOURCE.** `compiler/src/processor/inline.ts` (`couldReturnBeDynamic`, `bodyCouldReturnDynamic`,
`exprCouldBeDynamic`, `makeDynamicPlaceholder`).

**TARGETS.** v1-motivated; the seeding runs unconditionally and is harmless on v12/svm (K1).

**PORTING (P2).** Only meaningful alongside K8. Keep the bias direction: over-promote to dynamic
(costs a heap slot), never under-promote (drops a descriptor).

### I6. Known gap — unreachable inline functions are validated eagerly

**WHAT.** `validateInlineable`/`detectInlineRecursion` run over **every** declared inline function up
front, before treeshake — so an inline function never reachable from `main()` still fails the whole
compile if it violates a bail condition or participates in a cycle. An unreachable **real** function
is silently dropped by T1 before it is ever compiled.

**EDGE / BAIL.** Left as-is deliberately: a correct fix must also make the splicing pass skip
unreachable declarations, since gating only *validation* would trade a clean error for a possible
hang while splicing a genuinely recursive unreachable function.

**SOURCE.** `compiler/src/processor/inline.ts` (`expandInlineFunctionsInDeclarations`), contrasted
with `compiler/src/processor/index.ts` (`treeshake`).

**PORTING (P3).** Fail-closed and eager; acceptable, but a port ordering inlining after reachability
should handle both together.

---

# Category M — source-file imports, arm selection, module resolution

*(This subsystem is not described in `CLAUDE.md`; the entries below are grounded directly in source.)*

### M1. Source-file function imports + recursive collection

**WHAT.** `import { fn } from "./mod"` pulls `FunctionDeclaration`s (and inline arrow-consts, I1)
out of another SauceScript/TS module into the **same function table** as the importing program's own,
recursively through transitive imports.

**EDGE / BAIL.**
- Resolution first tries `ctx.resolveModuleSource`; `undefined` means "not a module" and the import
  falls through to the `.json` ABI path (C1). A `.json` specifier is *never* a module.
- **Dedup** by `mod.dedupKey ?? mod.filePath` in a `visited` set — a module imported by two parents
  is parsed once. `dedupKey` is the arm-agnostic **neutral** identity (M2).
- Recurses into the imported module's own imports **first**, so a transitive function/contract is
  registered before the importing module's own functions.
- `main` in any imported module is a hard error:
  `imported module "<f>" must not define main()`. (This is also what makes TS14's `main`-only fold
  unreachable through the import seam.)
- A duplicate function name across two **different** modules is an error naming both files; a repeat
  of the same module is a silent skip. The same namespace covers inline declarations.
- `.ts`/`.sauce.ts` modules run through `tsPartialEval` automatically unless
  `ctx.transformModule` overrides it; `.js`/`.sauce`/`.mjs` parse as-is. A parse failure on a
  non-`.ts` module adds the hint "if it is TypeScript, pass options.transformModule".

**SOURCE.** `compiler/src/processor/index.ts` (`collectImportedFunctions`,
`extractFunctionDeclarations`), `compiler/src/context.ts` (`resolveModuleSource`).

**TARGETS.** all.

**PORTING (P0).** Recursion order, dedup identity, and the shared name namespace (real + inline) are
the three things that silently corrupt a function table if got wrong.

### M2. Per-target arm selection

**WHAT.** For each candidate root, resolution tries **target-arm siblings before the neutral
candidate**: with `target: 'v12'`, `./token.js` probes `./token.v12.js` first, then the other
extensions' arms, then the neutral candidates in fixed order
(`MODULE_EXTS = ['.ts', '.sauce.ts', '.js', '.sauce', '.mjs']`). The arm for a *different* target is
never read from disk. This is the machinery a "universal interfaces" source tree relies on.

**EDGE / BAIL.** Probing is **per-root** (arm-then-neutral within each root, then the next root) —
not all-roots-for-arm then all-roots-for-neutral. When an arm wins, `dedupKey` is the resolved
neutral sibling's path if one exists on disk (`findNeutralPathForKey`, a path-only `statSync` probe
scanning the same order), else a textual fallback `stripArmToken(filePath, target)` (strips the
literal `.<target>.` token before the module extension). `dedupKey` is omitted when the neutral
candidate itself won (the common back-compat case).

**SOURCE.** `compiler/src/context.ts` (`resolveInRoots`, `MODULE_EXTS`, `findNeutralPathForKey`,
`stripArmToken`).

**TARGETS.** all (the point is per-target divergence).

**PORTING (P1).** Get the probe order and the neutral-identity dedup right: a wrong `dedupKey` either
double-registers a shared module (spurious duplicate-name error) or lets two arms silently diverge.

### M3. Bare-specifier / node_modules resolution

**WHAT.** A bare specifier that fails the ordinary path probe is interpreted as a package: walk **up**
from each root looking for `<dir>/node_modules/<pkg>` (`statSync` follows symlinks, so pnpm's
`.pnpm` links resolve), then read `<pkgDir>/package.json` and resolve the entry —
`exports` (the `"."` subpath, then the first present of `import`/`node`/`default`, recursing through
nested condition objects) → `module` → `main` → literal `'index.js'`. The entry is then resolved
through the same `resolveInRoots`, so it also gets arm selection (M2).

**EDGE / BAIL.** A path-based resolution always wins over the package interpretation (preserved
pre-existing behavior). Scoped packages consume two segments; a **subpath** import (`pkg/sub`) is
rejected (`import the package root`), as is a scoped specifier missing its `/name`. `normalizeEntry`
folds `.`/`..` segments **string-level on the entry value itself** (never resolve-then-compare) and
rejects an absolute entry or one climbing above the package root before touching disk. A package that
is simply not installed returns `undefined` and falls through to the `.json`-ABI error path, but a
package that *exists* and then fails (subpath, escaping entry, unresolvable entry) **throws** — a
config error should not masquerade as "file not found". The discovered package dir becomes an
additional allowed root, so the package's own internal imports resolve inside it even if it sits
above every `baseDir`. The `exports` support is a deliberately non-exhaustive Node subset (arrays,
non-`.` top-level keys, null, numbers → fall through to `module`/`main`).

**SOURCE.** `compiler/src/context.ts` (`resolvePackage`, `findPackageDir`, `packageEntry`,
`exportsEntry`, `normalizeEntry`).

**PORTING (P2).** Port the *subset*, not Node's full algorithm, and keep the
"exists-but-broken throws, missing falls through" distinction.

### M4. Escape-root guard

**WHAT.** If a specifier contains a literal `..` segment, every candidate resolution must land inside
one of the allowed roots (the caller's `baseDirs`, resolved absolute, plus any discovered package
dir); otherwise `import "<s>" escapes the project root`.

**EDGE / BAIL.** A specifier with **no** `..` short-circuits the check entirely (so an ordinary
non-relative import behaves exactly as before roots existed). A `..` that stays inside a root (a
subdirectory module importing `../shared.js`) is fine. An **absolute** specifier is rejected outright
by `resolveModuleSource` before any of this.

**SOURCE.** `compiler/src/context.ts` (`assertDoesNotEscapeRoots`, `resolveModuleSource`).

**PORTING (P1).** Presence-of-`..` gating is intentional, not an optimization.

---

# Category C — contracts, ABI binding, capability gate

### C1. ABI JSON contract imports

**WHAT.** `import { ERC20 } from "./ERC20.json"` registers the ABI under the local name as a
`ContractInfo` — methods parsed into a `Map<name, MethodInfo>` with 4-byte selectors computed as
`keccak256("name(t1,t2,…)")[0..4]`, canonical type strings built by `formatType` (recursing into
`.components` for `tuple`/`tuple[]`).

**EDGE / BAIL.** The file must be either a bare ABI array or a build artifact with an `.abi` field
(forge/hardhat/OZ shapes) — otherwise `import "<s>" does not contain an ABI.` **Exactly one**
binding name per `.json` import, checked *before* the file is read
(`a .json ABI import binds exactly one`); a source-file import may bind N. Re-import is **idempotent
if structurally identical** (`abisEqual`/`canonicalJson`, key-order-independent) and otherwise throws
`Conflicting ABIs registered for "<name>".` `registerContract` itself additionally throws on a
duplicate name. Only `function` ABI items are used — events/errors/constructor/fallback/receive are
typed but ignored.

**SOURCE.** `compiler/src/contracts.ts` (`formatType`, `computeSelector`, `parseAbiMethods`,
`hexToBytes`), `compiler/src/processor/index.ts` (`processImportDeclaration`),
`compiler/src/context.ts` (`registerContract`, `lookupContract`).

**TARGETS.** registration is target-agnostic; every *call* built from it is EVM-only (C6).

**PORTING (P0).** Selector computation and the tuple-recursive canonical type string must match
byte-for-byte — dispatch depends on it.

### C2. `.at()` / `.view()` / `.lib()` binding + method-call lowering

**WHAT.** Three call shapes, one lowering path:

```js
Pool.at(addr).slot0()             // inline chain — auto: CALL, or STATICCALL for view/pure
let p = Pool.at(addr); p.slot0(); // standalone binding, then variable-bound calls
Pool.view(addr).slot0()           // force STATICCALL
Pool.lib(addr).slot0()           // force DELEGATECALL
```

Calldata = `selector ++ abiEncode(tuple(args))` (or bare selector for a zero-arg method). Call type:
explicit override wins, else `view`/`pure` `stateMutability` → static, else a plain external call.
Output decoding is driven by an `OutputSpec` (`count`, `typeSpecs`).

**EDGE / BAIL.** Unknown contract (`Unknown contract: <n>`), unknown method
(`Unknown method "<m>" on contract "<c>"`), arity mismatch. `.at/.view/.lib` outside a chain requires
exactly one argument (the address). A standalone binding is recorded via
`setPendingContractBinding` and finalized by `consumePendingContractBinding(varName)` when the
enclosing store completes — a **single-slot** pending mechanism, so it is only valid during the real
sequential compile pass; `matchStandaloneBindingShape` is a side-effect-free sibling used by the
return-kind pre-pass (K5). `resolveContractCallTarget` is a **non-emitting** resolver shared by the
call path, the destructuring lowering (K10), and K5/K7, so `method.outputs` can be inspected before
committing to emit; `emitRawContractCall` emits without output decoding.

**SOURCE.** `compiler/src/processor/expression.ts` (`BINDING_METHODS`, `resolveInlineChain`,
`resolveContractCallTarget`, `processContractCall`, `resolveStandaloneBinding`,
`matchStandaloneBindingShape`, `resolveVariableBoundCall`, `emitRawContractCall`,
`processCallExpression`'s dispatch order), `compiler/src/context.ts` (`boundContracts`,
`pendingContractBinding`).

**TARGETS.** v1 + v12; **rejected on svm** (one `assertCapability(ctx, 'contract bindings')` in
`processContractCall` covers every shape).

**PORTING (P0).** One capability check at the single emit site covers all four call shapes — keep
that funnel rather than gating each shape.

### C3. Struct-arg reordering + static-tuple flattening

**WHAT.** SauceScript stores object literals **alphabetically**, but ABI encoding needs the ABI's
**declared component order** — `processAbiArg`/`orderedStructTuple` recursively reorder an
object-literal struct argument to match, and per-element for a `tuple[]` argument.

**EDGE / BAIL.** Additionally, a component that is itself a **fully static nested tuple** is
**flattened** into the parent tuple — sidestepping a v12 Huff `ABI_ENCODE` bug that only scans one
level deep for dynamic-ness. Every tuple component must be a **named** field
(`ABI tuple components must be named to encode an object literal`), every field must be present
(`missing struct field '<f>' in object literal`), and spread properties are rejected. Historical
note: before this, fields were sorted alphabetically at the call boundary too, which scrambled a
nested `PoolKey` and produced an empty revert.

**SOURCE.** `compiler/src/processor/expression.ts` (`processAbiArg`, `isStaticAbiParam`,
`flattenStaticStructFields`, `orderedStructTuple`).

**TARGETS.** v1 + v12.

**PORTING (P0).** Do **not** emit nested tuples for all structs; the selective flattening is
engine-quirk-driven and correctness-critical on v12.

### C4. `.catch(handler)` chaining

**WHAT.** `Pool.at(addr).transfer(to, amt).catch(() => { … })` (and the same on a variable-bound call
or a raw `contract.call/static/delegate`) catches a revert without failing the transaction. The
handler's parameter, if present, is declared `dynamic`; the wrap is
`store(param, callOnly, 'dynamic').catch(handler)` or `join(callOnly).catch(handler)`.

**EDGE / BAIL.** The raw call must be emitted **without output decoding**, immediately followed by
`CATCH` — an engine adjacency requirement; do not decode-then-catch. At most one handler parameter,
which must be a bare identifier. `.catch()` on anything other than a contract call or raw call op →
`.catch() can only be used on contract calls`. Handler bytes are length-prefixed with a single byte,
so a handler over 255 bytes throws. **The handler is compiled against the same `CompilerContext`** as
its surrounding code — a real closure-sharing mechanism (not a JS-style no-op), which is precisely
why TS15 and TS13 must bail on nested scopes touching outer locals.

**SOURCE.** `compiler/src/processor/expression.ts` (`resolveCatchChain`, `processCatchCall`,
`declareCatchParam`, `buildCatchSaucer`, `resolveVariableBoundCatch`, `resolveRawCallCatch`),
`compiler/src/saucer/saucer.ts` / `saucer-v12.ts` (`catch`).

**TARGETS.** all (raw-call catch works on svm; a *bound-contract* catch inherits C2's EVM gate).

**PORTING (P1).** The "same context" semantics is load-bearing for two other features' soundness.

### C5. `CompileOptions.contracts` (`ContractsConfig`)

**WHAT.** `compile(src, { contracts: { Pool: { abi: poolAbi } } })` pre-registers ABIs
programmatically — the source then needs no `import` for `Pool`.

**EDGE / BAIL.** Registration happens in the `CompilerContext` constructor, strictly before any AST
walk, using the same `registerContract` the import path uses. A later `.json` import of the same name
hits `processImportDeclaration`'s idempotency check: structurally identical → no-op, different →
`Conflicting ABIs registered`.

**SOURCE.** `compiler/src/contracts.ts` (`ContractConfig`, `ContractsConfig`),
`compiler/src/context.ts` (constructor).

**PORTING (P2).** Trivial; just keep the ordering (before the walk) and the shared registration path.

### C6. The bidirectional capability gate

**WHAT.** One data-driven table, `TARGET_CAPABILITIES`, of which named features are restricted to a
**subset** of targets — checked in both directions (EVM-only, SVM-only, and one v12-dialect-only
row):

| Feature | Allowed | Hint / note |
| --- | --- | --- |
| `storage.read` / `storage.write` | v1, v12 | → `accountData` / `writeAccountData` |
| `create`, `create2`, `create3`, `createAddress`, `create2Address`, `create3Address` | v1, v12 | svm engine raises `UnsupportedOpcode` |
| `delegatecall` | v1, v12 | |
| `contract bindings` | v1, v12 | → `contract.call(target, calldata, accounts)` |
| `array destructuring` | v1, v12 | → read `contract.call` returndata via `slice()`/`uint()` |
| `accountData`, `writeAccountData`, `accountUint` | svm | |
| `accounts list` | svm | that operand is raw calldata bytes on EVM |
| `uint` | v12, svm | v1's builder has no cast surface |

**EDGE / BAIL.** Deliberately **not** a pre-codegen IR pass — there is no IR — so `assertCapability`
is called **at the emit sites**, which means a gated feature inside an already-dead branch (pruned by
folding, `defines`, or treeshake) correctly never fires. `deriveMessage` produces three phrasings
from (allowed set, current target) alone, with a bespoke `message` override where needed;
`UnsupportedTargetError` carries `feature`/`target`/`supported` plus an optional AST span (the nine
builder-layer call sites have no node in scope, so their spans are undefined). An **unregistered**
capability key is itself a hard internal error (`add a TARGET_CAPABILITIES row`) — fail fast rather
than silently pass. `SVM_GATED_HINTS` is **re-derived** from the table (every row not containing
`'svm'`) so `svm-profile.ts`'s `SVM_GATED` export has a single upstream source.

**Explicitly NOT gated** (with an over-gating guard test both ways): `abi.encode`/`abi.decode`,
`emit`/`LOG`, `crypto.*`, `msg.*`, `block.*`, `tx.*`, `address.*`, `gasLeft`/`blockHash`/`blobHash`,
`storage.tRead`/`tWrite`, `eval`, `Math.*`, `Uint8Array.from`. The file's own comment warns against
"completing" the table with any of these.

**Call sites.** `processor/expression.ts` (`contract bindings`); `processor/statement.ts`
(`array destructuring`, with a real AST span); `globals.ts` (`accounts list`, `delegatecall`, `uint`,
`accountData`, `writeAccountData`, `accountUint`); and `saucer/svm-profile.ts`'s
`assertSvmSupported` delegate for the nine builder-layer sites (CREATE family + delegate).

**SOURCE.** `compiler/src/capabilities.ts`, `compiler/src/saucer/svm-profile.ts`.

**TARGETS.** this *is* the target-differentiation mechanism.

**PORTING (P0).** Port the negative list as seriously as the positive one — over-gating `abi.encode`
or `msg.*` on svm would be a regression, and the TS side has a test enforcing both directions.

### C7. `SVM_UNSUPPORTED` + the svm profile

**WHAT.** `svm-profile.ts` is the single reference for how `svm` differs from the EVM v12 dialect:
the same postfix opcode table, with (a) **unsupported** ops — the CREATE family (0x82–0x87) and
`DELEGATE` (0xA4), which the engine rejects at runtime and the compiler therefore rejects at
emission; (b) **divergent shapes** — `CALL`/`STATIC` take `(target, calldata, accounts[])` with no
value operand (0-based indices into the execute instruction's user-account slice after the 3 engine
PDAs; 64-account CPI cap), `SLOAD`/`SSTORE` become account-data read/write; (c) **divergent
lowering** — `uint()` → `CAST_BE` on v12, `CAST_LE` on svm.

**EDGE / BAIL.** Everything else passes through: the engine has fork-parity analogues for chain ops,
LOG, keccak, the ABI codec, `EVAL`, `CATCH`, `TLOAD`/`TSTORE`. Two documented runtime caveats:
`EVAL` runs in static mode (no CPI inside eval'd code), and `CATCH` intercepts only **pre-flight**
CPI failures — once `invoke()` launches, a failing callee aborts the transaction.

**SOURCE.** `compiler/src/saucer/svm-profile.ts` (`SVM_UNSUPPORTED`, `SVM_GATED`,
`assertSvmSupported`).

**PORTING (P1).** Keep one profile document/table per divergent target rather than scattering
`if isSvm` checks.

---

# Category K — storage-kind (scalar vs dynamic) & return-kind inference

The largest and most bug-history-laden area. Nine distinct instances of one bug class were fixed
here, several found only by a second round of adversarial audit *after* the "obvious" fix landed and
was tested. Read K1 first — it explains why a wrong answer is fatal on v1 and inert on v12/svm.

### K1. The scalar-vs-dynamic storage-kind model

**WHAT.** Every variable carries a `VariableKind`: `'scalar'` (a 32-byte value slot,
`WRITE_VALUE`/`READ_VALUE`) or `'dynamic'` (a heap slot, `WRITE_HEAP`/`READ_HEAP`). Choosing wrong is
the whole subject of this category.

**Why it is fatal on v1.** v1 represents a dynamic value **out of band**: the descriptor lives in
`ctx.dynamicResult`, and only the returned `bytes32` goes into a value slot. So a scalar store of a
dynamic value **destroys the descriptor** — the word actually persisted is the array's byte *length*
(96 for 3 elements), not a descriptor. A later `arr[0]` reverts
`SauceInvalidOperationArgs(0x97)` (`INDEX`) and `arr[0] = x` reverts `0x9b` (`SET_INDEX`). The
reverse direction is **safe**: `_writeHeap` stores a non-dynamic result as a plain `BYTE_32`
primitive and `_readHeap` decodes it straight back, so a scalar survives a heap slot losslessly.
**Hence the universal rule in this category: when unsure, promote to dynamic.**

**Why it is inert on v12/svm.** `V12Saucer.store` **ignores its `_kind` parameter entirely** and
derives the real kind from `value.isDynamic` on the value node; a dynamic value there is a single
in-band 32-byte descriptor word, and `do_write_value`/`do_write_heap` are byte-for-byte the same
`mstore`, differing only in memory region — so storing a descriptor in a value slot round-trips
losslessly. The kind tag is largely **dead metadata** on v12/svm. This asymmetry (identical source,
v1 reverts, v12/svm works) is the decisive evidence that these defects were compiler-side, not
engine-side.

**SOURCE.** `compiler/src/context.ts` (`VariableKind`, `Variable`), `compiler/src/saucer/memory.ts`
(`encodeReadByKind`/`encodeStoreByKind`), `compiler/src/saucer/saucer-v12.ts` (`store`, `read`).

**PORTING (P0).** Before porting K2–K15, **verify the target engine's memory model**. If it has no
value-slot-vs-heap-descriptor asymmetry (e.g. a uniform tagged representation, or the v12-style
in-band descriptor), most of this category is unnecessary complexity. If it *does*, port the whole
family — and prefer a structural fix: make it impossible to call the store codegen without threading
a kind produced by **one** canonical dispatcher, instead of the current "several call sites, each
remembering the right combination of helpers".

### K2. `inferKind` — ctx-free baseline classifier

**WHAT.** The fallback whenever nothing more specific applies: string `Literal` → dynamic;
`ArrayExpression`/`ObjectExpression`/`TaggedTemplateExpression` → dynamic; `NewExpression` → dynamic
(both `new Array(n)` — a TUPLE descriptor — and `new Uint8Array(...)`); `CallExpression` →
`inferGlobalCallKind` (a GLOBALS-table lookup) or dynamic if the method is in `DYNAMIC_METHODS`
(`concat`, `slice`) else scalar; anything else → scalar.

**EDGE / BAIL.** `new Array(n)` → dynamic is itself the **first** documented fix in this family:
scalar storage dropped the TUPLE descriptor, breaking `let a = new Array(n); a[i]` round-trips.

**SOURCE.** `compiler/src/processor/inference.ts` (`inferKind`, `DYNAMIC_METHODS`,
`inferGlobalCallKind`, `isDynamicMethod`, `isGlobalProperty`).

**TARGETS.** all (baseline).

**PORTING (P0).** Deliberately simplistic — do not "improve" it without also porting K3–K11, or you
reopen one of the nine instances.

### K3. `inferKindWithContext` — context-aware classifier

**WHAT.** Three special cases layered on K2, in order: (1) **Identifier** → the source variable's own
tracked kind (`ctx.getVar(name)?.kind`) — ground truth, which fixes plain aliasing
(`const a = new Array(3); let b = a;`, previously scalar and reverting with no call involved);
(2) **`CallExpression`** to a same-file function → `ctx.getFunctionReturnKind(name)` (K4);
(3) **`MemberExpression`** → computed access consults `lookupIndexedElementType`, a nested-struct
field access is always dynamic, a plain `object.property` consults the GLOBALS table.

**EDGE / BAIL.** Anything not Identifier/Call/Member falls straight through to K2. Structurally it
**cannot** see every store site — a ternary bypasses it entirely (K11), and a direct contract call
needs K7 — which is why the rest of this category patches around it in `statement.ts` rather than
inside it.

**SOURCE.** `compiler/src/processor/inference.ts` (`inferKindWithContext`).

**PORTING (P0).** The main dispatch point; the "cannot see every site" limitation is the reason the
family exists.

### K4. `analyzeFunctionReturnKinds` — the fixpoint pre-pass

**WHAT.** Computes every declared function's return kind **before any body is compiled**, so
`let arr = helper();` infers dynamic when `helper()` returns e.g. a `new Array(n)` TUPLE — regardless
of declaration order.

**EXAMPLE.**
```js
function helper() { let arr = new Array(3); /* …filled at runtime… */ return arr; }
function main()   { let arr = helper(); return arr[0]; }   // must store arr as dynamic
```

**EDGE / BAIL — why a fixpoint, not one pass.** Recording kinds while compiling bodies is
declaration-order dependent: a caller declared *before* its dynamic callee would see the pre-analysis
scalar default (confirmed reachable via a 3-level forward-reference chain). Instead: seed every
function `'scalar'`, only ever **promote** to `'dynamic'` (monotone, height-1 lattice), iterating up
to `declarations.length + 1` passes (enough for an N-function chain in the worst order, plus one
no-change pass to detect convergence; mutual recursion converges and never exceeds the bound).

Per function, per pass, a **flat** (deliberately not per-branch-scoped) `Map<name, kind>` walks the
body in source order — flat because the real compiler shares scope across `if`/`while` bodies (L3).
A function's kind is the **union (OR)** across every reachable `return` — the sound direction (K1), so
a mixed-return function is safely over-classified dynamic. `kindOfExpr` resolves: an Identifier
against `locals`; a same-file call against the current fixpoint entry (never the ctx-free `inferKind`,
which has no notion of same-file functions); a direct single-dynamic-output contract call (K7's rule,
duplicated here); else `inferKind`.

Deliberately **not** modeled: per-parameter kinds — a function that merely returns one of its own
parameters stays scalar (K15).

**SOURCE.** `compiler/src/processor/return-kind.ts` (`analyzeFunctionReturnKinds`,
`functionReturnsDynamic`, `walkStatements`/`walkStatement`, `kindOfExpr`), wired in
`compiler/src/processor/index.ts` after treeshake and before the target fork;
`compiler/src/context.ts` (`SharedModule.returnKinds`, `setFunctionReturnKind`,
`getFunctionReturnKind`).

**TARGETS.** computed identically for all three; **fatal only on v1** (K1). v1 is verified fixed via
real EVM execution across: the motivating shape, mutation and read-only variants, plain aliasing,
reverse declaration order, a 3-level forward chain, a mixed-return helper, and all of those again
with `tsSource: true`. A scalar-returning helper compiles to byte-identical bytecode (negative
control) — this can only ever *widen* a kind.

**PORTING (P0 for a v1-shaped engine).** Preserve: monotone promote-only with the `n+1` bound; the
flat (not block-scoped) local map; running strictly before any body compiles, with the result shared
read-only.

### K5. Fixpoint `localBoundContracts` tracking

**WHAT.** The pre-pass runs against the bare module-level context, where `ctx.boundContracts` is
still empty (it is only populated on a per-function child context while really compiling, C2). So
`let pool = Contract.at(addr); pool.method();` inside a helper is invisible. Fixed with a **pass-local**
`localBoundContracts` map (never mutating the shared context), populated via the side-effect-free
`matchStandaloneBindingShape`, consulted by `resolveMethodTarget` after trying the real
`resolveContractCallTarget` (which handles the inline-chain shape).

**EDGE / BAIL — the audit fix.** The `AssignmentExpression` case originally never updated the map on
**reassignment** to a different contract, leaving the stale first binding for the rest of the
function even though the real compile stage updates correctly. Two confirmed failure modes: a
false-positive **compile crash** (`Unknown method "…" on contract "…"` thrown by the pre-pass for a
program the real stage accepts), and a **silent under-classification** when two contracts share a
method name but differ in output shape (confirmed via real EVM execution: `0x97` before, the correct
value after). Fixed by mirroring the declaration case — a new resolvable binding updates the map,
anything else **deletes** the stale entry. `applyDestructuringKinds` (K6) is deliberately left
untouched here because its conservative promotion already covers the same shape safely.

**SOURCE.** `compiler/src/processor/return-kind.ts` (`LocalBoundContract`, the `VariableDeclaration`
and `ExpressionStatement`/`AssignmentExpression` cases, `resolveMethodTarget`),
`compiler/src/processor/expression.ts` (`matchStandaloneBindingShape`).

**PORTING (P1).** Any port doing a pre-pass over an uncompiled AST hits the same "the real binding
table does not exist yet" problem — and needs invalidation-on-reassignment, not just insertion.

### K6. `applyDestructuringKinds`

**WHAT.** A destructuring declarator (`const [n, xs] = Contract.at(addr).method();`) has no single
initializer expression to classify, so each bound name gets its **own per-output ABI kind**
(`abiOutputKind`), mirroring what `processDestructuringDeclaration` (K10) does when it really compiles
the body.

**EDGE / BAIL.** Without this, an `ArrayPattern` declarator was skipped entirely, so a later
`return xs;` fell through `locals.get(name) ?? 'scalar'` and the helper's registered kind was wrong —
confirmed via real EVM execution (compiled cleanly, then reverted at `cook()`; the exact fault code
depends on the garbage bit pattern — `0x97` on a deployed-mock fixture, an arithmetic
underflow/overflow panic against an undeployed address; same root cause). Only the direct
`Contract.at(addr).method()` chain resolves this early; whenever the target cannot be resolved,
**every** bound name is conservatively marked dynamic (the "when unsure, promote" rule) — costing at
most an unused heap slot on a shape `processDestructuringDeclaration` would reject anyway.

**SOURCE.** `compiler/src/processor/return-kind.ts` (`applyDestructuringKinds`).

**PORTING (P1).** Required for completeness if K4 is ported; its cheaper fallback is intentional and
test-pinned, not a TODO.

### K7. `singleDynamicAbiOutputKind`

**WHAT.** `let xs = List.at(addr).list2();` where `list2()` returns exactly **one** dynamic ABI
component (e.g. `uint256[]`) is neither a multi-output call (K9 never applies) nor a same-file call
(K3 rule 2 never applies), so it fell through to K2's generic `CallExpression` → scalar. This helper
resolves the call target and returns `'dynamic'` **only** when exactly one dynamic ABI output is
found — never `'scalar'`. It is an **override**, consulted as
`singleDynamicAbiOutputKind(expr, ctx) ?? inferKindWithContext(expr, ctx)`.

**EDGE / BAIL.** Falls through unchanged for: an unresolvable target, a multi-output call, a
resolvable-but-scalar output, or a `.catch()` chain. Confirmed via real EVM execution against an
etched single-output mock: `xs[1]` reverted `0x97`, `xs.length` silently returned 32, and both faults
propagated through aliasing and through a helper that stores-then-returns — hence the **same rule is
duplicated in `kindOfExpr`** (K4), because fixing only the direct store site left the helper shape
misclassified.

**SOURCE.** `compiler/src/processor/statement.ts` (`singleDynamicAbiOutputKind`), consulted at the
plain store site and in `processTernaryStore`; mirrored in
`compiler/src/processor/return-kind.ts` (`kindOfExpr`).

**TARGETS.** v1 consequence; v12/svm bytecode unchanged.

**PORTING (P1).** Override-never-downgrade, applied at *every* store-decision site.

### K8. v1 scalar→dynamic reassignment rejection

**WHAT.** v1's `Saucer.store` always uses an **existing** variable's tracked kind once
`ctx.getVar(name)` finds one, silently ignoring a freshly computed kind — so `let x = 5n; x = arr;`
(and the `if (cond) { x = arr; }` and ternary-reassignment variants) compiled cleanly and then
dropped the descriptor at runtime (confirmed `0x97` on the later indexed read in every case). v1
cannot re-class a slot after declaration, so `rejectV1ScalarToDynamicReassignment` **rejects at
compile time** when `!ctx.isV12 && existing?.kind === 'scalar' && newKind === 'dynamic'`, with an
error explaining the fix (give the variable a dynamic value on its *first* assignment).

**EDGE / BAIL.** The reverse direction (a scalar stored into an already-dynamic slot) is untouched and
still round-trips. v12/svm are structurally exempt (K1) and every rejected shape compiles there.
This **superseded two existing tests** that had asserted these shapes "kept compiling" — they did,
but only because nothing had noticed the hazard. It also broke every dynamic-returning inline
function until I5 landed.

**SOURCE.** `compiler/src/processor/statement.ts` (`rejectV1ScalarToDynamicReassignment`), called from
`storeExpression`'s default branch and `processTernaryStore`.

**TARGETS.** v1 only.

**PORTING (P1).** Keep the *pattern* even if the trigger differs: when the engine makes a hazard
unrepairable, reject loudly at compile time rather than emitting it.

### K9. `multiOutputCall` tagging

**WHAT.** Metadata-only (never changes emitted bytes): when a variable is assigned a **multi**-output
contract-call result directly (`const s = pool.slot0();`, not destructured) into a **scalar** slot,
the decoded tuple's descriptor cannot survive the v1 round-trip — so a later indexed read `s[k]` (or
element write) is rejected at **compile time**, with the error pointing at the destructuring
alternative (K10). A bare `return s` is untouched — shipping protocol functions rely on that shape.

**EDGE / BAIL.** Flow-**insensitive** by design (a store in one `if` branch taints reads on the other
path — a spurious rejection at worst, never a silent miscompile); cleared on any other kind of
assignment; propagated through plain identifier aliasing (`const t = s`); computed only for a scalar
destination and only on v1 (`ctx.isV12` short-circuits to `undefined`). **Documented holes:** a
ternary with only *one* multi-output branch stays untagged (the other path may be perfectly
indexable), and the tag does not cross a call boundary into a helper.

**SOURCE.** `compiler/src/context.ts` (`Variable.multiOutputCall`),
`compiler/src/processor/statement.ts` (`multiOutputCallOutputs`, the store/ternary/update sites,
`processMemberAssignment`), plus the indexed-read rejection in `processor/expression.ts`.

**TARGETS.** v1 only.

**PORTING (P2).** A v1-specific safety net for a v1-specific engine limitation.

### K10. Multi-output-call destructuring lowering

**WHAT.** `const [price, tick] = pool.slot0()` makes **one** external call whose **raw** returndata
lands in a hidden heap temp (`ctx.freshTemp('dynamic')`); each bound element is then re-derived as
`STORE(name, INDEX(ABI_DECODE(count, READ(temp), specs), i))`. The decoded tuple is **never stored**,
so the descriptor cannot be dropped — raw heap bytes round-trip fine, a decoded tuple does not. Each
bound name's kind is its own per-output ABI kind.

**EDGE / BAIL.**
- **v12 EVM fast path:** when every output occupies exactly one 32-byte head word
  (`outputs.every(o => o.type !== 'tuple')`) **and** `ctx.target === 'v12'` specifically (**not**
  `svm`, whose SLICE/CAST_BE handlers are unvalidated ports), an elementary-static component skips
  even the `ABI_DECODE` via a zero-copy `CAST_BE(SLICE(temp, k*32 + (32-width), width))` — bit-identical
  to the engine's own scalar mask, including a negative signed `intN` via the byte-precise slice.
- Rejections: a `.catch()`-chain initializer (`cannot destructure a .catch() chain`); a non-contract-call
  initializer; zero outputs; more pattern elements than outputs; a `tuple`-typed output bound to a
  name (points at chained indexing instead — a *hole* over such an output is fine); a rest element or
  non-Identifier/non-hole element (`not implemented`); destructuring into an **existing** variable
  whose kind differs from the required output kind (since if-bodies share scope, a name reuse
  resolves to the existing variable and `store()` would silently use *its* kind — reject rather than
  miscompile; a matching kind reassigns like a plain const). A hole skips that output index.
- Capability-gated off svm entirely (`array destructuring`, C6).

**SOURCE.** `compiler/src/processor/statement.ts` (`processDestructuringDeclaration`,
`elementaryStaticWidth`, `destructuredElementType`, `abiOutputKind`).

**TARGETS.** v1 + v12 (v12 with the fast path); rejected on svm.

**PORTING (P0).** The raw-temp-plus-redecode architecture is the canonical safe way to consume a
multi-output call on v1 and the alternative K9's error points at. If a port's engine has no
"decoded tuple does not survive a variable round-trip" asymmetry, this complexity may be unnecessary
*for that target* — verify first.

### K11. Ternary storage-kind promotion

**WHAT.** Because `storeExpression`'s switch routes a `ConditionalExpression` to
`processTernaryStore` **directly**, `inferKindWithContext` is bypassed — a case added there would
never be consulted for a ternary. So `processTernaryStore` computes `consequentKind`/`alternateKind`
independently, each as `singleDynamicAbiOutputKind(branch, ctx) ?? inferKindWithContext(branch, ctx)`
(mirroring the plain store path exactly), and promotes the variable to **dynamic if either branch is
dynamic**.

**EDGE / BAIL.** Before the promotion existed, `processTernaryStore` consulted **no** kind inference
at all and always stored scalar — confirmed via real EVM execution to drop whichever branch's
descriptor was taken (`0x97` on the later `x[1]`), for a compile-time-resolvable condition, a genuine
runtime one (`main(cond)`'s parameter), and the structurally identical
`if (cond) { let x = arr; } else { let x = other; }` idiom (same persisting `x`, L3). Separately,
`branchKind` originally consulted only `inferKindWithContext`, missing a direct
single-dynamic-output contract call in a branch (K7) — also confirmed by execution and fixed by using
the same composition as the plain path. `rejectV1ScalarToDynamicReassignment` (K8) is applied to the
computed `branchKind` too. `immutablePacked` and `multiOutputCall` are **recomputed** fresh from the
actual branches, never left stale; `multiOutputCall` is tagged only when **both** branches qualify
(K9's documented hole).

**SOURCE.** `compiler/src/processor/statement.ts` (`processTernaryStore`).

**TARGETS.** v1 consequence; v12/svm compute the same values and ignore them.

**PORTING (P1).** The lesson generalizes: apply the promotion rule at **every** store-decision site,
not only the central one.

### K12. Nested-array-literal rejection (v12/svm)

**WHAT.** `const a = [[1n,2n],[3n,4n]]; return a[1][0];` compiles and executes correctly on **v1** in
every form tried (direct, aliased, helper-returned), but fails on **v12 and svm** in every form (an
empty revert on v12, `InvalidInstructionData` on svm) — while a **flat** literal and an equivalent
nested structure built with `new Array(n)` both work there, isolating the fault to the nested
literal's own static encoding. This is a pre-existing **engine** feature gap (no nested-array encoding
in `DynamicData.huff`/the svm engine), not a kind-inference bug — so `assertNoNestedArrayLiteral`
rejects it at compile time when `ctx.isV12`, pointing at the working `new Array(n)` alternative.

**SOURCE.** `compiler/src/processor/collection.ts` (`assertNoNestedArrayLiteral`, called from
`processArrayExpression`).

**TARGETS.** v12 + svm rejected; v1 untouched.

**PORTING (P2).** Check whether the target engine encodes nested arrays before porting the rejection.

### K13. Dynamic-variable object-field rejection

**WHAT.** `saucer.tuple()` concatenates each field's raw bytes verbatim with **no** ABI-style boxing
and — unlike array encoding — no static/dynamic consistency check. So `{ a: inner, b: 5n }`, where
`inner` is an existing dynamic-kind variable (a `new Array(2)` local, an alias of one, or a stored
single-dynamic-output call result), compiled cleanly on **both** v1 and v12 and then returned a raw
internal heap-descriptor artifact when `s.a` was read back — confirmed by real execution on both
engines returning the *identical* wrong word (the sibling scalar field read back fine, isolating the
fault to the dynamic field). Rejected structurally: the field's **processed bytes** are exactly a bare
`READ_HEAP` read.

**EDGE / BAIL.** A **directly constructed** dynamic value at a property position is *not* rejected
(a string/array literal, a `.concat()`/`.slice()` call, a nested object literal) — each allocates its
own fresh dynamic value rather than re-embedding an existing descriptor, verified to round-trip on
both targets. A violation nested inside an object literal's own nested-struct field is still caught,
since `processExpression` routes a nested `ObjectExpression` back through the same function.

**The `_bytes.length === 2` narrowing (an audit fix on top of the guard).** On v1's **prefix**
encoding an outer operator's opcode leads, so `arr.length` is `[LENGTH, READ_HEAP, slot]` — never a
false positive. On v12/svm's **postfix** encoding `unary()` appends its opcode, so `arr.length` is
`[READ_HEAP, slot, LENGTH]` — the base's `READ_HEAP` still leads even though the expression is a
genuine scalar, so a bare `bytes[0] === READ_HEAP` check false-positived (`{ x: arr.length }` threw on
v12/svm while compiling on v1; also reachable via `keccak256(arr)`). Requiring **exactly 2 bytes** —
a bare read is always `[READ_HEAP, slot]` on either encoding, since a slot index is one byte
(`context.ts`'s own invariant) — narrows the check to "the whole expression *is* a bare variable read"
without reopening the real bug, and is a no-op on v1.

**SOURCE.** `compiler/src/processor/collection.ts` (`assertNoDynamicVariableObjectField`, called from
`processObjectExpression`).

**TARGETS.** **all three** — the only guard in this family confirmed broken on both engine families by
direct execution rather than reasoned from the descriptor design.

**PORTING (P1).** The hazard (no consistency check in tuple encoding) is real on both engines; the
specific leading-bytes detection trick is encoding-specific and must be re-derived, not copied.

### K14. Immutable packed-array write rejection

**WHAT.** An array **literal** packs to a static, element-width-packed encoding the engine treats as
**immutable** — it reverts `SET_INDEX` on it. `isImmutablePackedArray` classifies exactly that shape
(op is `ARRAY`/`ARRAY_2` **and** the element-type byte is `0x01..0x20`), mirroring the engine's own
`do_set_idx_array` subtype check, and the compiler rejects element assignment to such a variable at
compile time (`Variable.immutablePacked`).

**EDGE / BAIL.** TUPLE / `NEW_ARRAY` / dynamic-element arrays / scalars all return false, so no false
positives. The check can only fire when the compiler statically sees the literal at the assignment
site — **never across a call boundary**, which is why a literal escaping via a helper's return
degrades to the same runtime revert as a heap array rather than a compile error (see TS14's measured
evidence).

**SOURCE.** `compiler/src/saucer/array.ts` (`isImmutablePackedArray`),
`compiler/src/processor/statement.ts` (the `immutablePacked` check).

**TARGETS.** all.

**PORTING (P1).** Mirror the engine's own subtype rule exactly — a stricter check would reject working
programs.

### K15. Known, still-open gaps (do not silently "fix" without re-verifying against the target engine)

**WHAT.**

- **v1: passing an existing dynamic local as a CALL ARGUMENT** into a same-file function
  (`function h(a){ return a[1]; } function main(){ const arr = new Array(3); …; return h(arr); }`)
  still reverts `0x97`. Two compounding causes, neither addressed: `processFunction`/
  `processFunctionV12` always tag a helper's own parameters `argType?.kind ?? 'scalar'` — there is
  **no per-call-site parameter-kind inference at all** (unlike `main`'s params, A5) — *and* v1's
  engine splits a call's arguments into **two positional index spaces** by dynamism
  (`funcHeap[heapI++]` vs `funcValues[valuesI++]`), which the compiler's argument lowering does not
  model. A real fix needs both, which is materially bigger than the return-direction fix.
- **v12/svm: confirmed NOT present** for the identical shape, verified by real execution on all three
  engines across many variants (mixed argument order, two frames deep, a helper's returned array
  passed onward, an array-literal argument, a recursive call, a two-hop alias inside the callee, a
  dynamic parameter's `.length`). Structural: v12 has no funcHeap/funcValues split, and
  `V12Saucer.read`'s `isParam` branch **never looks at the parameter's kind** — so tagging every v12
  helper parameter scalar is **dead metadata**.
- **v1: a dynamic parameter's `.length` fails SILENTLY** — reads the scalar word width (32) instead of
  the real length, with no revert (`"AB".length` through a parameter returns `32n`, not `2n`). The one
  shape in this whole family that fails quietly.
- **Investigated and confirmed NOT reproducible** (recorded so they are not re-investigated as part of
  this family): `&&`/`||` are boolean operators, so `cond && arr` yields a boolean — indexing it is a
  meaningless program, not a dropped descriptor; recursive (self and mutual) fixpoint convergence and
  the runtime round-trip across a recursive return are already correct on all targets; `.catch()`
  introduces no descriptor-kind gap of its own; compound assignment (`arr[0] += 10n`) and its
  aliasing composition are clean (`arr[0]++` remains a clean `not implemented` error); object-literal
  property read/write and a bare parameter's property read are already rejected at compile time.

**SOURCE.** `compiler/src/processor/index.ts` (the parameter tagging in `processFunction` /
`processFunctionV12`).

**PORTING (P1 to *document or gate*, P3 to fix).** For a v1-shaped target, either implement full
per-call-site parameter-kind propagation (respecting the two-array split) **or** add an explicit
compile-time rejection of "dynamic value passed as a call argument" — mirroring K8/K9's
"cannot repair it, so refuse it" pattern — rather than leaving a silent revert-or-wrong-value hazard
in a fresh implementation.

---

# Category G — codegen: encoders, builders, targets

### G1. `SaucerLike` abstraction + `newSaucer()`

**WHAT.** One interface (`SaucerLike`, ~110 methods) that both the v1 prefix `Saucer` and the v12/svm
postfix `V12Saucer` implement, so the entire processor is target-agnostic: it calls
`ctx.newSaucer()` and these methods, and the concrete builder decides prefix-vs-postfix emission and
slot-vs-stack variable access. Methods return `SaucerLike` (covariant returns), and builders are
**immutable** — every method returns a new node carrying accumulated `_bytes`.

**EDGE / BAIL.** Helper interfaces `SaucerIfLike`/`SaucerThenLike`/`SaucerLoopLike` model the
`if(c).then(a).else(b)` and `for(i,c,u).loop(body)` shapes; `OutputSpec { count, typeSpecs }` carries
ABI output decoding.

**SOURCE.** `compiler/src/saucer/saucer-like.ts`, `compiler/src/saucer/index.ts`,
`compiler/src/context.ts` (`newSaucer`).

**TARGETS.** all.

**PORTING (P0).** This single seam is why there is no per-target processor. Keep an equivalent trait
(and keep builder nodes immutable — several analyses inspect a node's bytes after the fact).

### G2. `OPS` — the shared opcode table

**WHAT.** One flat const table used by all three targets (the svm engine executes the same v12
postfix opcode table). Ranges: `0x01–0x20` BYTE_1…BYTE_32 (width markers doubling as literal
opcodes); `0x21–0x2f` arithmetic (incl. `SQRT`, `MUL_DIV`, `NEG`, `ADD_MOD`, `MUL_MOD`, `S_DIV`,
`S_MOD`, `S_AR`, `SIGN_EXTEND`); `0x30–0x35` bitwise; `0x40–0x4f` boolean/comparison (incl. signed
`BOOL_SGT/SLT/SGTE/SLTE` and `BOOL_XOR`, which have no SauceScript surface); `0x50–0x55` read/length/
keccak/ecdsa/`CAST_BE`/`CAST_LE`; `0x60–0x6e` zero-arity context; `0x70–0x76` unary context;
`0x80–0x81` `TLOAD`/`SLOAD`; `0x82–0x87` CREATE family; `0x90–0x9c` dynamic data (`BYTES`,
`BYTES_2`, `ARRAY`, `ARRAY_2`, `TUPLE`, `SLICE`, `CONCAT`, `INDEX`, `READ_HEAP` 0x98, `EVAL`,
`SET_INDEX`, `NEW_ARRAY`) plus `CALL_FUNCTION` 0x99; `0xa0–0xa5` ABI codec, `CALL`/`STATIC`/
`DELEGATE`, `CALLDATA`; `0xb0–0xb7` control flow (`IF`, `IF_2`, `JUMP`, `JUMP_2`, `JUMP_BACK`,
`JUMP_BACK_2`, `REVERT`, `CATCH`); `0xc0–0xc6` writes/allocation (`ALLOCATE_VALUE`, `WRITE_VALUE`,
`ALLOCATE_HEAP`, `WRITE_HEAP`, `TSTORE`, `SSTORE`, `LOG`).

**SOURCE.** `compiler/src/saucer/ops.ts`.

**PORTING (P0).** Copy verbatim; it is the wire contract.

### G3. `OPS_V12` — stack-manipulation opcodes

**WHAT.** The `0xD0–0xF3` range, emitted **only** by the postfix builder: `SDUP1..SDUP16`
(0xD0–0xDF), `SDROP` (0xE0), `SSWAP1..SSWAP16` (0xE1–0xF0), `SROT` (0xF1), `MSTORE` (0xF2),
`FUNC_RETURN` (0xF3).

**EDGE / BAIL.** `SDUPn` mirrors EVM `DUPn` (n counts from the top, n=1 = top) and `SSWAPn` mirrors
`SWAPn` (exchanges the top with the *(n+1)*th) — the off-by-one that G12's write formula must respect.
The 16-item ceiling is why A6 chose an inlined-main fall-through.

**SOURCE.** `compiler/src/saucer/ops-v12.ts`.

**PORTING (P0).** v12/svm only.

### G4. Integer auto-narrowing (`encodeInt`, `BYTE_OPS`)

**WHAT.** Every scalar literal is encoded at the **minimum** byte width needed:
`minBytesNeeded(v) = ceil(hexDigits/2)`, opcode `BYTE_OPS[width]` (= `width`, `0x01..0x20`), then the
big-endian value bytes. A negative value emits `[NEG, opcode, …bytes]` over its absolute value.

**EDGE / BAIL.** `abs > 2^256 - 1` throws `value exceeds 32 bytes (uint256 max)` — the error D2's
precision bug used to trigger spuriously. `BYTE_WIDTH` is the inverse map (opcode → width), derived
from `BYTE_OPS` rather than hand-written, and is what `array.ts` uses to recognize a static element.

**SOURCE.** `compiler/src/saucer/integer.ts`.

**TARGETS.** all (one encoder, shared by both builders).

**PORTING (P0).** Auto-narrowing is observable in every pinned-bytecode test; and the opcode↔width
bijection must stay derived from one table.

### G5. bytes / string encoding

**WHAT.** `encodeBytes(data)` = `[BYTES, len]` (≤255) or `[BYTES_2, hi, lo]`, then the raw bytes.
`encodeString(s)` = `encodeBytes(utf8(s))`.

**EDGE / BAIL.** Over 65 535 bytes throws.

**SOURCE.** `compiler/src/saucer/bytes.ts`.

**PORTING (P0).**

### G6. Array encoding + `forcedWidth` + packed-immutability

**WHAT.** `encodeArray(elements, forcedWidth?)` picks one of two shapes:

- **all-static** (every element's leading byte is a `BYTE_*` width marker): the element width is
  `maxByteWidth` across elements — i.e. the whole literal narrows to its widest element — emitted as
  `[ARRAY|ARRAY_2, …len, BYTE_OPS[width], …zero-left-padded element bytes]`.
- **all-dynamic** (`BYTES`/`BYTES_2`/`ARRAY`/`ARRAY_2`/`TUPLE` literals, or runtime-dynamic
  `READ_HEAP`/`CONCAT`/`SLICE`/`ABI_ENCODE`): `[op, …len, elementTypeMarker, …element bytes
  concatenated]`, where the marker is the first element's own dynamic-literal op, or `BYTES` for
  runtime-computed elements.

**EDGE / BAIL.** An empty array is `[ARRAY, 0, BYTE_1]`. Over 65 535 elements throws. A **mixed**
static/dynamic array throws `array elements must be literals or dynamic types` — which is why a
negative element (encoded as `[NEG, …]`, neither static nor dynamic) disqualifies TS14's fold.
`forcedWidth` (TS14's channel) is honored as `Math.max(forcedWidth, natural)` — it can only **widen**;
an invalid width throws; and passing it alongside a dynamic-element array throws defensively (no such
caller exists today, and honoring it silently would mislead). `isImmutablePackedArray` (K14) reads
back this encoding to classify mutability.

**SOURCE.** `compiler/src/saucer/array.ts` (`encodeArray`, `packStaticElements`, `padToWidth`,
`encodeLength`, `maxByteWidth`, `allStatic`/`allDynamic`, `encodeIndex`, `encodeSetIndex`,
`encodeNewArray`, `isImmutablePackedArray`).

**TARGETS.** all — v12/svm reuse this exact encoder (only the *operand order* of the heap ops differs,
G17).

**PORTING (P0).** Preserve: widest-element narrowing, the static/dynamic mixing rejection, and
"forced width may only widen".

### G7. Tuple encoding

**WHAT.** `[TUPLE, count, …element bytes]`; over 255 elements throws. Used for object literals,
`abi.encode` of multiple values, struct args (A8), and the v12 arg prologue.

**SOURCE.** `compiler/src/saucer/tuple.ts`, `compiler/src/saucer/saucer-v12.ts` (`tuple`).

**PORTING (P1).** Note the absence of any element-consistency check — the hazard behind K13.

### G8. v1 memory model + ALLOCATE prefix + the 255-slot cap

**WHAT.** v1 variables live in memory slots: `READ_VALUE`/`WRITE_VALUE` for scalars,
`READ_HEAP`/`WRITE_HEAP` for dynamics, dispatched by `encodeReadByKind`/`encodeStoreByKind`.
`Saucer.build()` prepends `[ALLOCATE_VALUE, n]` and/or `[ALLOCATE_HEAP, n]` when the respective slot
count is non-zero.

**EDGE / BAIL.** Slot indices are a **single byte**, so >255 live slots would wrap and alias an
earlier slot (e.g. a parameter) — both builders **fail loud** at compile time
(`too many scalar locals: N (max 255)… Split the function or reuse locals.`) rather than miscompile.
Counts are **high-water marks** (largest index + 1), not totals, because slots are reused across
non-overlapping scopes (G9).

**SOURCE.** `compiler/src/saucer/memory.ts`, `compiler/src/saucer/saucer.ts` (`build`),
`compiler/src/context.ts` (`valueSlotCount`, `heapSlotCount`).

**TARGETS.** v1 (v12/svm have the analogous prefix, G14).

**PORTING (P0).**

### G9. Slot allocation, scope free-list reuse, `freshTemp`

**WHAT.** `setVar` allocates a slot per kind: reuse a slot freed by a popped sibling scope
(`freeValueSlots`/`freeHeapSlots`, popped **LIFO** so lower indices pack tighter) else bump the
high-water mark. `popScope` releases every slot the scope declared. `freshTemp(kind)` allocates a
uniquely named `#tmp<N>` scratch local — `#` cannot collide with a parsed identifier — used e.g. for
K10's raw returndata temp and for a compound-assignment index that must be evaluated once.

**EDGE / BAIL.** v12 **parameters** get `slot = -1` (they live on the EVM stack) and are skipped by the
free-list. Slot reuse is only sound because **SauceScript has no closures**, so a popped local is
unreachable. `popScope` refuses to pop the global scope. Reserved-name and redeclaration checks live
here (L17). Remember only `for` pushes a scope (L3), so `if`/`while` locals persist and are freed with
the enclosing function scope.

**SOURCE.** `compiler/src/context.ts` (`setVar`, `getVar`, `pushScope`, `popScope`, `freshTemp`,
`freeValueSlots`/`freeHeapSlots`).

**TARGETS.** all.

**PORTING (P0).** The no-closures justification for slot reuse is worth writing down in the port too —
it is the only thing making it safe.

### G10. v1 prefix builder (`Saucer`)

**WHAT.** Emits `[OP][operands…]` trees. Notable encodings:

- `callFunction(name, args)` → `[CALL_FUNCTION, funcIndex, argCount, …arg bytes]` — the index is the
  function's position in **this program's** registry (which is why the compile cache memoizes whole
  programs, not function bodies, X1).
- `externalCall`/`staticCall`/`delegateCall` → `[op, …target, (…value), …calldata]`; with an
  `OutputSpec` the raw call becomes the data operand of `ABI_DECODE`, and a single-output call is
  further wrapped in `INDEX(decoded, 0)`.
- `catch(handler)` → `[…this, CATCH, handlerLen, …handler]` (handler >255 bytes throws).
- `return(v)` → `[…this, …v, STOP]`.
- `if`/`for`/`while` via `SaucerIf`/`SaucerThen`/`SaucerLoop`, with `IF`/`IF_2` and
  `JUMP`/`JUMP_2`/`JUMP_BACK`/`JUMP_BACK_2` chosen by body size, and `jumpOffsets` tracked/shifted so
  `break`/`continue` resolve.
- `dropIfUnused()` is a **no-op** — the tree interpreter discards intermediates implicitly.

**SOURCE.** `compiler/src/saucer/saucer.ts`.

**TARGETS.** v1.

**PORTING (P0).**

### G11. `V12Saucer` postfix core

**WHAT.** Emits `[a][b][OP]`, tracking four things per node beyond `_bytes`: **`stackEffect`** (net
items left behind), **`isDynamic`** (result is a heap descriptor vs a 32-byte scalar),
**`callPositions`** (CALL_FUNCTION offset sentinels), **`refPositions`** (parameter-read SDUP
sentinels). Composition primitives: `join`, `appendOperands`, `unary`, `binary`, `ternary`, `nary` —
each appends operand bytes forward then its own opcode, and `mergeSentinels` shifts a child's byte
positions by the preceding bytes and its REF **depths** by the preceding `stackEffect`.

**EDGE / BAIL.** **Non-commutative ops swap operands**: `SWAPPED_OPS` (`SUB`, `DIV`, `MOD`, `EXP`,
`S_DIV`, `S_MOD`, `SIGN_EXTEND`, and all four unsigned + four signed comparisons) emit `[b][a][OP]` so
the engine sees its expected order. Byte output is byte-identical to the engine-v12 Solidity
`V12Saucer.sol` builder. `tuple`/`concat` cap at 255 operands; `catch` at a 255-byte handler.

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (class header, `SWAPPED_OPS`, `mergeSentinels`,
`concatBytes`, `appendOperands`, `unary`/`binary`/`ternary`/`nary`).

**TARGETS.** v12, svm.

**PORTING (P0).** The operand-swap set and the sentinel-shifting rule are the two things that silently
corrupt everything if wrong.

### G12. v12 parameter frame — SDUP read / SSWAP write

**WHAT.** Locals stay in slots even on v12; only **parameters** live on the EVM stack. A parameter
**read** emits an SDUP *sentinel* plus a `RefPlaceholder { position, paramIndex, depth }`, patched at
assembly to `SDUP1 + realPos - 1` where
`realPos = depth + frame + paramCount - paramIndex` (`frame` = 1 for a helper's call-frame
return-address word, 0 for the inlined `main`). A parameter **write** emits
`[value][SSWAP_pos][SDROP]` with

```
const depth = this.stackEffect + value.stackEffect;
const frame = this.ctx.isMainFunction ? 0 : 1;
const pos   = depth + frame + this.ctx.findStackVar(name) - 1;
```

**EDGE / BAIL — a fixed bug worth preserving in full.** The write path previously used
`findStackVar(name)` **directly**, which is only the static distance from the top of the param block
assuming nothing else is on the stack — true only for `main` writing its sole parameter with an empty
stack. It omitted exactly the two things the read path already accounted for: the +1 helper frame word,
and the **live expression-stack depth** at the moment the SSWAP executes. Consequence, confirmed by a
one-byte patch on the real Huff runtime (`e1`→`e2`, `SSWAP1`→`SSWAP2`, flipped a wrong 5 to the correct
6): a plain scalar parameter write (`function h(x){ x = x + 1n; return x; }`, called `h(5n)`)
**silently returned the pre-write value with no revert** — worse than every other bug in this family.
Every other write shape either corrupted a different slot (middle of three params, a write inside an
`if`/`while`, two writes to one param) or reverted (any dynamic write through a parameter). The final
`- 1` is **SSWAPn-vs-SDUPn semantics**, not a third omission (G3). The formula collapses to the old
value for `main`'s own top-level parameter write (`frame = 0`, `depth = 0`), so those stay
byte-compatible. Both paths throw if the position falls outside 1..16.

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (`store`'s `isParam` branch, `read`'s `isParam`
branch), `compiler/src/index.ts` (`patchSdup` and the two `patchMainRefs`/helper patch loops),
`compiler/src/context.ts` (`pushStack`, `getStackVarPos`, `findStackVar`).

**TARGETS.** v12, svm.

**PORTING (P0).** If a port uses a stack-based parameter convention, derive read *and* write positions
from **one** shared depth computation. The bug existed because the two were computed independently.

### G13. Sentinel patching + blob assembly layout

**WHAT.** v12/svm assemble every function into a single blob:
`[main body][STOP][helper0][FUNC_RETURN][helper1][FUNC_RETURN]…` (with the arg prologue prepended in
A6/A7's path). `CALL_FUNCTION` sentinels (recorded as `callPositions`) are patched to each helper's
absolute byte offset; parameter-read SDUP sentinels are patched per G12. Offsets are computed by
walking the built helper bodies in registry order.

**EDGE / BAIL.** `main` has **no** body offset (it is the entry, or inlined behind the prologue), so
its registry slot stays `undefined` and `patchCalls` raises
`calling main() is not supported` for a self-call, or `no body offset recorded` otherwise — never
emitting corrupt bytes. Recorded positions are shifted past each function's ALLOCATE prefix
(`prefixLen`), which is why `buildMain()` returns the prefix length. `patchSdup` throws
`REF position out of range` outside 1..16.

**SOURCE.** `compiler/src/index.ts` (`assembleV12`, `assembleV12WithArgs`, `patchCalls`, `patchSdup`).

**TARGETS.** v12, svm.

**PORTING (P0).** Two-phase (emit sentinels, patch after layout) is unavoidable; keep the "main has no
offset" invariant explicit.

### G14. v12 ALLOCATE frame-stride prefix

**WHAT.** Every slot-using function prepends `[ALLOCATE_VALUE n]`/`[ALLOCATE_HEAP n]`.
`buildFunctionBody()` = prefix only (a helper's result stays on the stack for `FUNC_RETURN`);
`build()` = the result `MSTORE` only; `buildMain()` = **both**, returning `{ bytes, prefixLen }`.

**EDGE / BAIL.** The prefix declares the frame **stride** to the Huff runtime, which advances
`VALUES_BASE`/`HEAP_BASE` per `CALL_FUNCTION` by the **caller's** declared slot count and
**defaults that to 0**. So a `main` using N slots that omitted ALLOCATE would leave the stride at 0
and any helper call would alias/overwrite main's locals — hence the prefix is emitted for `main`
**unconditionally**, even for a leaf `main` where it strides nothing (a missing ALLOCATE is a latent
aliasing bug, not a no-op). ALLOCATE is **stack-neutral**, so SDUP depths are unchanged and only byte
positions shift — which is exactly why `prefixLen` is returned and threaded into the patch loops.
Same 255-slot fail-loud cap as G8.

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (`build`, `buildFunctionBody`, `buildMain`,
`allocatePrefix`).

**TARGETS.** v12, svm.

**PORTING (P0).** The default-0 stride contract is an engine fact with a silent-corruption failure
mode.

### G15. `return()` / FUNC_RETURN semantics

**WHAT.** On v12, `main` is **inlined**, so its `return` merely leaves the value on the stack and the
assembly terminates it (`MSTORE` + trailing `STOP`). A **helper** is entered via `CALL_FUNCTION`, so
**every** `return` must emit `FUNC_RETURN` to pop its frame+params and jump back.

**EDGE / BAIL.** This **must** include an early return inside a conditional: without `FUNC_RETURN` the
value is merely left on the stack and execution **falls through** into the rest of the body, leaking
one stack item per call (over a loop of calls → EVM "out of stack"). For the builder's own
bookkeeping, a helper `return` is modeled as **net-neutral** (reporting the height *before* the return
value) because control leaves there — any continuation (an enclosing `if`'s fall-through, which only
runs when the branch was *not* taken) must see the returning branch as height-neutral, not +1. The
function's tail return self-terminates, making the assembly's trailing `FUNC_RETURN` dead but harmless.

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (`return`).

**TARGETS.** v12, svm.

**PORTING (P0).** The net-neutral height model for a returning branch is subtle and load-bearing.

### G16. `dropIfUnused`

**WHAT.** A bare expression statement discards its result; on v12/svm this pops whatever the
expression left on the stack (`sdrop()` recursively while `stackEffect > 0`). On v1 it is a **no-op**
(the tree interpreter discards implicitly).

**EDGE / BAIL.** Side-effect-only ops that net zero (e.g. `LOG`, svm `SSTORE` at −3) are untouched.

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (`dropIfUnused`, `sdrop`),
`compiler/src/saucer/saucer.ts` (the no-op).

**PORTING (P0).** Any stack-machine target needs this or it leaks.

### G17. v12 heap-array ops + `binaryRaw` / `ternaryRaw`

**WHAT.** The heap ops keep their own postfix operand orders (`index`, `setIndex`, `newArray`,
`length`, `slice`, `concat`, `abiEncode`, `abiDecode`), which differ from v1's prefix orders — v1:
`[SET_INDEX][value][index][array]`; v12: the operands forward with the opcode last, per each method.
`binaryRaw`/`ternaryRaw` exist for ops whose operand order and stack effect cannot use the generic
`binary`/`ternary` helpers: `SSTORE`, `TSTORE`, `STATIC`, `DELEGATE`, and svm's `SLOAD`/`SSTORE` —
each specifying an explicit order and net effect (e.g. `-1` for ops that consume two and push one,
`-2`/`-3` for the svm account ops).

**EDGE / BAIL.** `staticCall`/`delegateCall` net **−1** (they push a result) — a documented earlier bug
had them at −2, which corrupted every parameter SDUP position after a static call.

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (`index`, `setIndex`, `newArray`, `binaryRaw`,
`ternaryRaw`, `staticCall`, `delegateCall`).

**PORTING (P1).** Per-op operand order and stack effect must be table-driven and tested; a wrong net
effect silently corrupts unrelated reads.

### G18. svm divergent call/storage lowering

**WHAT.** Four svm-specific builder methods: `svmCall(target, calldata, accountsArray)` and its exact
alias `svmStaticCall` → `[accountsArray][calldata][target][CALL|STATIC]` (target on top, **no** value
operand); `svmAccountData(index, offset, len)` → `[len][offset][index][SLOAD]` (net −2, pushes a
Bytes descriptor over that slice); `svmWriteAccountData(index, offset, value)` →
`[value][offset][index][SSTORE]` (net −3, pushes nothing, so a bare statement's `dropIfUnused` is a
no-op).

**EDGE / BAIL.** The engine **requires a Bytes descriptor** for the written value, so a scalar operand
is `MSTORE`-wrapped into a 32-byte heap word first (the CONCAT-wrap idiom). Account indices are
0-based into the execute instruction's user-account slice (after the 3 engine PDAs), capped at 64 per
CPI.

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (`svmCall`, `svmStaticCall`, `svmAccountData`,
`svmWriteAccountData`), `compiler/src/saucer/svm-profile.ts`.

**TARGETS.** svm.

**PORTING (P1).**

### G19. svm empty-stack `build()` + staged `msg.data` rejection

**WHAT.** Two svm-only guards. (1) `build()`: the svm engine enters `main` with an **empty** stack (no
stack-bottom sentinel, unlike the EVM Huff runtime), so a **void** `main` (net stack effect ≤ 0) must
**not** emit the result `MSTORE` — it would pop an empty stack and abort the whole transaction with
`StackUnderflow`. (2) `msgData()` throws in **staged** svm mode: every `CALLDATA` copies the whole
staged program to the heap, and the prologue owns the single one (A7).

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (`build`, `msgData`).

**TARGETS.** svm.

**PORTING (P1).**

### G20. v12 if/loop encoding + wide-jump upgrades

**WHAT.** `V12If`/`V12Then`/`V12Loop` mirror v1's control-flow classes on the postfix side.
`if`: `[cond][IF skip][then]`, upgraded to `IF_2` with a 2-byte skip when the then-body exceeds 255
bytes. `else`: appends `[JUMP len][else]` and **grows the IF skip** so a false condition jumps past
both the then-body and the JUMP. `for`: `[parent][JUMP incrLen][update][condition][IF skip][body]
[JUMP_BACK count]` — the back-jump lands at the *increment* (after the jump-over-increment header),
so that header is excluded from the count.

**EDGE / BAIL.** Three size thresholds each with their own upgrade path and error: a then/else body
over 65 535 bytes throws; a loop body over 253 bytes (or a back-count that would exceed 255) upgrades
`JUMP_BACK` → `JUMP_BACK_2`, and if the resulting skip exceeds 255 also upgrades `IF` → `IF_2`,
**shifting body sentinels by +1**; a back-count over 65 535 throws. Every branch re-merges sentinels
at the right byte offset and depth — the reason this code is so shape-specific.

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (`V12If`, `V12Then`, `V12Loop`).

**TARGETS.** v12, svm.

**PORTING (P0).** The skip/back-count arithmetic (what is and is not included in each span) is the
easiest thing here to get subtly wrong; port with byte-level tests.

### G21. v12 `break` / `continue` — unsupported (current gap)

**WHAT.** `V12Saucer.break()` and `.continue()` **throw** `break is not supported with target v12
yet` / `continue is not supported…`. v1 supports both (via tracked `jumpOffsets`).

**EDGE / BAIL.** So a loop using `break`/`continue` compiles on v1 and is a hard compile error on
v12/svm. Confirmed directly in source (not a `CLAUDE.md` claim).

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (`break`, `continue`).

**TARGETS.** v12, svm (gap).

**PORTING (P1).** A genuine feature gap, not a design decision — a port targeting a postfix engine
should plan for it rather than inherit it. Note the interaction: U1/U2 bail on a body containing
`break`/`continue`, so unrolling cannot paper over it.

### G22. svm `AccountRegistry`

**WHAT.** SauceScript names accounts with symbolic string refs; the registry interns each to a stable
u8 index in **first-use order** and ORs together the strongest flags seen (a ref used read-only then
writable ends up writable). `buildPlan()` emits `AccountPlan { metas[], usesRawIndices? }` where
`metas[i]` is user-account index `i`. One registry per compile, living on the `SharedModule`, so every
function's child context shares the numbering. `PAYER_REF = 'payer'` is reserved — the SDK binds it to
the fee payer.

**EDGE / BAIL.** Index >255 throws. **Raw numeric indices** are an escape hatch (the caller owns
ordering) that locks the registry into `'raw'` mode with empty metas; mixing raw and symbolic modes
throws `cannot mix raw account indices and symbolic account refs`. `usesRawIndices` propagates out of
a nested `eval()` compile so the mixing check still fails loud across that boundary (L15).

**SOURCE.** `compiler/src/planner/registry.ts`, `compiler/src/context.ts` (`buildAccountPlan` and the
registry glue).

**TARGETS.** svm.

**PORTING (P1).** First-use ordering and flag-ORing are the two behaviors the SDK's account resolution
depends on.

### G23. Packet budget estimator + `stagingTransactionCount`

**WHAT.** `estimatePacket(plan, bytecodeBytes, options)` models the v0 transaction the send layer will
build (fee payer + engine program + plan user accounts + the SDK-normative
`RequestHeapFrame(262144)` prepend, execute as the only other instruction) and reports overflow of
Solana's 1232-byte packet **before** anything hits the wire. Two transports: **inline** (`execute`
carries the bytecode in instruction data — practical ceiling ~900–1000 bytes of bytecode) and
**staged** (`execute_from_account`: data is discriminator + flags byte + 32-byte content-hash pin +
payload args; bytecode size stops mattering and is bounded by the 65 535-byte composite instead, and
the buffer account is prepended read-only). Options cover `signers`, `lookupTables`,
`lookupAddresses`, `prependBytes`, `argsBytes`.

**EDGE / BAIL.** A pure function of its inputs; raw-index plans have empty metas so their user
accounts are not counted. The reserved `'payer'` meta **dedupes** into the fee payer (whose signature,
key, and lock are already in the fixed terms) and contributes only its 1-byte instruction account
index. `NoSigner` is lazy on both execute paths, so no signer meta is auto-appended. The staged
payload-args budget is **measured** against the engine's own tests: `939 − 33·N` bytes with a pin,
both ComputeBudget instructions, and N extra user accounts (the engine pin is legacy-shaped; the v0
message this models costs 2 more bytes, carried in the estimate).

**SOURCE.** `compiler/src/planner/budget.ts` (`estimatePacket`, `stagingTransactionCount`,
`PacketBudget`, `PacketBudgetOptions`).

**TARGETS.** svm.

**PORTING (P2).** Advisory only (A9). The wire-format constants are measured against engine tests, not
derived — treat them as data to re-measure, not to reimplement.

### G24. The dynamic-value descriptor model (v1 vs v12/svm) — architectural note

**WHAT.** The single most consequential difference between the targets, restated here because a dozen
features depend on it:

- **v1**: a dynamic value is **out of band** — `ctx.dynamicResult` carries the descriptor, and a value
  slot holds only a `bytes32`. `_writeHeap` copies the descriptor; `_executeWriteValue` does not.
  Hence K1's fatal asymmetry, the two-index-space call convention (K15), and the fact that a
  `new Array(n)` TUPLE *returned* from a program leaks raw memory addresses (TS14).
- **v12/svm**: a dynamic value is **one in-band 32-byte descriptor word**, and the value/heap write
  handlers are the same `mstore` differing only in memory region — so a descriptor round-trips through
  either region losslessly, which is why `V12Saucer.store` can ignore the kind tag and derive
  everything from `value.isDynamic`.

**EDGE / BAIL.** Two known v12-side descriptor limits recorded in the repo's notes (engine-side, not
compiler-side): the descriptor's data pointer was originally 16-bit (region `0x5000`→`0xFFFF`, ≈45 KB
of total dynamic data before truncation → garbage read → revert), later widened; widening then briefly
regressed scalar-vs-descriptor disambiguation, fixed engine-side. Neither is fixable in the compiler.

**SOURCE.** `compiler/src/saucer/saucer-v12.ts` (class doc + `store`/`read`),
`compiler/src/saucer/memory.ts`, `compiler/src/processor/inference.ts` (the kind family that exists to
serve v1's model).

**PORTING (P0).** **Establish which model the target engine uses first.** It determines whether
Category K is essential or largely unnecessary.

---

# Category X — the compile cache

### X1. Compile cache + `compileCacheKey`

**WHAT.** `compile()` is a pure function of (source, options, on-disk import contents) — no clock,
randomness, or module-level mutable state — so results are memoized. `cache`: omitted/`true` → the
process-global store; `false` → bypass; a `Map`/`createCompileCache(n)` → that store.

**The key** covers every output-affecting option **with `compile()`'s own defaults already applied**
(so `{}` and `{ treeshake: true }` key identically): source, `target` (default `'v1'`), `staged`,
`tsSource`, `treeshake`, `fold`, `defines`, `args`, `contracts`, `baseDirs` **resolved to absolute
paths**, a `hasTransform` presence flag, and `cacheKeyExtra`. `stableStringify` makes it
deterministic: bigints tagged with a trailing `n` (so `1n`/`"1"`/`1` stay distinct) and object keys
sorted (field order never causes a spurious miss).

**EDGE / BAIL — the environment contract.** Two inputs the key structurally **cannot** capture:
`transformModule`'s *behavior* (only its presence is keyed) and the **on-disk bytes** of anything
reachable via `baseDirs`. Keep both stable within a process, or a repeat compile of identical
`(source, options)` returns **stale bytecode**. Escape hatches: `cache: false`,
`clearDefaultCompileCache()` (after editing an imported file), or `cacheKeyExtra` (a fingerprint —
e.g. a hash of the transform config plus imported files' mtime/size). `baseDirs` are resolved absolute
precisely because a relative dir is read against `process.cwd()` at file-read time, so keying the raw
relative string would let a cwd change mis-hit. **Whole-program memoization only, never per-function**:
a v1 function body embeds `CALL_FUNCTION` operands that are the callee's index in *that program's*
registry (G10), so a body is not portable across programs registering a different function set —
whereas whole-program results have no such coupling, and "the same solver/template recompiled
repeatedly" is the actual recurring pattern.

**SOURCE.** `compiler/src/cache.ts` (`compileCacheKey`, `stableStringify`,
`getDefaultCompileCache`, `clearDefaultCompileCache`), `compiler/src/index.ts` (`compile`).

**TARGETS.** target-agnostic (`target` is itself keyed, so v1 and svm never collide).

**PORTING (P2).** Two must-preserves: the defaults inside the key must mirror the compiler's own
defaults exactly (drift silently doubles entries), and `baseDirs` must be keyed absolute. The
whole-program granularity is a hard consequence of registry-relative call operands.

### X2. `cloneCompileResult`

**WHAT.** Deep-copies a result in **and** out of the cache: fresh `Uint8Array`s for each bytecode blob,
a copied `warnings` array, per-meta object spreads for `accountPlan` (preserving `usesRawIndices` only
if truthy), and a spread + per-slot spread for `argsLayout`.

**EDGE / BAIL.** So a caller mutating a returned result can never corrupt the cache, and a later
compile can never corrupt an earlier caller's result.

**SOURCE.** `compiler/src/cache.ts` (`cloneCompileResult`).

**PORTING (P2).** In Rust, ownership makes this mostly free — but keep the *semantics* (a cached entry
is never aliased).

### X3. Bounded LRU store + stats + clear

**WHAT.** `createCompileCache(maxEntries = 1024)` returns a `BoundedCompileCache`: an ordinary map used
as an LRU (re-`set`ting an existing key does not double-count; a `get` **hit re-inserts** to refresh
recency; overflow evicts the oldest key), exposing live `.stats` (`hits`, `misses`, `size`) and
`.clear()`. The process default is `createCompileCache(4096)`, created lazily.

**EDGE / BAIL.** A non-positive-integer `maxEntries` throws.

**SOURCE.** `compiler/src/cache.ts` (`createCompileCache`, `BoundedCompileCache`).

**PORTING (P3).** Any bounded cache works; the `CompileCache` interface is just `get`/`set`, so a plain
map satisfies it.

---

# Cross-cutting notes for a reimplementation

1. **Establish the target engine's memory model before anything else.** Whether a dynamic value is an
   out-of-band descriptor (v1) or an in-band word (v12/svm) decides whether Category K is essential
   or nearly vacuous (G24, K1). Do not port K2–K15 defensively.

2. **Compute the scope/shadow model once.** "Only `for` pushes a scope; `if`/`while` share the
   enclosing one" (L3) is a *language* fact that at least eight analyses must agree on — and at least
   four documented bugs came from one of them not knowing it (TS6, K4). One predicate, consumed
   everywhere.

3. **Factor the fold decision.** "Does this `if`/ternary fold, and to which branch" exists in three
   places (T2, D5, D6) that must agree bit-for-bit; under-approximating in the reachability walker
   emits a `CALL_FUNCTION` to a dropped function. Derive all three from one helper.

4. **Never route a compile-time literal through a float.** Two of three literal paths had this bug
   (D2, TS3). Parse raw source text into arbitrary precision.

5. **Fail closed, everywhere.** No analysis in this compiler throws on an unrecognized shape (except
   deliberately caught internal parse errors): an unresolvable fold leaves the node untouched, an
   unprovable safety property declines. Where an unrepairable engine hazard exists instead, **reject
   at compile time** (K8, K9, K12, K13, K14, L2's `==`/`>>>`) — a clear error always beats a silent
   revert. Treat this as a design rule, not an implementation detail: it is what makes the pipeline
   safe to keep extending.

6. **Prefer structural fixes over layered call-site fixes.** Category K's nine instances all have the
   same shape: a store site that forgot to consult the right combination of helpers. Make it
   impossible to emit a store without a kind from one canonical dispatcher.

7. **Much of `ts-frontend.ts`'s awkwardness is a `ts.transpileModule` artifact.** Name-only analysis
   results, structural re-derivation of statement pairs, the synthesized-node/`getText()` traps, and
   the parent-pointer trap all exist because nodes are re-parsed/rebuilt between stages. A single
   stable AST/arena design can drop all of it without changing observable behavior (TS1, TS10, TS13).

8. **Registry-relative operands constrain caching granularity.** v1's `CALL_FUNCTION` embeds a
   program-specific function index, so memoization must be whole-program (X1). A port with
   symbol-relative calls could cache more finely.

---

# Open questions for the port

Decisions to settle while planning `compiler-rs` (surfaced by this inventory; none blocks reading the
feature list). The three earlier v1-only questions — K15's call-argument gap, and the K8/K9 v1
scalar→dynamic reassignment rejections — are **moot** now that v1 is dropped (see "Porting scope").
These three survive:

1. **`break` / `continue` on v12/svm.** The current compiler supports them **only on v1** (now
   dropped); v12/svm hard-error with `not supported with target v12 yet` (G21). With v1 gone this is a
   **real gap for both remaining targets** — does `compiler-rs` implement `break`/`continue`, or
   inherit the gap? Loop unrolling cannot mask it: the unrollers (U1/U2) bail on any body containing
   `break`/`continue`.

2. **Signed-int + modular opcodes with no surface.** `S_DIV` / `S_MOD` / `S_AR` / `SIGN_EXTEND` /
   `BOOL_SGT` / `BOOL_SLT` / `BOOL_SGTE` / `BOOL_SLTE` / `BOOL_XOR` and `ADD_MOD` / `MUL_MOD` exist in
   the opcode table **and** the `V12Saucer` builder but have **no SauceScript-level surface** (nothing
   in `globals.ts` / `applyBinaryOp` emits them). Reserved for a future signed-int feature the port
   should design in, or dead entries to skip? (Flagged-claim #5 covers the same set from the accuracy
   angle.)

3. **Re-verify the v12/svm engine facts before the port leans on them.** Several Category-K/G claims —
   the v12 ALLOCATE frame-stride (G14), the svm unsupported-opcode set (G18/G19), and the dynamic-value
   descriptor pointer width (G24) — were taken from source comments / `CLAUDE.md`, since the engine
   repos were out of scope for this inventory. They describe **v12/svm**, which are the port's actual
   targets, so confirm them against the engine source before relying on them.

---

# Flagged claims (asserted in source/`CLAUDE.md` but not independently verified here)

Per the brief, these are called out rather than stated as fact.

1. **Loop unrolling is *not* in the acorn core** — the task framing implied otherwise. Verified: it
   lives only in `ts-frontend.ts`; `processor/statement.ts`'s loop handlers always emit real
   `JUMP_BACK` bytecode, and the only `unroll` mention under `processor/` is a comment pointing out to
   `ts-frontend.ts`. See Category U's placement note.

2. **A "scalar-only import/export boundary" capability does not exist.** The task's feature list
   mentioned one; no such gate was found in `capabilities.ts`, `globals.ts`, or the import-collection
   code. The scalar/dynamic *storage-kind* family (K) is a different concern (variable storage width,
   not an import boundary). Reported as absent rather than invented.

3. **Engine-side claims** are taken from source comments and `CLAUDE.md` only — the private engine
   repos were explicitly out of scope to read. This covers: the Huff runtime's default-0 frame stride
   and `VALUES_BASE`/`HEAP_BASE` striding (G14); `do_write_value`/`do_write_heap` being byte-identical
   `mstore`s (G24, K1); v1's `_executeWriteValue`/`_writeHeap`/`_executeFunction` behavior (K1, K4,
   K15); the svm engine's `UnsupportedOpcode` set (C7); `EVAL` static mode and `CATCH`'s pre-flight-only
   CPI interception (C7); the descriptor pointer-width history (G24).

4. **Measured constants are documented-in-source, not re-measured here.** The staged-args budget
   (`939 − 33·N`, `HEAP_FRAME_IX_BYTES`, the 293 + 33·N fixed cost — G23), TS14's bytecode-growth
   figures (~3.5× at 64 elements, 2052 vs 586 bytes; ~8.2 KB at a 256 cap), and the specific revert
   payloads/return values quoted throughout Category K are cited from code comments and `CLAUDE.md`.
   No tests were run and no bytecode was recompiled for this inventory (read-only task).

5. **Signed comparison opcodes (`BOOL_SGT/SLT/SGTE/SLTE`) and `BOOL_XOR`** are present in `OPS` and in
   `V12Saucer`'s method surface (`sgt`/`slt`/`sgte`/`slte`, plus `sDiv`/`sMod`/`sAr`/`signExtend`,
   `addMod`/`mulMod`) but no SauceScript-level surface was found for them in `globals.ts` or
   `applyBinaryOp`. Whether they are intentionally builder-only (for a future signed feature) or dead
   entries is a question for the team, not a settled fact.

6. **`RESERVED_NAMES`' enforcement points** were confirmed at `setVar`/`addFunc` in `context.ts`; a
   full sweep for any *other* enforcement site was not performed.

7. **String-specific intrinsics** beyond `[i]`/`.length`/`.concat`/`.slice` were not traced against a
   dedicated string code path — L7 assumes strings share the array/bytes dispatch, consistent with
   `README.md`'s parallel examples.

8. **A stale note in the user's own memory** claims "only `main()` may call user functions". Current
   source contradicts it (helper→helper calls work, including forward references, on both targets —
   L4/A4). Recorded here so the port is not designed around the old restriction.

9. **`CLAUDE.md` records two open items that are engine-side, not compiler-side**, and therefore have
   no entry above: a v12 nested all-dynamic `abi.encode(bytesA, bytesB)` head/tail framing bug, and a
   pinned-vs-live engine divergence around a later allocation clobbering an already-decoded dynamic
   ABI output (fixed upstream; resolved by the `release/beta` repin per that file). Both are noted only
   so a porter does not attribute them to compiler logic.
