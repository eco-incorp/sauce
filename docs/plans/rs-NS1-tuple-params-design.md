# NS-1 (RS): eco-swap Tuple params — design + build plan

*Produced by the compiler-parity fire#8 design agent (plain-text). File-cited against
`../sauce-compiler-rs/compiler/crates/sauce-core/src/`. **KEY FINDING: RS is a runtime-calldata-arg
engine that ALREADY decodes Array<Tuple<scalar>> entry params (green test assembly.rs:2266-2275) —
it must NOT copy TS arg-baking.** The gap is narrow: the bare name `Tuple` is not in the type
vocabulary. **Orchestrator decision (fire#8, autonomous, reversible): B1 — caller-supplied
entry_arg_types shape hint (types only, no baking, no value baking), NOT B2 (body-inference, which is
unsound: an unread field under-sizes the tuple and shifts the wire layout).** Build order: PR-1 (Tuple
infer-wildcard at local binding) → PR-2 (entry_arg_types hint) → PR-3 (eco-swap RS driver test).
Gate: cd ../sauce-compiler-rs/compiler && cargo test -p sauce-core. Commit each PR on green, no AI attribution.*

I have everything needed. Here is the design.

---

# NS-1 RS Design: eco-swap `Tuple` params on compiler-rs

## Bottom line up front

The task framed NS-1 as "RS needs TS-style `args` baking + a `Tuple` type." **The source says otherwise.** RS is a *runtime-calldata-arg* engine that **already decodes `Array<Tuple<scalar>>` entry params from the program input** — the exact shape eco-swap indexes — and there is an existing **passing test proving it** (`main(pools: { a: Uint256, b: Uint256 }[])` compiles today: `crates/sauce-core/src/lower/assembly.rs:2266-2275`). RS must **not** copy TS's arg-baking. The real gap is narrow and two-sited:

1. The bare name `Tuple` is not in the type vocabulary (`type_by_name`, `mod.rs:2056`) → `Error::UnknownType`. It appears at exactly **two** kinds of site in eco-swap and nowhere else (audited: the file has one function, `main`):
   - **3 entry params** `pools/routes/brackets: Tuple` (`ecoswap.unrolled.sauce.ts:40`)
   - **4 local bindings** `const dp/b/route: Tuple = <array>[idx]` (lines 70, 90, 209, 259) — each with an initializer that is an array-index read.
2. An entry param annotated `Tuple` carries **no shape** (arity differs: pools=10, routes=11, brackets=8) and has no initializer to infer from, so RS has nothing to build the decode against.

Everything structural (`arr[runtimeIdx]`, `arr.length`, `dp[literal]`, nested-read descriptor round-trip) already works once the value is typed `Array<Tuple<scalar×N>>`.

---

## 1. TS oracle — how `compile({args})` types + bakes main's tuple params

TS conflates **two** jobs into `args`: (a) infer each main param's kind/shape, (b) bake the values into bytecode.

- `ArgValue = bigint | string | ArgValue[] | ArgObject` (`compiler/src/index.ts:55`). eco-swap passes pools/routes/brackets as `ArgValue[]` of `ArgValue[]` of `bigint` (arrays-of-arrays).
- `compile()` sets `ctx.mainArgTypes = options.args.map(inferArgType)` (`index.ts:330-332`).
- `inferArgType` (`index.ts:252-271`): a `bigint`→`{kind:'scalar'}`; a nested **array** recurses — `{kind:'dynamic', elementType:{kind: inner.kind, element: inner.elementType}}` (`index.ts:259-268`). So `pools` (array-of-array-of-bigint) becomes a **dynamic array whose element is a dynamic array of scalars** — TS models the inner rows as **arrays**, not tuples, because baking needs no per-element stride.
- Those types flow to main's params: `processFunctionV12` / `processFunction` do `ctx.setVar(param.name, argType?.kind ?? 'scalar', argType?.elementType, argType?.structType, …)` (`src/processor/index.ts:529-537`, `548-554`). An **un-typed** param defaults to `'scalar'` — the same failure RS has.
- **Baking**: v1 appends `[CALL_FUNCTION, mainIndex, argCount, …encodeArgValue(args)]` (`index.ts:388-392`); v12/svm synthesize a no-param wrapper entry that **pushes literal arg values** then calls main (`index.ts:336-347`, `assembleV12WithArgs` `index.ts:606-621`). The `Tuple` annotation in the `.sauce.ts` source is **stripped by the ts-frontend and never consulted** — typing is 100% from `args`.

**Net:** TS bakes values *and* derives types from those values; the source annotation is decorative. This is the model the task assumed RS should copy — it should not.

---

## 2. RS current — params are typed from annotations and decoded at runtime

- `CompileOptions` (`crates/sauce-core/src/options.rs:29-58`) has `target, entry, contracts, optimize, defines` — **no `args`, no arg-type/shape field.** WASM surface is even smaller (`crates/sauce-wasm/src/lib.rs:243-259`, no `defines`).
- A param's type comes **only from its annotation**: `param_ty` (`assembly.rs:935-942`) → `annotation_ty`, defaulting an un-annotated param to `Ty::Scalar(Scalar::Number)` (`assembly.rs:939`). This is used identically by `module_tables` (call-site signature, `assembly.rs:986`) and `lower_function` (bound param locals, `assembly.rs:1514`).
- `Ty` **already has both** `Array { element: Box<Ty>, len: u32 }` (`mod.rs:1025-1028`) and `Tuple(Vec<(String, Ty)>)` (`mod.rs:1029`). The blocker is purely the **spelling**: `annotation_ty` resolves a `TSArrayType` → `Ty::Array` (`mod.rs:1903-1906`), an inline object type `{…}` → `Ty::Tuple` (`mod.rs:1907-1925`), and a **named reference** → `type_by_name` (`mod.rs:1932-1936`), which has entries only for `Uint256/Address/number/bigint/bool/boolean/bytes/string/void/Account` (`mod.rs:2056-2065`). A bare `Tuple` → `None` → `Error::UnknownType` (`named_type`, `mod.rs:2075-2082`).
- **RS main takes `param_count = 0`; every param is decoded from the program input `[program | arg0 | arg1 | …]` at runtime** by `entry_prologue` (`lower_function` `assembly.rs:1554-1568`; `entry_prologue` `assembly.rs:1630`). The collection arm handles `Ty::Array | Ty::Tuple | Ty::Bytes` (`assembly.rs:1684`) via `entry_collection_decode` (`assembly.rs:1853`): a scalar tuple is read inline (`assembly.rs:1933-1943`); an array allocates `Expr::ArrayOfLength` and fills each element with a static `Expr::Tuple` in a loop (`assembly.rs:2054-2093`), tagging `element_is_dynamic` when the element is a tuple (`assembly.rs:2080`).
- **Decodability constraint** (this is why the inner must be a *tuple*, not a nested array): `require_decodable_entry_param` (`assembly.rs:1798-1827`) admits `Ty::Array{element}` only when `element_words(element).is_some()`, and `element_words` (`assembly.rs:1761-1783`) returns `Some` for a scalar or a **tuple-of-scalars**, and **`None` for a nested `Array`** (`assembly.rs:1781`, `1807`). So `Uint256[][]` is *not* decodable; `Array<Tuple<scalar×N>>` **is**.
- **Structural ops already match eco-swap's usage:**
  - `arr[runtimeIdx]` → `computed_member` Array arm → `Expr::Index`, any scalar index (`expression.rs:206-227`), result = element type. `pools[i]`, `pools[p]`, `brackets[bi]`, `routes[r]` all use runtime indices ✅.
  - `arr.length` → `static_member` Array/Bytes arm → `Expr::Length` (`expression.rs:319-329`) ✅; a tuple has **no** `.length` (`expression.rs:331,335`), which is exactly why the *outer* must be `Array`.
  - `tup[literal]` → `tuple_index` requires a **number literal** index (`expression.rs:264-294`; non-literal → `Error::TupleIndexNotLiteral` `expression.rs:274-276`) and resolves positionally via `resolve_position` (name-agnostic, `mod.rs:2355-2361`). **Every inner index in eco-swap is a literal** (`dp[0..9]`, `b[0..5]`, `route[0/2/7]`) — audited — so the inner being a `Tuple` with synthesized/empty field names works ✅.
- **Local decl reconciliation**: `binding_ty` (`statement.rs:244-257`) treats an annotation as authoritative: `annotation_ty` → `check_assignable(declared, inferred)` → binding carries `refined_annotation(declared, inferred)`. `check_assignable`/`compatible` compare tuple **field names and arity** (`mod.rs:1499-1506`), so a bare rigid `Tuple` type could never be made assignable-from a 10-field positional tuple. The only coherent meaning for `Tuple` at a binding is **"infer from the initializer."**

---

## 3. THE CRUX — bake vs runtime, resolved from source

**Answer: runtime, no baking. RS should source the entry param's *type/shape* at compile time and let the *values* arrive at runtime via calldata — the opposite of TS.**

Evidence, all from source:

1. RS's whole entry-point design is runtime-arg: `main` is `param_count=0` and its params are *decoded* from `[program | arg]` (`assembly.rs:1554-1568`). Baking literal arg values (TS's `assembleV12WithArgs`) would fight this design head-on and duplicate a mechanism RS deliberately replaced.
2. The decode **already supports the exact eco-swap shape** — `Array<Tuple<scalar×N>>` — and there is a **green test for it today** (`assembly.rs:2266-2275`). Nothing needs to be built in the decoder or the engine.
3. What baking gave TS was *type inference from values*. RS gets the same information more cheaply from **shape alone** (arities), because it doesn't need the values at compile time. So RS needs the **type half** of TS's `mainArgTypes`, not the value half.

Therefore RS does **not** need an `args: Vec<ArgValue>` field. It needs:
- **(A)** `Tuple` accepted as an **infer-from-initializer wildcard** at a *local binding* (unblocks all 4 locals with zero external input), and
- **(B)** a compile-time **shape hint** for the *entry's* `Tuple` params (arities only) so `require_decodable_entry_param` / `entry_collection_decode` know the concrete `Array<Tuple<scalar×N>>` to generate.

Both keep `type_by_name`/`annotation_ty` unchanged for every *other* position (a `Tuple` return type, a non-entry param, an `abi.decode` leaf all stay `UnknownType` — preserving the ECO-2055 "reject what we don't recognize" invariant the codebase went to great lengths for).

**Why not fully baked (TS-style):** contradicts the engine lineage, duplicates the decoder, and requires a value-encoder the runtime path already replaced. **Why not a rigid `Tuple` type:** arity differs per param (10/11/8) and `compatible` compares arity/names, so no single fixed type satisfies both the three params and the four locals. **Why not usage-inference for params (B2 below):** possible but fragile and philosophy-violating — see Open Questions.

---

## 4. Ordered sub-PRs

### PR-1 — `Tuple` as an infer-wildcard at a local binding (unblocks all 4 locals)

- **Files/functions:**
  - `crates/sauce-core/src/lower/statement.rs` — `binding_ty` (`:244-257`). Before calling `annotation_ty`, detect a wildcard annotation and short-circuit to the inferred type.
  - Add a small predicate, e.g. `fn is_infer_tuple(ann: &TSTypeAnnotation) -> bool` (a bare `TSTypeReference` whose `reference_name` is `"Tuple"`, seen through `TSParenthesizedType` for parity with `annotation_ty`'s transparency rule at `mod.rs:1929`). Keep it local to `lower/statement.rs` (or `lower/mod.rs` next to `annotation_ty`).
  - **Do not** add `Tuple` to `type_by_name`/`target_free_type_by_name` (`mod.rs:2056`) — that would legalize `Tuple` everywhere and break ECO-2055.
- **Behavior:** `const dp: Tuple = pools[pidx]` → `binding_ty` returns `inferred` (the Array element `Tuple<scalar×10>`) verbatim; no `check_assignable`, no `refined_annotation`. A `Tuple`-annotated `let`/`const` **without** an initializer stays an error (grammar requires an initializer for `const` anyway).
- **Red→green test** (`lower/statement.rs` tests or `lower/mod.rs` tests): given a param already typed as an array-of-tuple (use a precise `{…}[]` param so PR-1 is testable independently of PR-2), assert
  ```
  function main(pools: { a: Uint256, b: Uint256 }[]): Uint256 { const dp: Tuple = pools[0]; return dp[1]; }
  ```
  compiles and `dp[1]` lowers to `Expr::Field { position: 1, is_dynamic: false }`. Red today (`UnknownType "Tuple"`), green after.

### PR-2 — entry-param shape hint (types only, no values, no baking)

- **New option:** `CompileOptions.entry_arg_types: Vec<Option<Ty>>` (or a serializable shape descriptor if `Ty` shouldn't be public — see Open Questions). `options.rs:29-58`, add `#[builder(default)]`.
- **Thread it** the way `defines` is threaded: `lib.rs:149-158` `lower::program(…, &options.defines)` → add arg after `defines`; `program()` signature `assembly.rs:169-178`; down to `assign_global_ids`/`module_tables` (`assembly.rs:908-928`, `961-…`) and `lower_function` (`assembly.rs:1477`), tagged so it applies **only to the entry module's `main`**.
- **Consume it in `param_ty`** (`assembly.rs:935-942`): when resolving the *entry `main`* params, if a param is annotated `Tuple` (the same `is_infer_tuple` predicate) and a hint exists at that position, return `hint[i].clone()`; if annotated `Tuple` with no hint, raise a clear new error (e.g. `Error::UntypedEntryTupleParam`) rather than `UnknownType`. Non-entry / non-`Tuple` params unchanged.
- **No decoder change needed** — `require_decodable_entry_param` (`assembly.rs:1798`) and `entry_collection_decode` (`assembly.rs:1853`) already accept `Array<Tuple<scalar>>`.
- **Red→green test:** feed the reduced eco-swap main signature with `entry_arg_types = [None×6, Some(Array<Tuple<scalar×10>>), Some(Array<Tuple<scalar×11>>), Some(Array<Tuple<scalar×8>>)]` and assert it compiles and the prologue emits `ArrayOfLength` + a fill loop per collection param. Red (`UnknownType`) → green.

### PR-3 — end-to-end eco-swap driver (the NS-1 acceptance gate)

- **File:** a new integration-style test in `crates/sauce-core` (e.g. `tests/ecoswap.rs` or a `lower/mod.rs` test) that compiles a **verbatim copy** of `ecoswap/ecoswap.unrolled.sauce.ts` (checked into RS `testdata/`, since the recipe repo is read-only) with `entry_arg_types` set for pools/routes/brackets. Assert `compile()`/`lower_program` returns `Ok`. This is the "eco-swap on RS" north-star, regression-locked.
- Depends on PR-1 + PR-2 (and on `IUniswapV2Pair`/`IStateView`/`IUniswapV3Pool`/`ISauceRouter`/`IERC20` ABIs being resolvable via `manifest_contracts` — reuse the recipe's ABI JSONs, already permitted as read inputs).

### PR-4 (downstream, out of NS-1 core, flag for orchestrator) — WASM + SDK arg-encoder

- Surface `entry_arg_types` in `crates/sauce-wasm/src/lib.rs` (`:243-259`, `:320-325`) so the SDK's RS path can pass shapes.
- The SDK/recipe **runtime** path must ABI-encode pools/routes/brackets into the exact layout `entry_collection_decode` reads: per collection param a head **byte-offset** word, then a tail `[count][elem0 fields inline]…` at a fixed per-element stride (`assembly.rs:1832-1852`, `2096-2114`). This is different from TS's baked layout and is required to *run* (not to *compile*) — belongs in the SDK glue in `sauce-sdk`, **not** in `../sauce-recipes`.

---

## 5. Risks

- **Philosophy tension (main risk).** The codebase deliberately rejects loose/inferred types (ECO-2055, `mod.rs:2013-2017`, and the `same_shape` field-name rationale `mod.rs:1091-1111`). A wildcard `Tuple` and a shape-hint override are a controlled loosening. Mitigation: confine `Tuple` special-casing to the two named sites (local binding + entry param); keep `type_by_name` rejecting `Tuple` everywhere else, so a `Tuple` return type or a non-entry `Tuple` param stays a hard error.
- **Test to flip:** `parentheses_around_a_type_are_transparent` (`mod.rs:3889-3913`) uses `main(a: (Tuple))` as its example of `UnknownType`. Under PR-2 an *entry* `Tuple` param with no hint should error with the **new** `UntypedEntryTupleParam`, not `UnknownType`. Update that test to use a genuinely unknown name (e.g. `Blob`) for the transparency assertion so it still tests what it means to.
- **Arity fidelity / wire-layout coupling.** The hinted arity (10/11/8) *is* the runtime decode stride (`assembly.rs:1991`, `2003`). If the hint disagrees with what the SDK encoder produces, the program silently reads shifted words (both engines' `SLICE` clamps, `assembly.rs:1846-1848`). Mitigation: single source of truth for the arities shared by the RS hint and the SDK encoder (PR-4).
- **`Ty` in the public API.** Exposing `Ty` (an internal `pub(crate)` enum, `mod.rs:1014`) via `CompileOptions` leaks a lot of surface. Prefer a minimal serializable shape descriptor (e.g. `enum ArgShape { Scalar, Bytes, ScalarTuple(u32), ArrayOf(Box<ArgShape>) }`) that lowers to `Ty` internally. See Open Questions.
- **`optimize`/`fold` interaction.** `dp[5]` needs a literal index; `fold` runs on the IR *after* lowering, so a `const i = 0n; dp[i]` would still be `TupleIndexNotLiteral` (`expression.rs:251-257`, ECO-2060) — but eco-swap uses only bare literals, so no exposure here. Do not regress by trying to route inner indices through arrays.

---

## 6. TS tests + eco-swap shapes to borrow as drivers

- **RS's own existing green test is the best oracle:** `assembly.rs:2266-2275` (`main(pools: { a: Uint256, b: Uint256 }[])` decodes an array-of-tuples) — proves the target machinery; PR-1's driver is this shape plus a `Tuple`-annotated local. `assembly.rs:2278-2289` (`bytes[]` → `EntryParamShape`) pins the decodability boundary; keep it green.
- **eco-swap sub-shapes** (from `ecoswap.unrolled.sauce.ts`) as minimized cargo drivers:
  - outer runtime index + `.length`: `for (let i=0;i<pools.length;i=i+1){ const dp: Tuple = pools[i]; … }` (lines 68-70, 193, 254).
  - inner literal projection through a wildcard local: `const dp: Tuple = pools[p]; const feePpm: Uint256 = dp[5];` (209-211) — arity 10.
  - three different arities in one program (pools 10 / routes 11 / brackets 8) to exercise per-param hints.
  - multi-output-call `[literal]` (already supported; keep as a non-regression): `IUniswapV2Pair.at(dp[1]).getReserves()[0]` (116) — a tuple index on a call return, same `tuple_index` path.
- **TS side** (`compiler/test/…`) is not directly borrowable because TS bakes; use it only to confirm the *accepted source* is identical (parity), not the mechanism.

---

## 7. Open questions for the orchestrator/user

1. **Shape-sourcing method (the real decision).** Recommended **B1: caller-supplied `entry_arg_types` hint** (types only, no baking). Alternative **B2: infer each entry `Tuple` param's `Array<Tuple<scalar×N>>` shape from body usage** (outer used with runtime index/`.length` ⇒ Array; `dp = pools[i]; dp[k]` literal k ⇒ element = tuple of `max(k)+1` scalars). B2 needs zero external input and compiles the source verbatim, but is a whole-body shape-unification pass, is **fragile** (a row field never read under-sizes the tuple and shifts the wire layout), and cuts against RS's explicit-annotation philosophy. **Decision needed: B1 (new option, cleaner, fidelity guaranteed) or B2 (zero-config, riskier)?**
2. **Where the hint is supplied for the production path.** The `.sauce.ts` **source** is untouched under both options (good — respects the read-only recipe rule). But B1 needs the *compile invocation* to pass arities. The RS driver test passes them in-test; the real SDK→RS call would build them in **sauce-sdk** glue. Confirm the eco-swap RS compile call will live in sauce-sdk (editable), not in ../sauce-recipes (read-only). If it must live in sauce-recipes, B1 is blocked and B2 becomes mandatory.
3. **Public API shape for the hint.** Expose internal `Ty` on `CompileOptions`, or add a minimal `ArgShape` descriptor that lowers to `Ty`? (Recommend `ArgShape` to avoid leaking `pub(crate) Ty`.)
4. **`Tuple` naming/semantics.** Accept the recipe's `Tuple` spelling as the wildcard keyword, or introduce a distinct spelling and treat `Tuple` as an alias? (The recipe is fixed on `Tuple`, so it must at least be accepted; the question is only whether to document it as the canonical infer-wildcard or as a compat alias.)

**No implementation performed. No files/tests/cargo/commits touched.** Key source anchors: `crates/sauce-core/src/options.rs:29-58`; `lower/assembly.rs:169-178,935-942,1477-1568,1630-1718,1761-1827,1853-2114,2266-2289`; `lower/mod.rs:1014-1044,1445-1509,1772-1795,1892-1949,2035-2088,2355-2361,3889-3913`; `lower/expression.rs:196-393`; `lower/statement.rs:244-257`; TS oracle `compiler/src/index.ts:55,252-271,330-392` and `src/processor/index.ts:529-554`; recipe `ecoswap/ecoswap.unrolled.sauce.ts:37-40,68-90,193-264`.
