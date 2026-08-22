I have everything needed. All facts are confirmed from source.

---

# Compiler-parity triage — PR-13, PR-15/16, PR-5, PR-12

## Verdict table

| Item | Verdict | Effort | eco-swap needs it? | Typical programs? |
|---|---|---|---|---|
| **PR-13** `new Array(n)` | **PORT** | **S** (frontend-only; IR + codegen already exist) | Yes (main recipe: 96 uses; RS parity met only via the hand-`unrolled` variant that avoids it) | Yes — it's the idiomatic mutable/sized-array spelling |
| **PR-15/16** inline arrow-const fns | **DIVERGENCE** (optional S surface-compat desugar) | S if built | No | Rarely — real `function` fully covers the semantics on RS |
| **PR-5** try/catch | **DEFER** (SVM half is a hard **DIVERGENCE**) | L | No (not in the RS parity target) | Occasionally (`.catch()` in `qldiscover`) |
| **PR-12** for…of | **DIVERGENCE** (optional M desugar) | M if built | No | Rarely — indexed `for` covers it |

Recommended build order (value/cost): **PR-13 → (stop)**. The other three are documentation-registry entries, not builds, unless a specific program forces surface compatibility.

---

## PR-13 — `new Array(n)` — PORT (S)

### Finding: this is a frontend-only gap; the entire runtime primitive already exists in RS

RS has **no `NewExpression` handling anywhere**. `check_expression`'s allowlist (`frontend.rs:571-595`) has no `Expression::NewExpression` arm, so `new Array(3)` falls to `_ => reject(expression, unsupported_expression(expression))` (`frontend.rs:594`) → `"this expression is not supported in the M1 subset"` (`frontend.rs:600`). Confirmed: zero `NewExpression`/`Expression::New` references in the whole core crate.

But the semantic capability `new Array(n)` provides — a zero-initialized, runtime-sized, **mutable** heap TUPLE filled by `SET_INDEX` and read by `INDEX` — **already exists fully built and conformance-tested on both engines**:

- **`Expr::ArrayOfLength { element: ElementTag, len: Box<Expr> }`** (`ir.rs:468`): documented verbatim as "a `len`-element array whose elements are all zero, with `len` known only at runtime — always dynamic. The write twin is `Stmt::SetIndex`, which fills it." Codegen `MALLOC`s a runtime-sized region and rebuilds the descriptor word (`ir.rs:459`); elements start zero on both EVM and SVM (`ir.rs:466`). It exists today to serve caller-supplied-length entry parameters — i.e. the harder, runtime-length case is *already solved*.
- **`Stmt::SetIndex`** (`ir.rs:760`) — element write, with `element_is_dynamic` + `index_is_statically_in_bounds`, boxing scalars as descriptors on EVM.
- **`Expr::Index`** (`ir.rs:~476`) — `INDEX` (`0x97`, `targets.rs:495-498`), reverts out-of-bounds.
- Array elements are **mutable**: `lower/statement.rs:2054` — "`const` makes the *binding* immutable, not the container — mutating an element in place [is fine]"; `arr[i] = v` lowers through `assign_index` (`lower/statement.rs:871`) → `Stmt::SetIndex` (`lower/statement.rs:911`). The frontend already accepts `a[i] = e` as an assignment target (`frontend.rs:859-870`).

So RS's array-literal (`Expr::Array`, `frontend.rs:644` / `lower/expression.rs:106`) is already a mutable heap array, and the runtime-length zero-init variant already exists. `new Array(n)` is **pure frontend sugar** onto `Expr::ArrayOfLength` — no new IR node, no new opcode, no new codegen. This is materially cheaper than the TS implementation (which additionally carries an elaborate constant-fold/return-escape pass; RS needs none of that for parity — that's separate optimization work).

### Build sketch (red→green)

1. **`frontend.rs` — `check_expression`**: add an `Expression::NewExpression(new)` arm accepting exactly `new Array(<expr>)`: callee must be the identifier `Array`, exactly one non-spread argument (recurse `check_expression` on it); reject `new Array()`, `new Array(a, b)`, and any other `new Foo(...)` with a targeted message. (Mirror the shape of `check_call`, `frontend.rs:~900`.)
2. **`lower/expression.rs`**: add a `NewExpression` → `Expr::ArrayOfLength { element: ElementTag::Scalar, len: <lowered arg> }` lowering, next to the array-literal lowering (`lower/expression.rs:106`).
3. **Type/element resolution** — the *one* real design point: what static `Ty` does `new Array(n)` carry, and what feeds `SetIndex.element_is_dynamic`? Reuse exactly what the ABI-derived / entry-parameter `ArrayOfLength` path already uses (the `len:0` unknown-length sentinel array-of-scalar type; see `ir.rs:760` doc — a length-`0` sentinel array already flows through `SetIndex` with `index_is_statically_in_bounds:false`). `new Array(n)` should adopt the same "unknown static length" treatment so element writes get the runtime bounds guard and scalar-boxing exactly as the existing path does. If the type checker needs the element type before first write, default to scalar (matches TS: `new Array(n)` is a generic scalar-slot TUPLE).
4. **`capability.rs`**: `ArrayOfLength` already lowers on both targets, so no new `Feature` gate.

**Tests (red→green):**
- Frontend accept/reject unit tests (sibling to `accepts_an_array_literal_and_indexing`, `frontend.rs:1481`): accept `new Array(n)`; reject `new Array()`, `new Array(1,2)`, `new Foo()`.
- Lowering test asserting `new Array(3)` → `Expr::ArrayOfLength` (sibling to `lowers_a_scalar_array_set_index`, `lower/statement.rs:2146`).
- Golden/conformance: `function main(){ const a = new Array(3); a[0]=1n; a[1]=2n; a[2]=3n; return a[1]; }` returns `2n` on EVM and SVM. Reuses the existing `ArrayOfLength` execution harness.

**Risk: Low.** The novel surface is one frontend arm + one lowering arm onto a proven node. The single subtlety is element-width/dynamism at first write — de-risked by inheriting the existing `ArrayOfLength` element treatment rather than inventing one. Note a genuine *semantic-parity* nuance to document: RS's `ArrayOfLength` accepts a **runtime** `len`, whereas TS `new Array(n)` runtime construction also works but TS's *fold* only handles constant `n`; RS is strictly more capable here, so this is a superset, not a divergence.

---

## PR-15/16 — inline arrow-const functions — DIVERGENCE (optional S desugar)

**Finding: RS rejects arrow/function expressions wholesale, and real table functions fully cover the semantics.** `const f = (x) => …` has its initializer checked via `check_declarator` → `check_expression`, where neither `ArrowFunctionExpression` nor `FunctionExpression` has an arm → `_ => reject("this expression")` (`frontend.rs:594`). So a program literally spelled with `const f = x => …` fails to compile on RS.

But the *capability* inline-arrow exists to provide is already present:
- RS has real table functions with **no "only main may call" restriction** (the TS-v1 quirk): `export function helper(a){...} function main(){ return helper(1n); }` is a passing frontend test (`frontend.rs:1760`), and the only call restriction is that the entry point itself cannot be called (`lower/mod.rs:107`). Reachability drops unreachable functions (`reachability.rs`).
- **PR-14 already folds** a pure, single-return, no-nested-call callee at a const-arg call site: `FoldableCallee` (`fold.rs:24`), `collect_foldable_callees` (`fold.rs:37`), `try_fold_call` (`fold.rs:82`) — this is exactly the `tickArg`/`kyberOut` guard-clause perf case that motivated TS inlining, minus the arrow syntax.

TS's inline-arrow is a **splice-based sugar** (alpha-rename + return-elimination, `processor/inline.ts`) whose entire purpose is ergonomic (guard-clause helpers without a `function` and without CALL_FUNCTION overhead). On RS the semantics are covered by writing `function f(...)`, and the perf is covered by PR-14. **This is a deliberate RS architectural choice: real functions + const-arg fold instead of a splicer.** Document in the divergence registry.

**Optional surface-compat PORT (S), only if a real program must compile as-written:** desugar a top-level `const NAME = (params) => body` into a `FunctionDeclaration` in the frontend *before* the subset walk — concise body → `return body;`, block body → as-is — then reuse all existing table-function machinery. No splicer, no inlining pass needed for correctness (PR-14 will fold the const-arg cases anyway). Bail (keep rejecting) on any arrow with a shape RS functions don't support (destructured params, nested closures). Risk low, but there is **no demonstrated program that needs it** — recommend registry entry, not a build.

---

## PR-5 — try/catch — DEFER (SVM half a hard DIVERGENCE)

**Re-confirmed: DEFER, and the SVM half is structurally a DIVERGENCE.**

- Frontend rejects the `try`/`catch` statement (`frontend.rs:956`).
- There is **no `.catch()` chain surface** either (RS's only "catch" references are the parser's default-deny catch-all and unrelated comments).
- The abort *direction* of error handling **is** expressible on RS today: `throw <payload>;` is in the subset and lowers to the same `REVERT` as `revert(...)` (`frontend.rs:564-568`); combined with `if`, that covers all `require`/revert-style guards. What RS *cannot* express is **catching a failed external call and continuing** — the TS `.catch()` mechanism (`resolveCatchChain`), used in `ecoswap.qldiscover.sauce.ts` (`.catch(() => …)` on 6+ QL probe calls).
- The capability is **already modeled as reserved-but-absent**: `Feature::TryCatch` = "`try`/`catch` (the `CATCH` opcode). **EVM-only.**" (`targets.rs:110-111`); `Availability::Unavailable` on SVM with reason "the SVM engine has no try/catch" (`targets.rs:1131`); and **no source surface** — `require_feature`/the gating matrix explicitly note `TryCatch` "has none yet" (`lower/mod.rs:1412`, `lower/mod.rs:4019`).

**Why DEFER, not PORT-now:** a full port needs (a) a frontend carve-out (the closure argument to `.catch()`, or the try/catch statement + its handler block — a closure body, which the subset otherwise bans), (b) a **new IR node** RS lacks (`Stmt::TryCatch` / a call-with-handler), (c) a **new codegen primitive** — emitting the EVM `CATCH` opcode with an inlined handler — and (d) it is **inherently EVM-only**: the availability matrix already encodes that SVM has no equivalent, so any SauceScript using it is non-portable by construction. That last point makes the SVM side a permanent DIVERGENCE to document regardless. Cost L, and the RS parity target (`ecoswap.unrolled`) doesn't use it. Park with the above rationale; if built later, the EVM `CATCH` opcode is the enabling primitive and the TS `resolveCatchChain` inline-handler design is the reference.

---

## PR-12 — for…of — DIVERGENCE (optional M desugar)

**Finding: RS rejects `for…of` entirely** (`unsupported_statement`: `ForOfStatement => "a for...of loop"`, `frontend.rs:959`; `for…in` likewise). It has **no `for…of` surface**.

The capability is covered by indexed numeric `for` loops, which RS supports **and unrolls**: `unroll.rs` is a full numeric `for`/`while` IR→IR unroller mirroring TS's `MAX_UNROLL_ITERATIONS` (`unroll.rs:1,15`), and array element reads/writes work (PR-13 findings above). So `for (const x of TABLE)` is expressible as `for (let i=0n; i<N; i++) { … TABLE[i] … }`.

TS's `for…of`-over-a-lookup-table unroll is a convenience layered on PR-11 module tables; note RS's module-`const` handling **substitutes each const at its use during lowering** (`ir.rs:54`, `frontend.rs:249`) rather than materializing an indexable module table, so a TS-style "unroll `for…of` over a module table" would first need the module-table representation to exist as an indexable value — i.e. PR-12 on RS is **not** a small add on top of the numeric unroller the way it is on TS. Given (a) indexed `for` fully covers the semantics, (b) the RS parity target doesn't use `for…of`, and (c) the module-table prerequisite is heavier on RS — recommend **DIVERGENCE** (document "RS authors use indexed `for`; RS unrolls those"). If surface-compat is ever forced: frontend-accept `ForOfStatement` over a resolvable array/table + a desugar-to-indexed-`for` pass feeding the existing `unroll.rs`; effort M, value low.

---

## Bottom line for the next fires

- **Build PR-13 now** — it's the one genuine author-facing parity gap, it's S (frontend-only onto the existing `ArrayOfLength`/`SetIndex`/`Index` machinery), and it's the difference between the real `ecoswap.sauce.ts` (96 `new Array`) compiling on RS vs. only the hand-maintained `unrolled` variant.
- **Register PR-15/16 and PR-12 as intentional divergences** (real functions + PR-14 fold; indexed-`for` + unroller) — no build unless a specific program forces syntax compatibility.
- **Defer PR-5**, and record the SVM half as a permanent divergence (the availability matrix already says so: `CATCH` is EVM-only). Abort-style handling already works on RS via `throw`.