I have everything needed. Here is the design.

---

# Design: named/nested entry-parameter shapes (`cfg`) for compiler-rs

## 0. TL;DR

The diagnosis in fire#20 is **correct and confirmed from source**. `Ty::Tuple` already carries field _names_ and the entire read-side (named `.field` resolution, nested `Expr::Field`) already works. The gap is exactly two-fold:

1. **`ArgShape`** (the public, caller-supplied descriptor) has no variant that can express a _named_ or _nested_ tuple — only flat, empty-named `ScalarTuple(n)`. So `cfg`'s real shape can't be supplied, and `cfg.tokenIn` / `cfg.chain.rfqRouter` have no names to resolve against. → **Fix is small (S).**
2. **The entry decode** (`entry_collection_decode` + `element_words`) only handles a _flat_ scalar tuple; a nested-tuple field is rejected by `require_decodable_entry_param` and would be mis-read (1 word per field) even if admitted. → **Fix is medium (M).**

And a **separate, independent third blocker** exists that the capstone couldn't reach: `rfqSigs: Tuple` is a **`bytes[]`** (array of _dynamically-sized_ elements), which the RS entry decode explicitly does _not_ implement yet (`Error::EntryParamShape` "not yet"). This is unrelated to nesting and is **L**. It will block the full recipe _right after_ `cfg` is fixed — flag it for the acceptance probe.

---

## 1. Confirming the diagnosis from source

### `Ty::Tuple` already carries names — the read side is complete

- `Ty::Tuple(Vec<(String, Ty)>)` — `lower/mod.rs:1073`. Named, arbitrarily nestable.
- Named field read resolves by name: `static_member` → `resolve_field` → `Expr::Field { object, position, is_dynamic }` — `lower/expression.rs:516-533`, `resolve_field` at `lower/mod.rs:2354-2369` (`.position(|(field_name, _)| field_name == name)`).
- A nested tuple field is dynamic (`Ty::is_dynamic`, `lower/mod.rs:1095-1097`), so `cfg.chain` lowers to `Expr::Field{…, is_dynamic:true}` (a Tuple descriptor) and `cfg.chain.fluidResolver` is `Field(Field(cfg, chain_pos), fluid_pos)` — a plain composition that already works.
- Codegen for a nested `Expr::Tuple` already exists and is exercised: `object_literal` builds `Expr::Tuple(items)` where each item is `self.expr(&property.value)`, so a nested object-literal value yields a nested `Expr::Tuple` (`lower/expression.rs:188-226`). The EVM leaf cap that guards it is `MAX_EVM_STATIC_TUPLE_LEAVES = 2047` (`targets.rs:65`); `cfg` has **21 leaves** (14 top-level scalars + 7 under `chain`), far under it.

So nothing on the type/read/codegen side needs changing. The read side is _waiting_ for a nested named `Ty::Tuple` to be handed to it.

### `ArgShape` is the wall

`options.rs:79-112`:

```rust
pub enum ArgShape {
    Scalar,
    Bytes,
    ScalarTuple(u32),          // fields all scalar, ALL EMPTY-NAMED
    ArrayOf(Box<ArgShape>),
}
```

`to_ty` (`options.rs:96-111`) builds `ScalarTuple(n)` as `(0..n).map(|_| (String::new(), Ty::Scalar(Number)))` — **empty names, one nesting level of scalars only**. There is no way to spell `("chain", <tuple>)`. `to_ty` is `pub(crate)` so `Ty` never leaks to the public API (the NS-1/ECO-2015 principle, stated at `options.rs:78,96`).

Threading is already generic: `lib.rs:152-166` maps every `Option<ArgShape>` through `ArgShape::to_ty` into `Vec<Option<Ty>>` and hands it to lowering. Once `to_ty` can produce a named nested `Ty::Tuple`, the whole read path lights up with no other threading change.

`cfg`'s source annotation is the bare infer-wildcard `cfg: Tuple` (recipe `:1216`; `is_infer_tuple` at `lower/mod.rs:2013`), i.e. "the caller declares this shape out of band via `entry_arg_types`" — exactly the mechanism `ArgShape` feeds.

**Diagnosis confirmed.**

---

## 2. The exact shape `cfg` needs

A named tuple, one level of nesting, every leaf a scalar (`Uint256`/`Address` are both `Ty::Scalar(Number)` — the type distinction is erased to one word). Field **order must match the caller's wire encoder** (`index.ts buildSolverArgs`) — names resolve positionally, so order is load-bearing.

**Top-level (15 fields):**

| pos | name             | leaf                         |
| --- | ---------------- | ---------------------------- |
| 0   | `tokenIn`        | Scalar                       |
| 1   | `tokenOut`       | Scalar                       |
| 2   | `amountIn`       | Scalar                       |
| 3   | `recipient`      | Scalar                       |
| 4   | `quotedAmount`   | Scalar                       |
| 5   | `treasury`       | Scalar                       |
| 6   | `priceLimit`     | Scalar                       |
| 7   | `avgPriceLimit`  | Scalar                       |
| 8   | `directCount`    | Scalar                       |
| 9   | `minOut`         | Scalar                       |
| 10  | `directQlvCount` | Scalar                       |
| 11  | `rungBudget`     | Scalar                       |
| 12  | `zeroForOne`     | Scalar                       |
| 13  | `electBudgetBps` | Scalar                       |
| 14  | `chain`          | **nested tuple (7 scalars)** |

**`cfg.chain` (7 fields, all Scalar):** `fluidResolver`, `mentoBroker`, `rfqRouter`, `balancerV3Router`, `balancerV3Vault`, `balancerV2Vault`, `infinityVault`.

(Exact top-level positions/order of the scalar fields are the caller's to fix in `buildSolverArgs`; the 15 names above are the complete set actually accessed — verified: `grep cfg.<field>` yields exactly these, and `cfg.length` appears only in a comment. The recipe accesses **all 7** `chain` sub-fields.)

Expressed in the proposed `ArgShape` (see §3):

```rust
ArgShape::Struct(vec![
    ("tokenIn".into(),  ArgShape::Scalar),
    // … 13 more scalars …
    ("chain".into(), ArgShape::Struct(vec![
        ("fluidResolver".into(),   ArgShape::Scalar),
        ("mentoBroker".into(),     ArgShape::Scalar),
        ("rfqRouter".into(),       ArgShape::Scalar),
        ("balancerV3Router".into(),ArgShape::Scalar),
        ("balancerV3Vault".into(), ArgShape::Scalar),
        ("balancerV2Vault".into(), ArgShape::Scalar),
        ("infinityVault".into(),   ArgShape::Scalar),
    ])),
])
```

---

## 3. The fix — `ArgShape` extension (S)

Add one variant. Keep it a minimal, serializable, `Ty`-free public descriptor (NS-1). `Struct` is strictly more general than `ScalarTuple` (which is `Struct` of empty-named scalars), and it nests through `ArrayOf` for free.

```rust
// options.rs
pub enum ArgShape {
    Scalar,
    Bytes,
    ScalarTuple(u32),                    // KEEP — the flat pool/route/bracket rows still use it
    ArrayOf(Box<ArgShape>),
    /// A tuple with named — and possibly nested — fields. The eco-swap `cfg` shape.
    Struct(Vec<(String, ArgShape)>),
}
```

`to_ty` gains one arm (`options.rs:96`):

```rust
ArgShape::Struct(fields) => Ty::Tuple(
    fields.iter()
        .map(|(name, shape)| (name.clone(), shape.to_ty()))
        .collect(),
),
```

Update the doc-comment at `options.rs:73-90` (currently "a tuple whose fields are all scalars… A tuple's fields carry empty names") to describe the named/nested variant. No change to `lib.rs` threading — `to_ty` is already mapped generically (`lib.rs:155`).

Decision: **keep `ScalarTuple`** rather than fold it into `Struct`. The other seven recipe params (`pools`, `netCache`, `routing`, `segs`, `qlv`, `rfqs`) are `ArrayOf(ScalarTuple(n))` (verified: indexed positionally, `pools[i][6]`, `routing[i][0]` — flat scalar rows). No reason to churn them.

---

## 4. The fix — nested-tuple entry decode (M)

This is the substantive part. Two functions in `lower/assembly.rs` assume "one word per tuple field":

### 4a. `element_words` — recurse (`assembly.rs:1953-1975`)

Today it sums a tuple's fields only if each is `Ty::Scalar`, else `None` (`:1958-1961`). Make it recursive so a nested all-scalar tuple returns `Some(total_leaf_words)`:

```rust
Ty::Tuple(fields) => fields.iter()
    .try_fold(0u32, |total, (_, field)| Some(total + element_words(field)?)),
```

`Array`/`Bytes`/`Account`/`Void` still return `None` (unchanged) — so a nested `bytes`/array/account inside `cfg` remains correctly undecodable.

Consequence for free: `require_decodable_entry_param` (`assembly.rs:1990-2019`) already gates a `Tuple` param on `element_words(ty).is_some()` (`:1998`), so once `element_words` recurses, a nested-scalar `cfg` is **auto-admitted**. The `AccountInEntryParam` path (`:2009-2012`, via `contains_account`) still fires for a nested `Account`, correctly — a nested account is permanent-reject, not "not yet".

### 4b. `entry_collection_decode` Tuple arm — build nested descriptors (`assembly.rs:2124-2136`)

Today the Tuple arm does `Expr::Tuple(inline_fields(&base, fields.len()))`, and `inline_fields` (`:2106-2118`) reads exactly `fields.len()` consecutive words — **one per field**. For `cfg` this is wrong two ways: it would read 15 words (not 21), and field 14 (`chain`) would be a single garbage scalar word instead of a 7-field Tuple descriptor, and every offset past it would be skewed.

Replace `inline_fields` with a recursive field builder driven by `element_words` for stride:

```rust
// pseudo: build the Vec<Expr> of field values for a tuple whose data starts at `at` (a byte offset expr)
fn tuple_fields(read_word, at: &Expr, fields: &[(String, Ty)]) -> Vec<Expr> {
    let mut out = Vec::new();
    let mut word = 0u32;                       // running LEAF-word offset within this tuple
    for (_, field) in fields {
        let field_at = at + word * ARG_WORD_BYTES;
        match field {
            Ty::Tuple(inner) => out.push(Expr::Tuple(tuple_fields(read_word, &field_at, inner))),
            _ /* scalar */   => out.push(read_word(field_at)),
        }
        word += element_words(field).expect("checker rejected a dynamic field");
    }
    out
}
```

- The Tuple arm's `require_length` guard must use the **total leaf-word count** (`element_words(ty)`), not `fields.len()` (`assembly.rs:2126,2130`).
- The array-element case (`element_value`, `:2201-2204`) should call the same recursive builder so an array-of-nested-tuples works too — not needed by this recipe (pool rows are flat) but it makes the two paths consistent and costs nothing.

Each nested field becomes an `Expr::Tuple` — the exact same construct `object_literal` emits (`expression.rs:225`), so **no new codegen**; it flows through the existing `TUPLE`-opcode path and the `static_leaves`/`MAX_EVM_STATIC_TUPLE_LEAVES` machinery unchanged.

**Wire-layout contract:** this decode reads a static nested tuple as its leaves **inlined/flattened** at fixed stride (ABI-static-tuple convention — no offset indirection for a static inner tuple). The caller's `buildSolverArgs` must encode `cfg` the same way: head word = byte offset to `cfg`'s data; data = 14 scalar words then `chain`'s 7 scalar words, all inline (21 words). Both sides are under the recipe's control, so they simply need to agree; this is the natural agreement and matches what the flat-tuple decode already does.

---

## 5. Effort + red→green test plan

**Effort:** §3 = **S**; §4 = **M** (recursive builder + leaf-count guard + tests). **`cfg` overall: M.** The `rfqSigs` `bytes[]` blocker (§6) is a separate **L**.

**Test plan (all in `assembly.rs` `#[cfg(test)]`, alongside the existing `entry_tuple_params_take_their_caller_supplied_shapes` at `:2470` and `an_entry_parameter_shape_the_decode_cannot_read_says_so` at `:2520`):**

1. **`to_ty` unit** (options.rs tests): `Struct(vec![("a",Scalar),("chain",Struct(vec![("b",Scalar)]))]).to_ty()` == `Ty::Tuple(vec![("a",Scalar(Number)),("chain",Tuple(vec![("b",Scalar(Number))]))])`. Red before the variant exists (won't compile); green after.
2. **Red→green compile**: `main(cfg: Tuple){ return cfg.tokenIn; }` with `entry_arg_types = [Some(Struct([...,("chain",Struct([("rfqRouter",Scalar),...]))]))]`, then `return cfg.chain.rfqRouter;`. Before: fails at `to_ty` (can't express) / `EntryParamShape` (decode rejects nesting). After: compiles; assert the lowered prologue builds a nested `Expr::Tuple` for `chain` and that `cfg.chain.rfqRouter` is `Field(Field(local, 14), 2)`.
3. **Offset correctness** (guards the §4b stride fix): a struct with scalars _before and after_ the nested tuple — `Struct([("x",Scalar),("chain",Struct([("a",Scalar),("b",Scalar)])),("y",Scalar)])` — assert `x`→word 0, `chain.a`→word 1, `chain.b`→word 2, `y`→word 3 (a flat 1-word-per-field decode would put `y` at word 2). Ideally an execution vector (EVM v12) reading `y` and `chain.b` with distinct sentinel words.
4. **`require_length` uses leaf count**: assert the Tuple arm's guard demands `base + 21*32` for the `cfg` shape, not `15*32`.
5. **Nested-account still rejected**: `Struct([("chain",Struct([("acct",<Account>)]))])` → `AccountInEntryParam` (permanent), not `EntryParamShape`.
6. **Negative-control byte-identity**: an existing `ArrayOf(ScalarTuple(n))` param compiles to byte-identical bytecode (the flat path is untouched).

---

## 6. Is nested-`ArgShape` the _actual_ next full-recipe blocker?

**It is the next blocker, but it is not the last.** The recipe's `main` has **8 params** (recipe `:1215-1222`): `cfg, pools, netCache, routing, segs, qlv, rfqs, rfqSigs`. Feature census (destructuring ✅ done, `.catch` ✅ done; `0` arrow-const inline fns, `0` for-of, `0` switch, `29` plain `function` decls, `112` `.catch(`):

- `pools, netCache, routing, segs, qlv, rfqs` → `ArrayOf(ScalarTuple(n))` — **flat, already supported**. Verified positional-scalar indexing (`pools[i][6]`, `routing[i][0]`, `netCache[cur]`→scalar reads).
- `cfg` → **this design** (named + nested).
- **`rfqSigs` → `bytes[]` — a distinct, still-open decode blocker.** Confirmed: `const rsig: bytes = rfqSigs[rfr];` (recipe `:6673`; also `:1221`). Its `ArgShape` is `ArrayOf(Bytes)` → `to_ty` = `Ty::Array{element: Ty::Bytes}` → `element_words(Bytes) = None` → `require_decodable_entry_param` rejects with `Error::EntryParamShape` "not yet" (`assembly.rs:1999`, doc at `mod.rs:164-175`, `assembly.rs:1949-1952`). **This is _not_ fixed by the nesting work** — it needs the ABI-style **offset-table decode** for dynamically-sized array elements (each element's head word = a byte offset to its `bytes` data; one extra indirection per element), which the code comments explicitly describe as the unimplemented answer. **Effort L, independent PR.**

  Important: `rfqSigs` is decoded by the prologue **even when `HAS_RFQ` is off**. `HAS_RFQ` (recipe `:1002`) treeshakes the _reads_ (byte-neutral), but `main`'s arity is fixed and `entry_prologue` decodes _every_ parameter (`assembly.rs:1876-1877`), so `require_decodable_entry_param` runs on `rfqSigs` regardless. → **The full recipe cannot compile on RS until both `cfg` (nesting) AND `rfqSigs` (`bytes[]`) land.** The acceptance probe should expect `cfg` green to immediately surface an `EntryParamShape` on `rfqSigs`.

**Other things the full-recipe probe should watch (lower risk, not confirmed blockers here — out of scope for this read-only pass):**

- **v12 SDUP/arg-prologue window.** RS's EVM target _is_ the v12 Huff runtime. The recipe deliberately packed `cfg` into one arg "so main() stays at 6 params and the v12 arg-prologue SDUP window stays small" (recipe `:112-114`) — but the real signature is 8 params. Whether RS's arg-prologue has the same SDUP-depth ceiling the TS v12 backend hit is unverified; watch for a prologue/stack-depth error once decode is unblocked.
- **Helper→helper calls** (29 `function` decls). RS resolves inter-function calls in `assembly` (`assign_global_ids`/`module_tables`) with no declaration-order restriction, so this should be fine (unlike the TS v1 backend), but it's the next-largest untested surface.
- **Body size / treeshake with `defines`** (`HAS_RFQ`, `HAS_V2`, `HAS_KYBER`, `QUOTE_GAS`, …) — standard `optimize`+`defines` path (`options.rs:46-57`); large but not novel.

---

## Build sketch for the sonnet lane

1. **`options.rs`** — add `ArgShape::Struct(Vec<(String, ArgShape)>)`; add its `to_ty` arm (`Ty::Tuple` of recursively-lowered named fields); update the enum + `to_ty` doc-comments (`:73-111`).
2. **`assembly.rs::element_words`** (`:1953`) — recurse into `Ty::Tuple` (sum `element_words` of each field; `None` if any field is `None`). `Array`/`Bytes`/`Account`/`Void` unchanged.
3. **`assembly.rs::entry_collection_decode`** Tuple arm (`:2124`) — replace flat `inline_fields` with a recursive field builder (scalar → `read_word`; nested tuple → `Expr::Tuple` of its recursively-built fields; advance the running offset by `element_words(field)`); change the `require_length` bound to `element_words(ty)` total leaf words; route the array-element `element_value` (`:2201`) through the same builder.
4. **Do NOT touch** `resolve_field`, `static_member`, `object_literal`, `lib.rs` threading — the read/codegen side already handles named nested tuples.
5. **Tests** per §5 (compile + offset-correctness + leaf-count guard + nested-account reject + flat negative-control), plus at least one EVM v12 execution vector reading a post-nested-tuple scalar to lock the stride.
6. **Follow-up ticket (separate, L):** `bytes[]` / dynamically-sized array-element entry decode (offset-table) — required for `rfqSigs`, and the immediate next blocker after this lands.

**Constraints honored:** `to_ty` stays `pub(crate)`; no `Ty` on the public API (NS-1). The flat `ScalarTuple`/`ArrayOf(ScalarTuple)` path is byte-unchanged. All work is additive.
