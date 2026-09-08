Confirmed — `.length` on any `Ty::Array{..}` (line 462) lowers to `Expr::Length` regardless of element type, so both `routing.length` (outer) and `rt.length` (inner) work identically. I have everything needed. No cargo run, no edits made — pure read-only investigation.

---

# NS-10 Design: `Array<Array<Scalar>>` entry-parameter decode

## TL;DR verdict

**NS-10 is BOUNDED — smaller than NS-8, not larger.** It reuses NS-8's exact offset-table skeleton (`git show fc4cde882`), the _only_ new content being that each element's materialization is an inner `ArrayOfLength + Loop + SetIndex(scalar)` fill — which is byte-for-byte the _fixed-stride array arm that already exists in the same function_ (`assembly.rs:2422-2461`), reused one level in. The read side (`arr[i]` → inner descriptor → `row[k]` runtime/literal → `row.length` → `arr.length`) **already lowers correctly with zero changes**. No new IR node, no codegen change, no `targets.rs` change, no `ArgShape` variant, no `to_ty` arm. Effort: **M (small side of medium)**.

The only real work is one new match arm in `entry_collection_decode` and one three-line widening of `require_decodable_entry_param`'s `Array` arm, plus a conformance test.

---

## What the recipe actually needs (evidence)

Contrary to the task's "routing/pools/segs/qlv", the on-chain probe already pins the precise shapes (`sauce-compiler-rs/compiler/crates/sauce-core/tests/ecoswap_full.rs:104-138`), and only **`routing` genuinely needs `Array<Array<Scalar>>`**:

- `pools` → `ArrayOf(ScalarTuple(24))`, `netCache` → `(2)`, `segs` → `(7)`, `qlv` → `(12)` — all **fixed arity, literal inner index** (`ecoswap_full.rs:107-124`). Confirmed in the recipe: no runtime inner index on `dp`/`qd`/`sr` (grep found none); inner `.length` reads like `pd.length > 17` (`ecoswap.sauce.ts:2013`), `dp.length > 19` (`ecoswap.sauce.ts:5978`) fold to the fixed tuple arity at compile time. These stay `ScalarTuple` and are **already decodable today**.
- `routing` → **`ArrayOf(ArrayOf(Scalar))`** (`ecoswap_full.rs:111-118, 132-134`). Two properties force this, both impossible for a fixed `Tuple`:
  1. **Runtime inner index**: `const rt: Tuple = routing[r]; ... rt[1 + 5 * L]` (`ecoswap.sauce.ts:3662,3669`), `rt[3 + 5*L]` (`:3735`), `ert[rtLegLen]`/`ert[rtLegLen+1]` (`:3839-3841`), `rt[5 * L]`/`rt[5 + 5*L]` (`:7000,7003`). A `Ty::Tuple` index **must be a literal** — `computed_member` routes it to `tuple_index`, which raises `TupleIndexNotLiteral` for a non-literal (`expression.rs:251,279-299`).
  2. **Variable inner length + runtime inner `.length`**: a route's field count is `1 + 5*legCount` and `legCount` varies per route; `ert.length > rtLegLen + 3` (`ecoswap.sauce.ts:3838`) is a genuine runtime length check. A fixed `ScalarTuple(n)` can't express a per-row variable arity.

So NS-10's target shape is exactly `Ty::Array { element: Ty::Array { element: Ty::Scalar(Number) } }`, inner element a **plain scalar**, inner length **variable (caller-supplied per row)**.

---

## Q1 — ArgShape / to_ty: **nothing to add**

`ArgShape::ArrayOf(Box<ArgShape>)` (`options.rs:91`) is already recursive, and `to_ty` (`options.rs:114-117`) already recurses:

```rust
ArgShape::ArrayOf(element) => Ty::Array { element: Box::new(element.to_ty()), len: 0 }
```

`ArrayOf(Box::new(ArrayOf(Box::new(Scalar))))` therefore already builds `Ty::Array{ element: Ty::Array{ element: Ty::Scalar(Number), len:0 }, len:0 }` — no new variant, no new `to_ty` arm. The probe already constructs it this way (`ecoswap_full.rs:132-134`). The `Ty` NS-10 builds is precisely `Ty::Array{element: Ty::Array{element: Scalar}}`.

---

## Q2 — Entry decode (the only real work)

### 2a. Admission — `require_decodable_entry_param` (`assembly.rs:1994-2032`)

Today the `Array` arm (`assembly.rs:2010-2012`) admits fixed-stride elements plus NS-8's narrow `Bytes` escape hatch:

```rust
Ty::Array { element, .. } => {
    element_words(element).is_some() || matches!(**element, Ty::Bytes)
}
```

Widen with **one more narrow escape hatch** — an inner array whose _own_ element is fixed-stride:

```rust
Ty::Array { element, .. } => {
    element_words(element).is_some()
        || matches!(**element, Ty::Bytes)
        || matches!(&**element, Ty::Array { element: inner, .. } if element_words(inner).is_some())
}
```

This admits `Array<Array<Scalar>>` and `Array<Array<ScalarTuple>>` (inner fixed-stride) but **fails closed** for `Array<Array<Array<…>>>` (inner has no stride) and `Array<Array<Bytes>>` — same "narrow, named shape, not a blanket dynamic-element rule" discipline NS-8's comment already states (`assembly.rs:2005-2012`). `element_words` itself stays unchanged — `element_words(Array)` remains `None` (`assembly.rs:1977`), exactly as NS-8 kept it `None` for `Bytes`.

The existing test `an_array_of_arrays_is_still_not_yet_decodable` (`assembly.rs:3002-3018`, asserts `EntryParamShape`) **flips to the admission test** — it becomes NS-10's `array_of_arrays_entry_params_are_now_admitted`, the direct analogue of `bytes_array_entry_params_are_now_admitted` (`assembly.rs:2980-2999`). That's the first red→green.

### 2b. Decode branch — `entry_collection_decode` (`assembly.rs:2058-2462`)

Add a new arm **before** the fixed-stride fallthrough `Ty::Array { .. } => {}` (`assembly.rs:2349`), keyed the same way NS-8's arm is (`assembly.rs:2206`):

```rust
Ty::Array { element, .. }
    if matches!(&**element, Ty::Array { element: inner, .. } if element_words(inner).is_some()) => { ... }
```

**ABI layout** is byte-identical to NS-8's `bytes[]` (`uint256[][]` and `bytes[]` share the standard `T[]`-of-dynamic-element framing that `encodeAbiParameters` emits): `base` = `args_base + headword` (`load_base`, `assembly.rs:2086-2093`); at `base` the element `count`; `tableStart = base + 32` (`assembly.rs:2210-2214`); the offset table is `count` words of `off_i` **relative to tableStart**; each inner array's data at `tableStart + off_i` is `[len_i][word_0]…[word_{len_i-1}]`. The **only** structural difference from NS-8: the inner data is `[len][32-byte scalar words]` (materialized as a real heap array) instead of `[len][raw bytes]` (materialized as an `Expr::Slice`).

Reuse verbatim from the surrounding function: `read_word` (`:2071-2082`), `require_length` (`:2099-2111`), `load_base`, the offset-table cap (`:2227-2241`), the offset-table-present guard (`:2243-2251`), the outer `count = read_word(base)` (`:2219-2222`), and the outer `ArrayOfLength{ element: ElementTag::Array, len: count }` (tag from `element.tag()` → `ElementTag::Array`, `mod.rs:1100` — the outer holds array descriptors). Per outer iteration, replace NS-8's single-`Slice` `SetIndex` (`:2314-2336`) with:

```
off_i    = read_word(tableStart + cursor*32)              // relative to tableStart      (as NS-8 :2275)
dataPos  = tableStart + off_i                             // absolute (base incl. args_base)  (:2289)
require_length(dataPos + 32)                              // inner LEN word present
inner_len = read_word(dataPos)
require( inner_len * innerStride*32 <= MAX_COLLECTION_BYTES )   // inner cap (innerStride = element_words(inner) = 1)
require_length(dataPos + 32 + inner_len*innerStride*32)   // inner DATA present
innerLocal = ArrayOfLength{ element: inner.tag() (=Scalar), len: inner_len }
inner_cursor = 0
Loop {                                                    // NESTED loop — the fixed-stride arm's body, one level in
    if !(inner_cursor < inner_len) break
    innerLocal[inner_cursor] = read_word(dataPos + 32 + inner_cursor*innerStride*32)  // scalar; ScalarTuple → Expr::Tuple(tuple_fields(...))
    inner_cursor += 1
}
outer[cursor] = Expr::Local(innerLocal)                  // SetIndex{ element_is_dynamic: true, index_is_statically_in_bounds: false }
cursor += 1
```

Guard math note vs NS-8: NS-8's inner extent is `dataPos + 32 + len` (len in **bytes**, `:2305-2313`); NS-10's is `dataPos + 32 + inner_len*32` (len in **elements**). That single `*32` is the whole substantive arithmetic difference.

**Freshness**: `innerLocal` is one synthetic local re-`ArrayOfLength`-assigned each outer iteration, giving a fresh heap region per row (same discipline that lets the recipe's own `new Array(n)` inside loops work); `SetIndex outer[i] = Local(innerLocal)` stores the descriptor word, exactly as NS-8 stored a fresh `Slice` descriptor each iteration. `element_is_dynamic: true` (inner is `Ty::Array`, `is_dynamic()` = true, `mod.rs:1080-1082`) — and `SetIndex{element_is_dynamic:true}` already boxes any element kind (the NS-8 commit's own "no codegen/targets change" note). New synthetic locals: `off`, `data_pos`, `inner_len`, `inner_local`, `inner_cursor` (NS-8 already spends `off`/`data_pos`/`elem_len`, `:2207-2209`).

**Caps**: per-table + per-element, matching NS-8. Worst-case aggregate allocation (`count ≤ 512` × inner `≤ 512`) is the same count×MAX exposure NS-8's `bytes[]` already carries; keep parity (no aggregate cap), noting real routing is tiny (a handful of routes/legs).

---

## Q3 — Read side: **already correct, zero work**

Verified end to end against the current lowering:

- **`routing[r]` (runtime `r`)** → `computed_member` `Ty::Array` arm (`expression.rs:248-249`): emits `Expr::Index { result_is_dynamic: element.is_dynamic() }`. For inner `Ty::Array{Scalar}`, `element.is_dynamic()` = **true** (`mod.rs:1080-1082`), `result_ty` = the inner `Ty::Array{Scalar}` descriptor. Correct.
- **`rt[1 + 5*L]` (runtime `k`)** → re-enters `computed_member` on the inner `Ty::Array{Scalar}`, Array arm again, any scalar index accepted (`expression.rs:256-257`), result scalar. Correct. (A `Tuple` inner would instead hit `tuple_index` and reject the non-literal — `expression.rs:251` — which is exactly why the fixed-tuple shape can't serve `routing` and why NS-10 is required.)
- **`routing[i][0]` (literal inner)** → same Array arm, literal index also fine.
- **`rt.length` (inner) and `routing.length` (outer)** → `.length` dispatch, `Ty::Array{..}` arm (`expression.rs:462`) → `Expr::Length` regardless of element type. Correct at both levels.

These are the identical IR nodes the recipe's own `new Array(n)`/`arr[i]`/`.length` already emit and run on both engines, so codegen is exercised. **No read-path change.**

---

## Q4 — Effort + test plan + conformance vector

**Effort: M** (~120-180 new lines in `assembly.rs` — one decode arm reusing NS-8 helpers + a nested fill loop — plus a conformance test; NS-8 was 346 lines and NS-10 is strictly less new machinery).

**Red→green unit tests** (in `assembly.rs` `#[cfg(test)]`, mirroring NS-8's):

1. Repurpose `an_array_of_arrays_is_still_not_yet_decodable` (`:3002-3018`) → `array_of_arrays_entry_params_are_now_admitted`: `require_decodable_entry_param(Array{Array{Scalar}})` was `Err(EntryParamShape)`, now `Ok`. Assert `Array{Array{Bytes}}` and `Array{Array{Array{Scalar}}}` still `Err(EntryParamShape)` (escape hatch stays narrow).
2. `an_array_of_arrays_param_compiles_and_decodes_via_a_nested_offset_table` (analogue of `:3020-3069`): compile `function main(routing: Tuple): Uint256 { return routing[0n][0n]; }` with hint `ArrayOf(ArrayOf(Scalar))`; assert the prologue contains **two** `ArrayOfLength` (outer tag `Array`, inner tag `Scalar`) and a **nested** `Loop` whose inner `SetIndex` value is a scalar `read_word` (`BytesToScalar`), and the outer `SetIndex{element_is_dynamic:true}` value is `Expr::Local` (the inner descriptor).
3. Negative control (analogue of `:3071+`): `ArrayOf(ScalarTuple(n))` still takes the original single-loop fixed-stride arm (one `ArrayOfLength`, no nested loop) — disjoint match arms, structurally guaranteed.
4. Read-path unit test: `main(routing: Tuple){ return routing[i][1n+5n*L] + routing[i].length + routing.length; }` lowers without error (proves the runtime inner index + both `.length`s type-check).

**Real-engine conformance vector** (new `crates/sauce-cli/tests/array_of_arrays_conformance.rs`, wired into the Makefile `EVM_INTEGRATION_TESTS` list exactly as NS-8 did): `main(x: Array<Array<Scalar>>)` reading back, byte-exact against the pinned v12 Huff runtime via hnc+revm:

- **Unequal inner lengths** (e.g. rows of 1 / 5 / 3 scalars) — equal lengths cannot distinguish a correct offset-table decode from a fixed-stride misread (NS-8's own lesson, commit body). Assert `x[0][0]`, `x[2][2]`, `x[1][4]` by both constant and runtime index; assert `x[i].length` per row and `x.length`.
- Encode the input with a real ABI encoder for `uint256[][]` so the offset-table framing is exercised against off-the-shelf output.
- **Guard reverts** on the real engine: an offset-table `count` over the cap, a truncated payload (missing offset table), and a truncated _inner_ payload (inner `off_i`/`len_i` points past the input) all revert — the per-element inner guard is new to NS-10 and must be proven live.

---

## Q5 — Verdict + Sonnet build sketch

**BOUNDED**, decisively. NS-10 = NS-8's offset-table skeleton (proven on the real engine already) + the fixed-stride array arm's own fill body (already present in the same function) nested one level in, with a single `*32` arithmetic change and one new per-element inner guard. Read side needs nothing. No engine/codegen/targets/ArgShape/to_ty change. This is the last of the collection-decode shapes and clears NS-10 as a prerequisite for NS-9.

One honest scoping caveat, unrelated to NS-10's tractability: the full-recipe acceptance probe (`ecoswap_full.rs`, commit `3d454f996`) currently `#[ignore]`s on a **different** boundary — `eulerNeedsLive`/`eulerQuoteClosedForm` (`ecoswap.sauce.ts:564,578`) take a bare infer-wildcard `Tuple` as **non-entry helper** parameters, which `param_ty` only shape-resolves for `main`'s own params (`assembly.rs:974-992`; probe doc `ecoswap_full.rs:143-160`). That's a separate feature (call-site shape propagation to helpers), not NS-10. NS-10 unblocks the `routing` entry param; the helper-generic gap remains its own item.

**Sonnet build sketch (ordered, each commit green):**

1. `require_decodable_entry_param` `Array` arm: add the `matches!(&**element, Ty::Array{element: inner,..} if element_words(inner).is_some())` hatch (`assembly.rs:2010-2012`). Flip test #1 red→green. Commit.
2. `entry_collection_decode`: add the nested-offset-table arm before `Ty::Array{..} => {}` (`assembly.rs:2349`), cloning NS-8's arm (`:2206-2348`) and swapping the per-element `Slice` `SetIndex` for `ArrayOfLength(Scalar)` + nested fill `Loop` + `SetIndex(Local(innerLocal), dynamic)`; inner extent guard uses `inner_len*32`. Land unit tests #2/#3/#4. Commit.
3. Conformance vector `array_of_arrays_conformance.rs` (unequal lengths, runtime + const reads, `.length` both levels, three guard reverts); add to Makefile `EVM_INTEGRATION_TESTS`. Commit.
4. Flip the `ecoswap_full` probe's routing note if it becomes the surfacing error (it will still `#[ignore]` on the euler helper gap — leave that pin, update only NS-10-attributable text).

Watch-items for the builder: keep the escape hatch narrow (inner element must be `element_words(inner).is_some()` — do **not** admit `Array<Array<Bytes>>` or triple nesting); re-`ArrayOfLength` the inner local _inside_ the outer loop (fresh region per row); `off_i` is relative to `tableStart` (= `base+32`), `dataPos` is absolute; inner cap and inner data-present guard are per-element (each row's extent is runtime, unlike the fixed-stride arm's single up-front bound).
