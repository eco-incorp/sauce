# `compiler-rs` vs the SDK TypeScript compiler — what changed

> **⚠️ Point-in-time snapshot (stale as of 2026-08-23).** This delta was taken against `sauce#main @
> 431f9ce`. Since then the RS→TS parity port has LANDED on `feat/compiler-parity-port` (open PRs
> eco-incorp/sauce #357–#374 + #375), closing most of the "feature-behind" gaps §7 describes — `defines`,
> `uint()`, `Math.neg`, `address.*`, `new Array(n)`, `.catch()`, `evm.tload/tstore`, loop unrolling,
> lookup-table folding, single-return call folding, and the full entry-parameter decode family
> (`Tuple`/`entry_arg_types`/`ArgShape::Struct`/`bytes[]`/nested-array) — plus the ambient-import primitive
> + inline-ABI contracts (#376–#379). The §7 parity table below is NOT refreshed; read it as a historical
> snapshot, not current state. Current per-feature specs live in the RS code doc-comments + `compiler/README.md`.

**What this doc is.** A grounded delta between the new Rust SauceScript compiler (`eco-incorp/sauce#main`
@ `431f9ce`, crate `sauce-core`) and the existing SDK TypeScript compiler (`sauce-sdk/compiler`).

**Sources.** Every `compiler-rs` claim cites a path under the read-only checkout at
`/private/tmp/claude-501/-Users-er-Documents-Projects-sauce-sdk/0c37afae-4d4c-475a-bb8c-4a07d99d9fe7/scratchpad/sauce-main/compiler`
(paths below are relative to that root). Every TS-compiler claim cites `compiler/src/**`,
`docs/compiler-feature-inventory.md` (114 features, 12 categories, IDs `A1`…`X3`), or the repo
`CLAUDE.md`. Where a difference could not be confirmed in source it is marked **UNCONFIRMED** rather
than asserted — see the closing section.

**What this doc is not.** It describes what *is*. The strategic direction and the two-part remediation
plan live in `docs/plans/compiler-parity-and-port-plan.md`.

---

## 0. At a glance

| Axis | TS compiler (`sauce-sdk/compiler`) | compiler-rs (`crates/sauce-core`) |
| --- | --- | --- |
| Parser | `acorn` (JS only) + a bolt-on `typescript`-library front-end reachable only via `.ts`/`tsSource` | **OXC**, one pass, **every** source parsed as TypeScript (`frontend.rs:89`) |
| Source language | JS subset; TS is an opt-in seam | **TypeScript subset**, unconditionally (`frontend.rs:1`) |
| IR | **none** — `Saucer` emits bytes during the AST walk (inventory L17-20) | owned, target-agnostic `ir::{Program, Function, Stmt, Expr}` (`ir.rs`) |
| Types | ad hoc `VariableKind` inferred from usage patterns | real static `Ty` checked during lowering (`lower/mod.rs:749-769`) |
| Passes | transformer stages on the TS AST (TS-path only) + ad hoc walk-time logic | named IR→IR passes: `fold`, `eval_order`, `dead_store`, `reachability`, `scope`, `push_order`, `capability`, `codegen`, `manifest` |
| Targets | **v1 + v12 + svm** | **v12(EVM) + svm only** — `Target::{Evm, Svm}` (`options.rs:6-12`) |
| Target gating | inline `assertCapability` + bespoke `assertNo*`/`reject*` guards | one `Feature` × `Backend::availability` matrix, one dedicated pass (`targets.rs:64-140`, `capability.rs`) |
| Native-op namespacing | flat `GLOBALS` table; one name per concept, branching internally on target | **split per target**: `evm.*` / `svm.*`, plus cross-target `ctx.*`/`abi.*`/`crypto.*`/`Math.*` |
| Reserved words | all namespace roots + all global function names (`globals.ts:841`) | only `revert`, `require`, `log` (`lower/mod.rs:1708-1712`) |
| `-O` axis | none | `CompileOptions.optimize` gates the *rewrite*; validity never depends on it (`options.rs:38-45`) |
| Errors | plain `Error`/strings | `error_stack::Report<E>` + per-module `thiserror` enums + span-anchored `Diagnostic`s |
| Optimization breadth | very broad (26 features across Categories `TS`/`Unroll`/`Inline`) but TS-path-only | narrow (constant-subtree fold + assigned-once propagation) but language-agnostic |

The last row is the headline tension: **compiler-rs is architecturally ahead and feature-behind.** It
has the right shape for partial evaluation and none of the accumulated partial-evaluation surface.

---

## 1. Architecture: real IR + discrete passes vs. AST-walk-and-emit

### TS compiler

No separate IR. `acorn` parses; `processor/` walks the AST and calls a `Saucer` builder that emits
bytes *as the walk proceeds* — builder nodes (`{_bytes, …}`) **are** the intermediate representation
(inventory, "What the compiler is", lines 15-20). Two consequences that ripple everywhere:

- Analyses inspect **emitted bytes** instead of a typed tree. The clearest case is `K13`'s
  dynamic-field guard, `processed[i]._bytes[0] === OPS.READ_HEAP` — which then needed a second fix
  because v12's postfix encoding puts the same byte first for a genuinely scalar expression
  (`CLAUDE.md`, "assertNoDynamicVariableObjectField … false-positived on v12/svm").
- Scalar-vs-dynamic storage kind is an ad hoc side channel (`VariableKind`) computed by heuristics
  that had to be patched piecemeal across **nine** documented bug instances (inventory `K1`–`K15`;
  `CLAUDE.md`'s "SIXTH instance", "SEVENTH instance", "A NINTH instance…" fix log).

### compiler-rs

A staged pipeline over one owned IR (`lib.rs`, `compile()`):

```
frontend::parse (OXC)  →  frontend::check (default-deny subset gate)
  →  lower::program (AST → ir::Program, with Ty checking + FunctionId assignment)
  →  reachability::reachable_functions        (computed ONCE, pre-fold)
  →  reachability::prune_unread_global_initializers
  →  fold::program                            (IR→IR; validates always, rewrites under -O)
  →  eval_order::normalize                    (unconditional — correctness, not optimization)
  →  dead_store::normalize
  →  function_fingerprint alignment check
  →  capability::check  →  codegen::emit      (+ manifest::build on SVM)
```

Each stage is its own module with its own tests. Three structural properties the TS compiler has no
analogue for:

1. **Reachability is computed once and shared.** `reachability.rs`'s own header: *all four*
   consumers (codegen, capability, manifest, globals-pruning) *"are handed one set, computed once …
   rather than each running this walk."* It is deliberately computed **pre-fold**, so compile
   *validity* never depends on `-O` (a fold can delete the ternary arm holding the only call edge to
   a function). The TS compiler's equivalent (`T1` treeshake + `T2` fold-aware `collectCalls`)
   recomputes reachability in more than one place and must agree bit-for-bit.
2. **Validity and optimization are separated on two axes.** `options.rs:38-45` documents
   `optimize` as an `-O0`-style knob over the *rewrite* only: *"a constant that overflows or divides
   by zero is a compile error at every `-O` level, since program validity must not depend on
   `optimize`."* And `eval_order`/`dead_store` run unconditionally, because they encode JS
   left-to-right evaluation order and stack-slot liveness respectively — correctness, not speed.
   `CompileOptions` in the TS compiler has no optimization-level knob at all (inventory `A2`); its
   nearest neighbour, `options.cache`, controls memoization.
3. **A single push-order model.** `push_order.rs` is the one statement of codegen's emission order,
   consumed by the passes that must agree with it. Its own module doc records that the three
   consumers had already drifted before consolidation. The TS compiler states emission order
   implicitly inside each `Saucer`/`V12Saucer` method, with per-method stack bookkeeping — the shape
   that produced this branch's `V12Saucer.store` SSWAP-position bug, fixed by hand-deriving
   `depth + frame + findStackVar(name) - 1` (`CLAUDE.md`).

### The load-bearing difference underneath: a real type system

`lower/mod.rs:749-769` defines

```rust
pub(crate) enum Ty { Scalar(Scalar), Account, Bytes, Array { element, len }, Tuple(Vec<(String, Ty)>), Void }
```

and every expression lowers through `self.expr(..) -> (Expr, Ty)`. Dynamic-vs-scalar storage is
*derived* from `Ty` and distilled into the IR as `is_dynamic`/`ElementTag` (`lower/mod.rs:746-747`:
*"`codegen` never sees it; only its distilled form, `ir::ElementTag`/`is_dynamic`, crosses into the
IR"*). `Ty::Account` exists specifically so an SVM account index and an EVM address value can never
silently interchange.

This is why the TS compiler's entire **Kinds** category (`K1`–`K15`) has no counterpart to port *as
such*. A checked type is not a better heuristic; it removes the need for one. The portable thing is
the **invariant** those nine fixes encode — *a dynamic value must never round-trip through a scalar
slot* — not the nine-pass mechanism that enforces it in the TS compiler.

**Important caveat.** Being structurally better is not being verified. No adversarial
real-execution audit of compiler-rs's own `is_dynamic` resolution was run for this doc, and none is
cited in `compiler-rs`'s docs. The claim here is architectural, not empirical.

---

## 2. Parser: OXC (TS-native) vs. acorn + a bolted-on TS front-end

### TS compiler — two front doors

Plain `acorn` parses `.js`/`.sauce` (JS only, no annotations) — the **default** path. A separate,
later-added front-end (`src/ts-frontend.ts`) is reachable **only** via `tsSource: true` or a
`.ts`/`.sauce.ts` import; it runs the real `typescript` compiler plus `ts-evaluator` through six
transformer stages and hands **plain JS text** back to acorn, which re-parses from scratch
(inventory `TS1`; `CLAUDE.md`'s "TS front-end" section).

The costs of that seam are documented, not hypothetical:

- `ts-evaluator@2.0.0` *"cannot reliably evaluate bigint arithmetic at all"*, so the front-end grew a
  whole second bigint evaluator (`tsEvalConst`, inventory `TS2`) largely duplicating the acorn-side
  `processor/const-eval.ts`.
- `ts-evaluator` has no shadow-safety, which produced a genuinely wrong compiled program until
  guarded (`CLAUDE.md`: *"the `ts-evaluator` fallback wasn't shadow-safe"*).
- Because output is **text** re-parsed by acorn, a pass cannot attach metadata to a node it
  synthesizes — hence `TS14`'s out-of-band `wideReturnArrays` fingerprint channel.
- Synthesized nodes have `parent === undefined` and `getText()` *throws* on them — two separate
  documented traps (`CLAUDE.md`, "The parent-pointer trap").

### compiler-rs — one parser, always

```rust
Parser::new(allocator, source, SourceType::mjs().with_typescript(true)).parse()   // frontend.rs:89
```

`frontend.rs:1-2`: *"The frontend: parse SauceScript (a TypeScript subset) into an AST. Uses oxc as
the TypeScript parser (every playground script is `.ts`)."* Every file is parsed with TypeScript
grammar enabled regardless of extension — the default `entry` is still literally `"main.js"`
(`options.rs:32`) and is parsed as TS all the same. There is no second evaluator, no separate
shadow-tracking discipline to keep in sync, and no text round-trip: lowering produces an owned IR
directly from the OXC AST.

`frontend::check` is then a **default-deny** subset gate (`frontend.rs:14-24`): at top level only
imports, function declarations, and module-scope `let`/`const`; inside a body a fixed statement /
operator / literal list. It collects *all* violations as span-anchored `Diagnostic`s rather than
failing on the first. TS-only *constructs* (interfaces, type aliases, enums, `as`/`satisfies`,
generics, `!`) are rejected like any other out-of-subset syntax — TS is the **grammar**, not an
escape hatch to the full type system.

---

## 3. The TS-subset + type-annotation direction

This is the strategic point the port hinges on, and compiler-rs is already where the SDK compiler
intends to go.

**What compiler-rs does with types.** Annotations are *ride-along syntax the subset gate never
reads, but which lowering treats as authoritative* (`frontend.rs:6-12`):

> *"Type annotations on params, locals, and returns are ride-along fields **this** walk never reads —
> but they are **not** ignored: `lower::annotation_ty` resolves each to a `lower::Ty` and checks it
> (ECO-1885), and a name outside the language's vocabulary is a compile error at the annotation
> (ECO-2055). So the subset gate's silence here is a division of labour, not permission."*

Concretely:

- TS **syntax** is mandatory (OXC always parses TS grammar).
- An explicit **annotation** is optional for the default case — an un-annotated parameter is a plain
  scalar (`lower/assembly.rs`'s `param_ty`) — and *required* to name anything else (`Account`,
  `Bytes`, an array, a tuple shape).
- An unrecognized annotation is a hard error at the annotation itself, not a silent fallback.
- Real errors flow from types: `TypeMismatch`, `VoidAsValue` (`lower/mod.rs:768-775` — a `: void`
  call's word may only be discarded by a bare call statement), plus `Ty::Account`'s cross-use
  rejection.

**Why the TS compiler's fold family is TS-only.** Not a design boundary — a reuse artifact, and the
inventory says so in its own porting-scope section (lines 48-58): those passes were built on the
`typescript` library *"because they were already on hand"*, and Category `TS` should be read as *the
partial-evaluation specification*, to be reimplemented language-agnostically. In compiler-rs there is
nothing to gate: `fold.rs` runs on the typed IR, after lowering has erased any JS-vs-TS distinction,
so a fold cannot be conditional on a file extension even in principle.

**The honest caveat.** "Partial eval already works for JS too in compiler-rs" is true only of the
*narrow* fold that exists today. `fold.rs`'s own header scopes it: *"the compiler's IR→IR pass that
collapses constant `Binary`/`Unary`/`Math` subtrees to a single `Expr::Const` before codegen.
Overflow or division-by-zero in a fold is a compile error."* Plus assigned-once local propagation.
It has **no** branch/ternary pruning at the source level, no lookup-table folding, no loop unrolling,
no arrow-const inlining, no same-file call folding. Confirmed by grep over
`crates/sauce-core/src`: zero hits for `unroll`, for the arrow-const inline mechanism, for
`quasiquote`, for `defines` as an option (the three `defines` hits are the English word). So the
broader specification (26 features across `TS`/`Unroll`/`Inline`) has no compiler-rs implementation
for **either** source language. See §7 and the plan doc's Part 2.

---

## 4. Global namespacing for EVM/SVM native opcodes — the flagged difference

This is the most concrete divergence, and it runs in **both** directions: compiler-rs *splits* some
things the TS compiler unifies, and *unifies* some things the TS compiler splits.

### 4a. compiler-rs has a normative rule, not just a convention

`compiler-rs`'s `CLAUDE.md:820-830` states the policy as a MUST/MAY:

> *"A per-target difference **must be reconciled in the compiler** when the same source construct has
> the same *meaning* on both targets and only its encoding differs. It **may become two gated
> features** only when the construct names a target-specific concept with no counterpart."*
>
> *"The naming follows from that decision rather than being a separate choice: a primitive whose
> meaning is target-specific is **namespaced** (`svm.sload(...)`, `evm.tload(...)`); one whose meaning
> is shared and whose encoding the compiler reconciles is not (`keccak256(...)`, `msgSender()`,
> `Math.*`). A neutral name over divergent semantics breaks the 'never silently means different
> things' invariant at the *source* level, which is worse than at the bytecode level because it looks
> portable."*

The canonical case is `sload`: opcode `0x81` on **both** engines, but a keyed 256-bit slot on the EVM
versus a byte range inside an account on the SVM. Same byte, divergent semantics → **two oppositely
gated features**, and the capability pass is what keeps the shared byte safe.

There is a living registry of every such divergence with its disposition (reconcile / two features /
inherent) in `README.md:174-214`, *"Cross-target divergences"*. The TS compiler has no equivalent
rule and no equivalent registry; its target-conditional behavior is decided per call site.

Note the rule and the implementation differ slightly in *spelling*: the rule writes `keccak256(...)`
and `msgSender()` bare, whereas the code puts them under cross-target namespace roots
(`crypto.keccak256`, `ctx.msgSender()`). The rule's substance — *namespace only per-target
divergences* — holds; `crypto`/`ctx`/`abi`/`Math` are grouping namespaces, not target namespaces.

### 4b. How the namespaces are actually recognized

`lower/contract.rs:807-892` defines one recognizer per namespace root, each doing exactly a literal
identifier-name match on the object of a static-member callee:

| Recognizer | Line | Matches |
| --- | --- | --- |
| `abi_callee` | 807 | `object.name != "abi"` → `None`; then `encode`/`decode` |
| `crypto_member` | 836 | `object.name == "crypto"` |
| `ctx_member` | 849 | `object.name == "ctx"` |
| `math_member` | 863 | `object.name == "Math"` |
| `svm_member` | 877 | `object.name == "svm"` |
| `evm_member` | 890 | `object.name == "evm"` |

`call_expression` (`lower/contract.rs:64-148`) tries them in a fixed order — `abi` → `crypto` → `ctx`
→ `Math` → `svm` → `evm` → inline `Contract.at()` chain → bound-contract variable → scalar/bytes
receiver method → generic user-function call. Namespace matching is **root-only by design**: an
unknown *method* under a matched root does **not** fall through to the generic call path, it produces
a precise error (`Error::SvmUnknownMethod`, `Error::EvmUnknownMethod`, `Error::CtxUnknownMethod`,
`Error::CryptoUnknownMethod`).

So these are **pattern-matched pseudo-namespaces at a specific AST position** — not imports, not
declared globals, not values with types.

### 4c. `evm.*` and `svm.*` are disjoint, per-target, and `Feature`-gated

Each per-target primitive is a **distinct IR node variant**, not one node with a target tag:
`Expr::EvmCall{kind: EvmCallKind}` vs `Expr::SvmCall`; `Expr::EvmSload` vs `Expr::SvmSload`;
`Stmt::EvmSstore` vs `Stmt::SvmSstore` (`ir.rs`). They *share the bytecode opcode byte* (`CALL`
`0xA2`, `SLOAD` `0x81`, `SSTORE` `0xC5`) while being separately gated constructs — which is exactly
the mechanism the rule in §4a demands.

The gate is `Feature` × `Backend::availability` (`targets.rs:64-140`). Exactly **ten** variants, and
the list is asserted exhaustive by a test (`Feature::ALL: [Self; 10]`, `targets.rs:125-136`):

`TryCatch, TransientStorage, AbiCodec, EvmCall, EvmStaticCall, EvmDelegateCall, EvmStorage,
SvmStorage, SvmCall, LogTopics`

`#[non_exhaustive]`, and the enum's own doc names its future growth (`targets.rs:64-70`): *"the full
v12/SVM matrix (`Create`, `AbiCodec`, `EvmDelegateCall`, `EvmStaticCall`, `Eval`, `EvmCall`,
per-context reads, …) grows this enum one variant at a time."* So `Create` and `Eval` are
acknowledged future work, not silent gaps.

**Two of the ten variants are reserved ahead of a frontend surface** — a pattern worth naming,
because it looks like a feature and is not one yet:

- `TransientStorage` exists in the matrix, but no `evm.tload`/`evm.tstore` call surface appears under
  `lower/contract.rs`'s dispatch. (`CLAUDE.md:826` names `evm.tload(...)` as the intended spelling,
  so only the wiring is missing.)
- `TryCatch` exists in the matrix, but `frontend.rs:956` rejects a `try`/`catch` statement outright
  as out-of-subset syntax (*"a `try`/`catch` statement"* is in the rejection message table), and
  `ir.rs` has no `Stmt::Try`/`Expr::Try`. So the TS compiler's `.catch(handler)` chaining
  (inventory `C4`) has no compiler-rs surface today.

### 4d. `ctx.*` unifies — and narrows — the TS compiler's four context namespaces

The TS compiler splits context reads across **four** roots plus three bare globals
(`compiler/src/globals.ts`): `msg.{sender,value,data}` (:497), `block.{number,timestamp,coinbase,
prevrandao,gasLimit,baseFee,blobBaseFee,chainId}` (:511), `tx.{origin,gasPrice}` (:524),
`address.{self,balance,balanceOf,codeSize,codeHash,isContract,isEOA}` (:536), and `gasLeft()` (:706),
`blockHash()` (:714), `blobHash()` (:722) — 18 members plus 3 functions.

compiler-rs collapses what it has into **one** `ctx.*` root with **seven** methods
(`lower/contract.rs:410-419`, dispatching to a flat `ContextOp` enum):

```
ctx.msgSender()  ctx.self()  ctx.chainId()  ctx.blockNumber()
ctx.timestamp()  ctx.selfBalance()  ctx.balance(address)
```

The gap is pinned by compiler-rs's **own negative regression test**: `ctx.gasPrice()` is rejected
with `Error::CtxUnknownMethod` (`lower/contract.rs:2135-2139`). Absent (grep, zero hits):
`msg.value`, `msg.data`, `tx.origin`, `tx.gasPrice`, `block.coinbase`, `block.prevrandao`,
`block.gasLimit`, `block.baseFee`, `block.blobBaseFee`, `address.balanceOf/codeSize/codeHash/
isContract/isEOA`, `gasLeft`, `blockHash`, `blobHash`.

Two `ctx` members are also *inherently* divergent by compiler-rs's own registry
(`README.md:213-214`, "Inherent — permanently divergent, no action"): `ctx.chainId()` differs per
chain by definition, and `ctx.blockNumber()` is SVM slot height vs EVM block height.

### 4e. No reserved-name enforcement for namespace roots — deliberately

The biggest *policy* difference. In the TS compiler, **every** `GLOBALS` key (`Math, crypto, storage,
abi, msg, block, tx, address, contract`) and **every** `GLOBAL_FUNCTIONS` key (`gasLeft, blockHash,
blobHash, emit, eval, uint, accountData, writeAccountData, accountUint`) is unioned into one
`RESERVED_NAMES` set (`globals.ts:841`) and enforced globally — declaring anything by those names is
a hard error (`compiler/src/context.ts:502,560`, `processor/inline.ts:90`).

compiler-rs reserves **three** identifiers. `lower/mod.rs:1708-1712`: `Reserved { Revert, Require,
Log }`. Its doc comment (`lower/mod.rs:1700-1701`) states the asymmetry as intentional:

> *"A local **variable** by one of these names is another namespace and stays legal: nothing in this
> compiler calls a variable, so it can shadow nothing."*

So `let evm = 5n;` is legal in compiler-rs and a hard error in the TS compiler. And the reasoning for
reserving even those three is specific, not stylistic: reserving `log` covers the *import-alias*
route too, because `import { transfer as log }` once bound a callee no call could ever reach — the
call emitted a bare `LOG` and `transfer`'s body, storage writes and all, was never lowered
(`lower/mod.rs:1695-1699`, ECO-2011).

**`emit` is deliberately NOT reserved** (`lower/mod.rs:1703-1706`):

> *"The set is deliberately the *primitives* and nothing more. `emit` is **not** reserved: the
> ergonomic named-event surface belongs to a library (`emit("Transfer(address,address,uint256)",
> {…})` over `log` + `abi.encode` + a precomputed keccak topic), and reserving that name here would
> make the very function that library has to export illegal."*

That is a **design decision, not a gap** — it directly contradicts reading the TS compiler's `emit()`
builtin (`globals.ts:734`, inventory `L14`) as something to port into the compiler.

### 4f. Namespacing summary table

| Concept | TS compiler (`compiler/src/globals.ts`) | compiler-rs | Verdict |
| --- | --- | --- | --- |
| EVM keyed-slot storage | `storage.read/write` — one name, branches on `ctx.isSvm` (:401) | `evm.sload`/`evm.sstore`, `Feature::EvmStorage` | **different** |
| SVM account-range storage | same `storage.*` root, SVM branch inside | `svm.sload(account, offset, len)`/`svm.sstore`, `Feature::SvmStorage` | **different** |
| Transient storage | `storage.tRead/tWrite` | `Feature::TransientStorage` in the matrix; **no call surface** (intended spelling `evm.tload`, `CLAUDE.md:826`) | **missing in rs** |
| Raw EVM call | `contract.call/static/delegate` (:593), target-polymorphic | `evm.call/static/delegate`, three separate `Feature`s | **different** |
| SVM CPI | same `contract.*` root, SVM branch inside | `svm.call(program, accounts, calldata)`, `Feature::SvmCall` | **different** |
| Context reads | 4 roots + 3 bare globals, 21 entry points | 1 root `ctx.*`, 7 methods | **different + narrower** |
| Crypto | `crypto.keccak256/ecdsaVerify` (:371) | `crypto.keccak256/ecdsaVerify` (`crypto_member`) | **same** |
| ABI codec | `abi.encode/decode` (:466) | `abi.encode/decode` (`abi_callee`), `Feature::AbiCodec` — **EVM-only**, the SVM engine has no such opcode (`README.md:203`) | **same shape, gated** |
| Math | `Math.*` (:338) | `Math.*` (`math_member`) — plus surfaced `sDiv`/`sMod`/`sShr`/`signExtend`/`addMod`/`mulMod` | **rs is ahead** |
| Logging | `emit()` sugar + underlying primitive (:734) | one `log(data, …topics)`; only *topics* gated (`Feature::LogTopics`); `emit` deliberately left to a library | **different by design** |
| svm sugar | bare `uint`/`accountData`/`writeAccountData`/`accountUint` (:783-831) | none — only the `svm.sload`/`svm.sstore` primitives | **missing in rs** |
| Reserved words | all roots + all global fn names (:841) | `revert`/`require`/`log` only; roots shadowable | **different by design** |

---

## 5. Capability gating: one matrix + one pass vs. scattered assertions

Both compilers reject target-unavailable constructs; the structure differs.

**TS compiler** (inventory `C6`/`C7`): `assertCapability(ctx, name, …)` calls inline in `globals.ts`'s
per-global compile closures, consulting a string-keyed table, checked *while emitting* that
construct — plus a set of bespoke one-off guards landed as bugs were found:
`assertNoNestedArrayLiteral` (v12/svm-only nested-array rejection, `K12`),
`assertNoDynamicVariableObjectField` (`K13`), `rejectV1ScalarToDynamicReassignment` (`K8`), the
`multiOutputCall` tag (`K9`), and `ctx.isV12`/`ctx.isSvm` branches through `processor/`.

**compiler-rs**: `capability::check` is a dedicated pass between fold and codegen, walking every
reachable statement/expression, asking `backend.availability(feature)` per construct, and reporting
the **leftmost** unsupported one in source order (pinned by
`the_leftmost_unsupported_construct_is_the_one_reported`, `capability.rs`). The same matrix is
consulted from the *lowering-time* gate too (`require_available`) — `targets.rs:172-176` documents
this explicitly as *"the single mapping both gates read … so they cannot ask about different cells
for one call."* One matrix, two call sites, cannot drift.

The practical difference is where new work lands: in compiler-rs a new divergence is a matrix cell
plus a registry row; in the TS compiler it has repeatedly been a new bespoke `assertNo*` function.

---

## 6. Target model: v12 + svm only

`options.rs:6-12`:

```rust
pub enum Target {
    /// The EVM target — the v12 Huff runtime (full canonical instruction set).
    Evm,
    /// The SVM target — the Solana engine (a constrained subset of the canonical set).
    Svm,
}
```

Two variants, no third. No v1 byte-encoding path exists anywhere in `sauce-core`. This matches the
inventory's own porting-scope statement (lines 39-47): v1 is deprecated and deleted in sauce `main`.

The consequences are large and mostly **subtractive** — a whole class of TS-compiler machinery is
legacy context rather than a porting gap:

- v1's out-of-band `ctx.dynamicResult` dynamic-value model (v12/svm use one in-band 32-byte
  descriptor word) — `G24`, and the root of most of Category `K`.
- v1's `funcHeap`/`funcValues` two-index calling convention and the `K15` call-argument gap riding on
  it — the repo `CLAUDE.md` already records that this gap is **v1-only** and confirmed absent on
  v12/svm by real execution on all three engines.
- The `K8`/`K9` v1 scalar→dynamic reassignment *rejections* — v12/svm derive kind from the value node
  (`V12Saucer.store` ignores its `_kind` parameter entirely), so they never needed them.
- v1 helper-declaration-order, and the v1 function-table index layout that `treeshake: false` exists
  to preserve.

Note also a *positive* consequence: compiler-rs assigns a `FunctionId` to every declared function in
one pass before lowering any body, so forward references and mutual recursion resolve uniformly with
no declaration-order restriction at all — the thing v1 needed a dedicated fix for (`CLAUDE.md`, "v1
helper-declaration-order fix").

---

## 7. Feature-parity table (by inventory category)

Legend — **same**: equivalent capability, comparable shape. **different**: same capability, different
shape or spelling (no port needed; a *decision* may be needed). **missing-rs**: present in the TS
compiler, confirmed absent in compiler-rs. **rs-ahead**: present in compiler-rs, absent or ad hoc in
the TS compiler. **moot**: v1-only, not a port target. **unknown**: not verified — see §9.

| ID(s) | Feature | TS compiler | compiler-rs | Verdict |
| --- | --- | --- | --- | --- |
| A1–A4 | `compile()` entry, options, target dispatch, fixed stage order | acorn → walk → assemble; `CompileOptions` w/ `label`, `baseDirs`, `contracts`, `args`, `staged`, `defines`, `cache`, `treeshake` | `compile()` over the staged pipeline; `CompileOptions{target, entry, contracts, optimize}` (`options.rs`) | **different** (much smaller surface; `optimize` is new, most TS knobs absent) |
| A5 | v1 `main()` arg segment | v1 | no v1 | **moot** |
| A6–A8 | v12 arg-prologue, staged svm `ArgsLayout`, arg value encoding | v12/svm | prologue exists (`lower/assembly.rs`); `ArgsLayout`/`staged`: zero grep hits | **unknown / missing-rs** |
| A9 | svm `accountPlan` + budget warnings | svm | `manifest.rs` — compiler-owned, reachability-gated `Manifest`/`AccountEntry` | **different** (format parity unverified) |
| L1 | uint256-only literals + `.raw` precision | acorn/TS literal parsing, two fixed evaluators | checked `ruint::U256`/`U512` in `fold.rs`; overflow is a compile error | **rs-ahead** |
| L2 | Operator set | broad; signed/modular opcodes exist with **no** surface (inventory Open Question #2) | `Math.sDiv/sMod/sShr/signExtend/addMod/mulMod` surfaced with documented revert semantics | **rs-ahead** |
| L3 | Control flow | `break`/`continue` v1-only; **hard error on v12/svm** (`G21`) | `Stmt::Break`/`Stmt::Continue`, loop-depth-gated (`lower/statement.rs`) | **rs-ahead** (closes the TS compiler's own open question) |
| L4 | Functions, `main()`, recursion, decl order | v1 needed a two-loop fix for forward refs | `FunctionId` assigned for all decls before lowering any body; `main` uncallable (`ENTRY_POINT`) | **rs-ahead** |
| L5–L7 | Arrays / objects / bytes | literal + `new Array(n)`, index/length/concat/slice; structs; bytes/string | `Expr::ArrayOfLength`, `Length`, `Slice`, `Concat`, `Ty::Tuple`, `Ty::Bytes`, `BytesMethod` | **same** |
| L8 | Persistent + transient storage | `storage.read/write` + `tRead/tWrite` | `evm.*`/`svm.*` sload/sstore split; **transient has no surface** | **different + missing-rs (transient)** |
| L9 | Crypto | `crypto.keccak256/ecdsaVerify` | same | **same** |
| L10 | `abi.encode`/`decode` | all targets | `Feature::AbiCodec`, **EVM-only** (SVM has no such opcode, `README.md:203`) | **different** (gating is a fact of the engines) |
| L11 | Context globals | 4 roots + 3 bare globals, 21 entry points | `ctx.*`, 7 methods; `ctx.gasPrice()` rejected by test | **missing-rs (partial)** |
| L12 | CREATE family + address prediction | v1/v12 | zero hits; `Create` named as future work (`targets.rs:67`) | **missing-rs (acknowledged)** |
| L13 | Raw external calls | `contract.call/static/delegate` | `evm.call/static/delegate` + `svm.call` | **different** |
| L14 | `emit()` events | builtin (`globals.ts:734`) | deliberately **not** a builtin — library concern over `log` (`lower/mod.rs:1703-1706`) | **different by design** |
| L15 | `eval()` compile-time nested compilation | builtin (`globals.ts:744`) | zero hits; `Eval` named as future work | **missing-rs (acknowledged)** |
| L16 | svm sugar: `uint`, `accountData`, `writeAccountData`, `accountUint` | bare globals | zero hits; only `svm.sload`/`svm.sstore` primitives | **missing-rs (sugar only)** |
| L17 | Reserved names, `var` rejection, top-level shape | `RESERVED_NAMES` = all roots + all global fns | 3 identifiers; roots shadowable; default-deny top-level gate | **different by design** |
| L18 | `` $`…` `` quasiquote bytecode construction | present | zero hits; tagged templates not in the accepted subset | **missing-rs** |
| D1–D3, D5–D6 | Const eval, top-level const registration, `if`/ternary folding | `evalConst`, `const-eval.ts`, fold transformers | `fold.rs` (constant subtree + assigned-once propagation); ternary lowered by `eval_order::normalize` into per-arm `Stmt::If` | **same** (narrower; see §3) |
| D4 | `CompileOptions.defines` | present | absent from `CompileOptions` (`options.rs`, 46 lines) | **missing-rs** |
| T1–T2 | Treeshake + fold-aware reachability | separate mechanism, recomputed per consumer | `reachability.rs`: computed once, pre-fold, shared by 4 consumers | **rs-ahead** |
| TS1–TS8 | ts-frontend seams, evaluators, shadow-safety, branch/ternary folding | 8 features, TS-path only, two evaluators | one frontend, one IR; `fold.rs` + `eval_order` cover part | **different + partly missing-rs** |
| TS9–TS11 | Const propagation to reads, dead-decl elimination, effectively-const `let` | present | `fold.rs`'s assigned-once propagation ≈ `TS11` PRIMARY; STRETCH shape unverified | **partly same / unknown** |
| TS12–TS14 | Lookup-table folding, local `new Array(n)` folding, `return arr;` escape fold | present | absent | **missing-rs** |
| TS15–TS16 | Local per-function const propagation, ternary in the local pass | present | absent as a distinct pass | **missing-rs** |
| U1–U4 | Loop unrolling (numeric `for`, `while` idiom, `for...of`, splice drivers + 256 cap) | present | zero hits for `unroll`; `Stmt::Loop` is real runtime control flow | **missing-rs** |
| I1–I4, I6 | Inline (arrow-const) functions: extraction, bail conditions, splicing, cycle detection | present | absent | **missing-rs** |
| I5 | Inline dynamic-return placeholder seeding | v1 | no v1; and kind comes from a type, not a seeded placeholder | **moot** |
| M1–M4 | Source imports, per-target arm selection, bare specifiers, escape-root guard | ad hoc in `ctx.transformModule`/`collectImportedFunctions` | formal `Resolver` trait: tri-state `Ok(Some)`/`Ok(None)`/`Err` (absence ≠ failure, ECO-2033), `resolve_package` for bare specifiers, per-target arm probing (`token.evm.js`), core is I/O-free | **rs-ahead** |
| C1–C3, C5 | ABI JSON imports, `.at()/.view()/.lib()` binding, struct-arg ordering, `contracts` option | present | `lower/contract.rs`'s `inline_chain`/`contract_call`/`bound_contract`; `abi.rs`; `contracts` in `CompileOptions` | **same** (C3's ordering rule unverified — §9) |
| C4 | `.catch(handler)` chaining | all targets | `Feature::TryCatch` exists but `frontend.rs:956` rejects `try`/`catch`; no `Stmt::Try` in `ir.rs` | **missing-rs** |
| C6–C7 | Bidirectional capability gate, `SVM_UNSUPPORTED` profile | scattered `assertCapability` + bespoke guards | one `Feature`×`Backend::availability` matrix, one pass, two call sites | **rs-ahead** |
| K1–K3, K10–K11, K13–K14 | Storage-kind model, `inferKind(WithContext)`, destructuring lowering, ternary promotion, dynamic-field / packed-write rejections | 9 documented bug generations | checked `Ty` → distilled `is_dynamic`/`ElementTag` at lowering | **different by design** (port the invariant, not the mechanism) |
| K4–K9, K12, K15 | Return-kind fixpoint, bound-contract tracking, destructuring kinds, single-dynamic-output, v1 rejections, nested-array rejection, known gaps | mostly v1 | no v1; `K12` is an engine-level v12/svm gap, status in rs **unverified** | **moot / unknown (K12)** |
| G1–G7, G9, G11–G20, G24 | Opcode tables, encoders, slot allocation, v12 postfix core, parameter frame, sentinel patching, jump upgrades, descriptor model | present | `targets.rs` `Opcode`/`OpcodeProfile`, `codegen.rs` (6,370 lines), `scope.rs` (live-range/spill), `push_order.rs`, budget-ladder retry | **unknown** (byte-level parity not audited) |
| G8, G10 | v1 memory model, v1 prefix builder | v1 | no v1 | **moot** |
| G21 | v12 `break`/`continue` unsupported | gap in TS | implemented in rs | **rs-ahead** |
| G22–G23 | svm `AccountRegistry`, packet budget estimator | svm | `manifest.rs` covers the registry role; budget estimator **unverified** | **partly same / unknown** |
| X1–X3 | Compile cache, defensive clone, bounded LRU | present | zero hits for a cache in `sauce-core` | **missing-rs** |

**Rough tally.** `rs-ahead` on architecture and on a handful of language items (`L2`, `L3`, `L4`,
`T1`/`T2`, `M1`–`M4`, `C6`/`C7`, `G21`); `missing-rs` concentrated in the optimization families
(`TS12`–`TS16`, `U1`–`U4`, `I1`–`I4`), the long tail of the language surface (`L11` partial, `L12`,
`L15`, `L16`, `L18`, transient storage, `C4`), and the API/ergonomics tail (`D4`, `X1`–`X3`);
`different by design` on `L14`, `L17`, and the whole Kinds category; `moot` on everything v1.

---

## 8. What compiler-rs has that is not a gap to "fix"

Named explicitly so the plan doc does not mistake a design improvement for a missing feature:

- **The `Ty` type system** (§1) — replaces the Kinds category by construction.
- **`eval_order.rs`** — normalizes JS left-to-right evaluation order by hoisting order-sensitive
  operands into source-order temporaries, unconditionally, at every `-O` level. It is also where
  `Expr::Conditional` is lowered into a real per-arm `Stmt::If` (and where `&&`/`||` land, since
  `a && b` lowers to `a ? !!b : false`), so only the taken arm's bytecode exists after this pass. The
  TS compiler has no generalized equivalent.
- **`scope.rs`** — a real live-range/spill placement analysis over the bounded stack-slot budget,
  paired with `codegen`'s budget-ladder retry (`emit_function_within_budget`), which *discovers* a
  feasible per-function frame budget because the feasible placement set is not downward-closed. The
  TS compiler allocates slots with a scope free-list (`G9`) and has no retry ladder.
- **`dead_store.rs`** — rewrites an unread `Stmt::Assign` into a bare `Stmt::Expr` so a dead local
  never takes a stack slot; ordered after `eval_order` because `push_order` treats
  `Expr::Conditional` as a leaf. Whether the TS compiler *needs* an equivalent is a different memory
  model's question — flagged **UNCONFIRMED**, not asserted as a TS gap.
- **`Resolver`'s tri-state contract** — `Ok(None)` (absent, fall back) vs `Err` (present but
  unreadable, surface it). `resolver.rs:21-27` records the bug this fixed (ECO-2033): probing
  `token.evm.js` before the neutral arm means a *broken* arm must not be silently replaced by the
  neutral one.
- **`function_fingerprint` alignment check** — a `Result`-returning guard in every build (not a
  `debug_assert!` compiled out of release/wasm) that `fold`/`eval_order`/`dead_store` preserved index
  alignment of `ir_program.functions`.
- **Panic discipline for WASM** — an `Expr::Conditional` surviving past `eval_order` is reported as a
  *diagnostic*, not an `unreachable!`, specifically because a panic in the published WASM package is
  an unrecoverable abort with no JS-visible `Error`.
- **Structured diagnostics** — `error_stack::Report<E>`, per-module `thiserror` enums, rustc-style
  caret rendering via `annotate-snippets`, and all-violations-at-once collection in `frontend::check`.
  The TS compiler throws plain `Error`s with no spans.

---

## 9. Uncertainties — what this doc does not claim

Read this section before scheduling work off the table in §7.

1. **`codegen.rs` (6,370 lines) and most of `lower/assembly.rs` (3,869) were not read in full.** Every
   `G1`–`G24` row and the `A6`–`A8` row is therefore **unknown**, not confirmed. No byte-level opcode
   table diff was performed.
2. **compiler-rs's own correctness was not empirically tested.** No anvil / LiteSVM execution was run
   for this doc. The `Ty`-vs-heuristic argument in §1 is architectural. A structurally better design
   is not automatically a bug-free one.
3. **`C3`'s struct-arg ordering** — the TS compiler had a real bug here (alphabetical instead of
   ABI-declared component order, scrambling `SwapParams`'s nested `PoolKey` into an empty revert;
   repo `CLAUDE.md`, "The swap Router"). `lower/contract.rs`'s `abi_param_shape` and the
   `an_unnamed_multi_output_projects_by_index` test were seen but not read closely enough to prove
   compiler-rs cannot reproduce that specific bug class.
4. **`TS11`'s STRETCH shape** (`let x; x = <init>;` predeclaration-then-assignment) — `fold.rs`'s
   `assigned_once` plausibly subsumes `TS11` PRIMARY, but the STRETCH pair was not confirmed either
   way without a deeper read of `fold.rs`'s 1,360 lines.
5. **`fold.rs`'s shadowing model** was not audited against the exact `if`/`while`-scope-sharing bug
   family the TS compiler fixed **four separate times** in four different passes (`const FEE = 100n;
   function f(cond) { if (cond) { let FEE = 5n; } return FEE; }` — see the repo `CLAUDE.md`). This is
   the single highest-value audit target, because the real SauceScript compiler shares scope across
   `if`/`while` bodies and every TS-side pass that forgot this produced a wrong program, not a missed
   optimization.
6. **`manifest.rs` vs the SDK's `accountPlan`** (`A9`/`G22`) — conceptually aligned
   (reachability-gated, compiler-owned, ordered attach contract) but not compared field-for-field
   against the SDK's consumer code.
7. **`K12`** (nested-array-literal rejection) — a v12/svm *engine* gap the TS compiler closed with a
   compile-time guard. Whether compiler-rs rejects, supports, or silently miscompiles a nested array
   literal was not checked.
8. **Whether the `evm.*`/`svm.*` split and the `ctx.*` unification are documented as decisions** in
   the design spec `docs/superpowers/specs/2026-07-02-sauce-rust-compiler-design.md` (referenced by
   `lib.rs:8`) was not checked — that file is outside `crates/sauce-core/src`. §4's rule citation is
   from `compiler-rs`'s `CLAUDE.md`, which is authoritative enough for the rule itself.
9. **`abi.rs`'s doc comment is stale**, not a gap: it says *"nothing consumes a `ContractAbi` yet,
   since contract-calling syntax is a later milestone"*, while `lower/contract.rs` visibly implements
   and tests both contract-call shapes. Read as a doc rot, but not resolved further.
