I have everything needed — I confirmed the rejection site, the wire encoding, the caller encoder, the read-side lowering, and the existing dynamic-element machinery. Here is the design.

---

# NS-8 Design: array-of-dynamic (`bytes[]`) entry-parameter decode for compiler-rs

## Verdict up front

**Build it.** It is genuinely the FINAL full-recipe blocker, its scope is smaller than the fire#26 "L" guess once you see what the recipe actually needs (it never reads `.length`, never `abi.decode`s, never `ecrecover`s an element — it only indexes an element out and forwards it verbatim as a `bytes` ABI arg), and — decisively — the entire heap/descriptor machinery it depends on **already exists and is exercised** by the array-of-*tuple* decode. Revised effort: **M**, not L (with one real-engine-verification caveat that keeps a residual L-shaped tail; see Risks). If the lane runs out of budget, the honest fallback is "compiles except `rfqSigs: bytes[]` — documented remaining item," but that leaves the recipe one small, well-understood PR short of green, so it is not the recommended stopping point.

---

## 1. WHERE and WHY it is rejected today (confirmed from source)

The rejection is in `require_decodable_entry_param` (`compiler/crates/sauce-core/src/lower/assembly.rs:1990`), reached from the param loop at `assembly.rs:1712`.

- `rfqSigs`'s public shape is `ArgShape::ArrayOf(Box::new(ArgShape::Bytes))`. **No `ArgShape` change is needed** — `to_ty` (`options.rs:106-109`) already lowers it to `Ty::Array { element: Box::new(Ty::Bytes), len: 0 }`. (This is unlike `cfg`, which the sibling doc needs a new `ArgShape::Struct` variant for.)
- For `Ty::Array { element, .. }`, decodability is `element_words(element).is_some()` (`assembly.rs:1999`).
- `element_words(Ty::Bytes)` returns **`None`** (`assembly.rs:1973` — `Ty::Account | Ty::Array { .. } | Ty::Bytes | Ty::Void => None`).
- So `decodable = false`, `contains_account` is false, and it raises `Error::EntryParamShape { shape }` (`assembly.rs:2013`), whose message says **"not yet"** (`lower/mod.rs:164-175`).

The code even documents the intended fix at the rejection's doc comment (`assembly.rs:1948-1952`): a dynamically-sized element "is **not** fundamentally out of reach — the ABI-style answer is an offset table, itself fixed-stride 32, with one extra indirection per access — but it is not implemented yet." That is exactly NS-8.

Note the arity trap the sibling doc already flagged: `entry_prologue` decodes **every** parameter (`assembly.rs:1876-1877`) regardless of `HAS_RFQ` treeshaking the reads, so `require_decodable_entry_param` fires on `rfqSigs` even in the RFQ-off build. cfg-green will immediately surface this `EntryParamShape`.

---

## 2. Wire encoding of a `bytes[]` entry arg, and what the decode must produce

### The encode side is standard ABI (confirmed)

The args region is appended verbatim and is **off-the-shelf ABI** — `entry_arg_decode`'s doc says so (`assembly.rs:2288-2294`), and it is corroborated structurally: the existing single-`bytes` decode (`assembly.rs:2137-2172`) reads `count = word(base)` then `data = slice(base+32, base+32+count)`, which is exactly ABI `bytes` (`[len][data]`). So the whole args region is `abi.encode(cfg, pools, …, rfqSigs)`; the caller builds it with viem `encodeAbiParameters` (the recipe already imports it, `ecoswap/index.ts:18`), and `buildRfqArgs` hands `sigs: Hex[]` (`index.ts:1311,1327`) straight through as the `bytes[]` arg (`index.ts:2060`).

### The layout, and how it differs from the existing array decode

The current array arm assumes elements are **inline at a fixed stride** — `[count][elem0][elem1]…` (`assembly.rs:2179-2204`). That is ABI-correct only because a *static* element (scalar or static tuple) has no offset table. A `bytes[]` element is **dynamic**, so standard ABI inserts an offset table:

```
base  ─▶ [ count ]                             ← word(base)
         [ off_0 ][ off_1 ] … [ off_{n-1} ]    ← table, starts at tableStart = base+32
         [ len_0 ][ sig_0 padded to 32 ] …     ← each off_i is RELATIVE to tableStart
```

Per element `i`:
- `off_i   = word(tableStart + i*32)`  (byte offset, relative to `tableStart` — the ABI convention for a `T[]` inner tuple of dynamic elements)
- `dataPos = tableStart + off_i`
- `len_i   = word(dataPos)`
- the element value = `slice(input, dataPos+32, dataPos+32+len_i)` — a `bytes` descriptor over `input`.

### What the runtime value must be — and what it need NOT be

From the recipe, `rfqSigs[i]` is **only ever**: bound to a `bytes` local and forwarded verbatim as a `bytes` ABI argument. Exhaustive usage (grepped):
- `signature: rsig` (Hashflow `tradeRFQT`, `ecoswap.sauce.ts:6682`)
- `signatureBytes: bsig` (Bebop `swapSingle`, `:6736`)
- `dsig` positional (Dexalot `partialSwap`, `:6818`)
- `vsig` positional (Velora `partialFillOrder`, `:6878`)
- `contract.call(grTarget, 0, gcd)` — raw calldata blob (`:6849`)

**No `.length`, no `abi.decode`, no `ecrecover`, no element-content slicing, no sub-indexing.** The runtime value needed is precisely a **`bytes` descriptor** — exactly what the single-`bytes` param decode already produces via `Expr::Slice`, and exactly what re-encodes as a `bytes` ABI arg on the call side. This is why the effort is smaller than "L": the element value is one `Expr::Slice`, not a decoded structure.

### Read side already works

Indexing lowers correctly with zero changes: `Expr::Index` sets `result_is_dynamic = element.is_dynamic()` (`lower/expression.rs:248-249`), and `Ty::Bytes.is_dynamic()` is `true` (`mod.rs:1095-1097`). So `const rsig: bytes = rfqSigs[rfr]` becomes `Expr::Index { result_is_dynamic: true }` yielding a bytes descriptor — no read-path change needed.

---

## 3. The implementation — three functions in `lower/assembly.rs`

Reuse, don't reinvent. The array-of-*tuple* path already builds a real heap array of **dynamic descriptor** elements (`ArrayOfLength` + a runtime `Loop` + `SetIndex { element_is_dynamic: true }`, `assembly.rs:2246-2285`). A `bytes[]` is the same shape with (a) a different per-element value expression and (b) an offset-table indirection. All that changes is decodability admission and the element-value/guard construction.

### 3a. `element_words` — admit `bytes[]` (`assembly.rs:1953`)

`element_words` must stay `None` for `Bytes` (a dynamic element has **no fixed stride**, correct). So admission cannot ride `element_words`. Instead, generalize `require_decodable_entry_param`'s `Array` arm to accept a dynamic-but-decodable element:

```rust
// require_decodable_entry_param, Array arm (assembly.rs:1999)
Ty::Array { element, .. } =>
    element_words(element).is_some()          // fixed-stride element (today)
    || matches!(**element, Ty::Bytes),        // NS-8: dynamically-sized element
```

Keep `contains_account` handling intact (a nested `Account` stays permanently rejected via the existing branch). Scope deliberately narrow: only `Array{element: Bytes}`, not arbitrary `Array{element: Array{…}}` or `Array{element: dynamic-tuple}` — the recipe needs only `bytes[]`, and a blanket "any dynamic element" opens an offset-table-of-offset-tables recursion this PR should not take on.

### 3b. `entry_collection_decode` — a `bytes[]` branch (`assembly.rs:2124`)

Split the `Ty::Array` handling on whether the element is fixed-stride (today's loop, unchanged) or `Bytes` (new offset-table loop). The new loop is the existing loop skeleton with three substitutions:

**Count + cap + table-presence guard (before the loop):**
```
count     = read_word(base)                              // reuse read_word / load_base
require(count*32 <= MAX_COLLECTION_BYTES)                // cap the offset table (≈512 elems); MAX_COLLECTION_BYTES = 16KB, assembly.rs:82
require(input.length >= base + 32 + count*32)            // the whole offset table is present
array     = ArrayOfLength { element: ElementTag::Bytes, len: count }   // Ty::Bytes.tag() = ElementTag::Bytes (mod.rs:1114)
cursor    = 0
tableStart = base + 32
```

**Per-element body (inside the existing `Stmt::Loop`, before `SetIndex`):**
```
off_i   = read_word(tableStart + cursor*32)
dataPos = tableStart + off_i
len_i   = read_word(dataPos)
require(input.length >= dataPos + 32 + len_i)            // this element's data is present (see Risks: clamping)
elem    = Expr::Slice { object: input, start: dataPos+32, end: dataPos+32+len_i }
SetIndex { array, index: cursor, value: elem, element_is_dynamic: true, index_is_statically_in_bounds: false }
cursor  = cursor + 1
```

`read_word`, `load_base`, `require_length`, `past_base`, and the `Loop`/`Break`/cursor-increment structure are all already local closures/patterns in the function (`assembly.rs:2058-2118, 2257-2285`) — the new branch reuses them. The only genuinely new IR is the compound `Expr::Slice` whose bounds reference `Local(cursor)` through the offset table; it is evaluated fresh each iteration because the loop body is real runtime bytecode.

**Key difference from the fixed-stride loop:** the extent guard is **per-element inside the loop**, not one up-front `count*stride` guard — because each element's extent depends on its own runtime `off_i`/`len_i`. (See Risks for whether it can be dropped in favor of SLICE-clamping, as the fixed-stride bytes arm already reasons at `assembly.rs:2140-2141`.)

### 3c. IR produced — no new codegen

Every op the branch emits already has codegen: `ArrayOfLength` (0x92-family), `SetIndex` with `element_is_dynamic: true` (the boxing path, `codegen.rs:1463-1472`), `Slice` (`SLICE 0x95`, `targets.rs:489`, both EVM and SVM backends implement `slice_pointer_mask`, `:987`/`:1228`), `BytesToScalar`, and the `Loop`/`If`/`Break` control flow. The bytes-descriptor element is tagged `ElementTag::Bytes` instead of `ElementTag::Tuple`, but flows through the identical dynamic-element store/read path. **No codegen or targets.rs change.**

---

## 4. Effort + red→green test plan

**Effort: M.** Admission is a 2-line predicate; the decode branch is ~40 lines of IR reusing existing closures; no codegen/targets/ArgShape change. The L-shaped residual is *verification*, not code (Risks §5b).

**Red→green tests** (in `assembly.rs` `#[cfg(test)]`, beside `an_entry_parameter_shape_the_decode_cannot_read_says_so` at `:2520`, and as CLI conformance/execution vectors):

1. **Admission flip (unit):** `require_decodable_entry_param(&Ty::Array{element: Box::new(Ty::Bytes), len:0}, …)` — RED today returns `Err(EntryParamShape)`; GREEN returns `Ok`. Keep `an_entry_parameter_shape_the_decode_cannot_read_says_so` passing for a still-rejected shape (e.g. `Array{element: Array{…}}`) so the "not yet" message still has a live subject.
2. **Compile:** `main(rfqSigs: Tuple){ return rfqSigs[0]; }` with `entry_arg_types = [Some(ArgShape::ArrayOf(Box::new(ArgShape::Bytes)))]` — RED fails at `EntryParamShape`; GREEN compiles, and the lowered prologue contains an `ArrayOfLength{element: ElementTag::Bytes}` + a `Loop` whose body has a `SetIndex{element_is_dynamic:true, value: Expr::Slice{…}}`.
3. **Offset-table correctness (execution, EVM v12 — the load-bearing one):** hand-encode a real ABI `bytes[]` of **three unequal-length** elements (e.g. 1, 65, 100 bytes with distinct sentinel content), append as the args region, and assert `main(x){ return x[1]; }` returns byte-exact element 1. Unequal lengths are what proves the offset-table indirection (a fixed-stride misread would return the wrong element or truncate). This mirrors the existing playground/execution-vector harness (`sauce-cli/tests`, `v12_playground_conformance.rs:155` appends args verbatim).
4. **Runtime index:** `main(x, i){ return x[i]; }` with a runtime `i` — proves the decoded heap array supports `INDEX` with a dynamic element (matches the recipe's `rfqSigs[rfr]` where `rfr` is runtime).
5. **Forward as a `bytes` ABI arg (execution):** the recipe's real usage — index an element and pass it to a mock contract's `bytes` param; assert the callee received the exact bytes. This is the descriptor-round-trip proof (Risks §5b).
6. **Cap + short-payload guards:** a `count` past the cap reverts on the cap; a payload that ends inside an element's data reverts on the per-element guard (or, if clamping is chosen, decodes to a defined truncated value — pick one and pin it).
7. **Negative-control byte-identity:** an existing `ArrayOf(ScalarTuple(n))` param compiles byte-identically — the fixed-stride path is untouched.
8. **Both targets compile:** the same `bytes[]` `main` compiles for EVM and SVM (execution is EVM-only, since the RFQ legs are EVM; SVM just must not regress to a compile error).

---

## 5. Risks

**5a. Offset semantics (medium, code-level).** ABI offsets inside a `bytes[]` are relative to the start of the inner tuple = **after** the count word (`tableStart = base+32`), not relative to `base`. Getting the base wrong is the most likely bug; test #3's unequal-length elements catch it. This is settled by spec and by matching what the single-`bytes` arm already does, so it is a "get the arithmetic right" risk, not an open design question.

**5b. Descriptor round-trip through a heap array element (HIGH — the residual L; needs real-engine verification).** This is the one place the V1-audit descriptor-drop family (CLAUDE.md, extensively) is relevant. The element value is an `Expr::Slice` — a *sub-descriptor / view* over `input` (masked via `slice_pointer_mask`), a different runtime shape from the *heap-allocated* Tuple descriptor the array-of-tuples path stores. Two things must hold, on **each** engine (v1, v12, SVM):
   1. `SetIndex{element_is_dynamic:true}` of a **Slice sub-descriptor** into a heap array slot stores something that `Index` reads back as a usable bytes value (not a dangling view or a mis-masked pointer);
   2. that read-back value re-encodes correctly as a `bytes` ABI call argument.

   The single-`bytes` param decode proves a Slice descriptor round-trips through a *local* and re-encodes as a `bytes` arg. What is **unproven** is the same Slice descriptor surviving a `SET_INDEX`/`INDEX` array round-trip. RS's dynamism is type-driven (`element.is_dynamic()`), not heuristically inferred, so it does not have the TS/V1 *inferKind* miscompile hazard — but whether the engine's element-boxing correctly handles a Slice-view element (vs. a heap-value element) is an **execution question, not a reasoning one**. Test #5 is the gate. If a raw Slice view does not round-trip, the fix is to **materialize** each element into a heap bytes value before `SetIndex` (copy the slice into fresh heap) — a known, contained escalation that keeps the decode sound and is the reason a residual L-tail exists. **Recommend the sonnet lane run test #5 on a real engine early, before polishing.**

**5c. No fixed-stride cap; use a count cap (low).** `MAX_COLLECTION_BYTES` bounds `count*stride` for fixed-stride arrays; a `bytes[]` has no stride. Cap the **offset table** (`count*32 <= MAX_COLLECTION_BYTES` → ≈512 elements) and let each element's data be bounded by `input.length` via the per-element guard. Real `rfqSigs` length is tiny (one per in-play RFQ venue, << 10), so the cap is purely a hostile-input bound.

**5d. Per-element guard vs. SLICE-clamp (low).** The fixed-stride bytes arm deliberately omits a length-word guard because SLICE clamps to defined zeros (`assembly.rs:2140-2141`, `2208-2211`). The same reasoning permits dropping the per-element guard for a smaller decode — a hostile short payload then yields a truncated/zeroed sig, and the downstream RFQ call reverts inside its `.catch` (every RFQ leg is `.catch`-wrapped, `ecoswap.sauce.ts:6849` etc.), so there is no unsafety. Keeping the guard is more defensive and matches the caller-supplied-extent pattern the array arm already uses; I'd keep it, but it is a judgment call the lane can drop to minimize scope. Either way, pin the chosen behavior in test #6.

---

## Build sketch for the sonnet lane

1. **`assembly.rs::require_decodable_entry_param`** (`:1999`) — Array arm accepts `element_words(element).is_some() || matches!(**element, Ty::Bytes)`. Leave `element_words` itself unchanged (`Bytes` stays `None`). Keep `contains_account`/`AccountInEntryParam` intact.
2. **`assembly.rs::entry_collection_decode`** (`:2124`) — in the `Ty::Array` handling, branch on `Ty::Bytes` element: emit the offset-table loop from §3b (count + cap + table-present guard; then a `Loop` reading `off_i`→`dataPos`→`len_i`, optional per-element guard, `SetIndex` of `Expr::Slice`). Reuse `read_word`, `load_base`, `require_length`, `past_base`, and the existing `Loop`/cursor structure. The fixed-stride path (`:2179-2285`) is untouched.
3. **No changes to** `options.rs` (`ArrayOf(Bytes)` already lowers), `element_words`, `lower/expression.rs` Index, codegen, or targets.rs.
4. **Tests** per §4 — with test #3 (unequal-length offset-table execution) and test #5 (forward-as-`bytes`-arg round-trip) as the two must-pass gates; run #5 on a real engine early to settle Risk 5b before the descriptor-materialization escalation is or isn't needed.
5. **Backlog:** NS-8 (`compiler-parity-BACKLOG.md:76`) — revise the "L" to "M (execution-verified); residual L only if Slice-view elements need heap materialization." After NS-8 + cfg (`ArgShape::Struct`) land, the full `ecoswap.sauce.ts` should be 0 entry-decode blockers away — flip the acceptance probe to a full-recipe compile and watch the secondary surfaces the sibling doc listed (v12 arg-prologue SDUP depth at 8 params; 29 helper→helper calls).

**Composition with the sibling ArgShape design:** orthogonal and non-conflicting. That doc touches `element_words`'s `Tuple` recursion and the Tuple/`inline_fields` decode arm for `cfg`; NS-8 touches the `Array` admission predicate and adds a `Bytes`-element `Array` decode arm. Only `require_decodable_entry_param` is edited by both (different match arms — Tuple vs. Array), and `entry_collection_decode` (different branches — Tuple vs. Array/Bytes). They can land in either order; if the ArgShape PR lands first, NS-8 rebases trivially.