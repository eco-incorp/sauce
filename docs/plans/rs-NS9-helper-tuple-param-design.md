I have everything needed. Full read-only investigation complete — no cargo, no edits.

---

# NS-9 Design + Verdict — non-entry `Tuple` helper params (`eulerNeedsLive`/`eulerQuoteClosedForm`)

## What I read

- **RS pipeline** (`/Users/er/Documents/Projects/sauce-compiler-rs/compiler/crates/sauce-core/src/lower/`):
  `program()` (`assembly.rs:174`) → `assign_global_ids` (`:916`) → `module_tables` (`:1015`) → `param_ty` (`:978`) / `entry_param_hint` (`:955`) / `EntryParamHint` (`:945`); body lowering `lower_function` (`:1670`); the user-call site `contract.rs:964-1012`; `is_infer_tuple` (`mod.rs:1998`), `binding_ty` (`statement.rs:353`), `Ty::Tuple(Vec<(String,Ty)>)` (`mod.rs:1058`), `tuple_index` (`expression.rs:306`), `ArgShape::to_ty` (`options.rs:104`).
- **The recipe fixture** (`compiler/crates/sauce-core/testdata/ecoswap-full/ecoswap.sauce.ts`) and the `#[ignore]`d probe (`tests/ecoswap_full.rs:184-200`).

## The phase inversion, precisely (unchanged by NS-10)

`assign_global_ids`→`module_tables` resolves **every** function's `param_types`/`return_ty` into the shared `Rc<FunctionTable>` **before any body is lowered** (`assembly.rs:216-231` builds the tables; `:245-270` lowers bodies afterward, in global-id/declaration order). The only wildcard escape is `param_ty` (`assembly.rs:987-994`): `is_infer_tuple(ty) && EntryParamHint::Entry` — i.e. `main` + `entry_arg_types` only. A non-entry `Tuple` gets `EntryParamHint::NotEntry` (`:962`) → falls through to `annotation_ty` → **`Error::UnknownType`**. This fires during signature resolution, before any body — so a call site's arg `Ty`, which only exists during body lowering (`contract.rs:990` `self.expr(expression)`), is not yet computable. That inversion is structural and **NS-10 did not touch it**.

## (1) What `Ty` does the call-site arg actually have now?

**A concrete, fixed-arity `Ty::Tuple`, and it resolves the "no shape to propagate" objection.**

`qd` is a `main`-local `const qd: Tuple = qlv[v];` (`ecoswap.sauce.ts:2195`, and `:5067` governing the second call). Per the NS-10 probe pins (`ecoswap_full.rs:126-138`), **`qlv` = `ArrayOf(ScalarTuple(12))`** — deliberately *not* the `ArrayOf(ArrayOf(Scalar))` shape NS-10 built for `routing`. Indexing `qlv[v]` (Array-arm of `computed_member`, `expression.rs:248`) yields the element `Ty` = **`Ty::Tuple([("",Number)×12])`** (`options.rs:109-113`). `binding_ty` takes that verbatim through the infer-wildcard (`statement.rs:366-367`). So at both euler call sites the arg `Ty` is a fully-resolved `Ty::Tuple(12)`.

- It is a `Ty::Tuple`, **not** `Ty::Array{Scalar}` — because the euler helpers only ever read `qd` at **literal** indices `qd[2] qd[6] qd[7] qd[8] qd[9]` (`ecoswap.sauce.ts:567-586`; max index 9), never a runtime index or `.length`. A `Ty::Tuple` serves all of them via `tuple_index` (`expression.rs:306`). This is exactly why `qlv` stays `ScalarTuple` while only `routing` needed NS-10's `Array<Array<Scalar>>`.
- **Monomorphic for the euler helpers**: the call-governing `qd` is `qlv[v]`/`qlv[u]` at both sites (`:2195`→3130, `:5067`→5214) → identical `Ty::Tuple(12)` both times. Field names are empty and positional (`options.rs:101-113`), so `check_assignable` of arg-vs-param is trivially satisfied when the param `Ty` *is* the harvested arg `Ty`.

**So yes — NS-10 removed the fire#31 "no shape to propagate" blocker.** The shape now exists, is concrete, and is monomorphic. What remains is purely *when* it becomes available, not *whether* it exists.

## (2) Can a non-entry `Tuple` param be typed by propagation? / Is the "open tuple" shortcut viable?

- **"Treat it like the local infer-wildcard / open tuple" — NO.** `Ty::Tuple` carries its fields (`mod.rs:1058`) and `tuple_index` bounds-checks + type-resolves each read against them (`expression.rs:306-323`). An arity-less/field-less tuple cannot lower `qd[9]`. The param genuinely needs the concrete 12-field `Ty::Tuple`. There is no "infer from first use inside the body" path — the body's uses are *reads* that need the shape, not *writes* that define it.
- **Propagation is therefore required**, and it must reuse the **real** typer's scope/binding resolution — because `qd` is a **heavily reused name bound to different-arity tuples across scopes**: `qd = qlv[0|v|u]` → `Tuple(12)` (`:1563,:2195,:5067,:6126,:7286`) but also **`qd = pools[q]` → `Tuple(24)`** (`:3606`). A hand-rolled AST arg-tracer that picks the wrong in-scope `qd` binding would inject `Tuple(24)` into an euler param and **still lower cleanly and silently wrong** (every read index ≤9 < 12 < 24, all scalar — no arity check ever fires). Only correct block-scope resolution disambiguates. Duplicating scope resolution is both a silent-miscompile hazard here and exactly what the codebase's design discipline forbids ("so the two agree by construction rather than by two copy-pasted expressions", `assembly.rs:969-971`).

## (3) The ordering change — bounded or large?

**Large.** Any *sound* propagation harvests the arg `Ty` from the real lowering of the **caller** (main), but the callees (`eulerNeedsLive` `:564`, `eulerQuoteClosedForm` `:578`) are declared **before** `main` (`:1215`, the last function) and bodies lower in declaration order (`assembly.rs:245-267`). So the generic-helper bodies lower *before* the harvest exists. Closing that requires one of:

- **(3a) Two-phase lowering (discovery pass).** Pass-1: `module_tables` records a non-entry `Tuple` param as a *pending* placeholder instead of erroring; lower every **non-generic** function (main + scalar helpers) in a discard pass, capturing `(callee_id, pos) → arg Ty` at each user-call site (`contract.rs:988`); unify per slot (must agree — monomorphic; disagreement/unobserved → error); rebuild the signature tables with the unified `Ty`; Pass-2 lower everything for real. Cost: main is ~6700 lines and gets lowered twice; the discard pass must be provably side-effect-free (no global-slot/account-slot leakage into `GlobalSlots`/manifest).
- **(3b) Caller-first reorder + mutable signatures + deferred arg-check.** Lower `main` first, defer the arg-check for a pending param and record the `Ty`, patch the (currently immutable `Rc`) `FunctionTable`, then lower the helpers; re-collect functions in id order to preserve the "vector index == FunctionId" invariant (`assembly.rs:235-236`). Reintroduces a caller-before-callee constraint that is only satisfiable because the sole callers are `main`; a generic-helper-called-from-generic-helper would recreate the cycle.

Both are **L**, both restructure the **single, all-target, currently-green** lowering pipeline (full RS workspace 0-failed per fire#35/36), and both carry real regression risk for what is presently a **single fixture consumer**. This is precisely the "signature-resolution phase inversion (L)" fire#31 named — NS-10 shrank the *type* problem to zero but left the *ordering* problem at full size.

## (4) Effort, test, verdict

**Effort: L** (sound paths only; the tempting M path — a fail-closed AST arg-tracer — is unsound here due to the reused-`qd`/mixed-arity scoping hazard above, so it does not count as a real option).

**Red→green anchor:** `tests/ecoswap_full.rs:191` `full_ecoswap_sauce_ts_compiles_on_the_evm` (`#[ignore]`, currently `.expect_err(...)` on the euler `Tuple`-param gap). Green = drop `#[ignore]`, flip to `expect(...)` a successful compile with `ecoswap_full_arg_types()`. Plus a focused unit: a two-function fixture `function h(t: Tuple): Uint256 { return t[9n]; } function main(qlv: Tuple): Uint256 { const r: Tuple = qlv[0n]; return h(r); }` with hint `qlv = ArrayOf(ScalarTuple(12))` — asserts `h`'s param resolves to `Ty::Tuple(12)` and `t[9]` lowers; a negative control asserting an **unobserved** non-entry `Tuple` param still errors, and a **mixed-arity disagreement** across two call sites errors (locks the monomorphic invariant).

### VERDICT: **DEFER-ARCHITECTURAL** (qualified — reduced, not cleared, by NS-10)

NS-10 genuinely advanced this: it resolved Q1 — the call-site arg is now a concrete, monomorphic `Ty::Tuple(12)` (`options.rs:109`, via the `qlv = ArrayOf(ScalarTuple(12))` pin), retiring the fire#31 "no shape to propagate" objection. But the **sole remaining blocker is the phase inversion, and it is untouched**: every *sound* implementation reuses the real typer's scope resolution (mandatory, because `qd` aliases both `Tuple(12)` and `Tuple(24)` across scopes — `:2195` vs `:3606` — and a wrong pick miscompiles silently), which forces harvesting the arg `Ty` from the caller's real lowering, which forces a two-pass-discovery or caller-first-reorder restructure of the central all-target pipeline — **L, and regression-risky against a fully-green workspace, for one fixture**. Per the fire#37 discipline ("if a design shows genuinely untenable architectural risk, esp. NS-9's signature-resolution phase inversion, STOP with it documented"), this crosses the STOP line.

**Recommendation:** keep `full_ecoswap_sauce_ts_compiles_on_the_evm` `#[ignore]`d; update its doc to record that NS-10 cleared the type side and the residual is the L ordering restructure (with the 3a/3b sketch above as the ready plan) so a future *hard product requirement* can execute it directly. Do **not** build it now; do **not** attempt the fail-closed AST-tracer shortcut — it is silently unsound on this recipe's reused-`qd` scoping.

### If it is later mandated — sonnet build sketch (path 3a, the lower-risk of the two)

1. **`module_tables`/`param_ty`** (`assembly.rs:978-996,1044-1055`): for a non-entry `is_infer_tuple` param, emit a pending marker instead of `UnknownType`. Cleanest: a side map `pending: HashMap<(FunctionId, usize), Span>` returned alongside the tables (avoid a new `Ty` variant leaking into codegen/check_assignable). Non-generic signatures resolve exactly as today.
2. **Discovery pass** in `program()` (new, before `:245`): lower every function whose id is **not** a pending-param owner, with a `Lowerer` flag `discovery: true` that (a) suppresses `GlobalSlots`/account-slot commits and (b) at the user-call site (`contract.rs:995`) — when `param_types[index]` is the pending marker — records `(callee, index) → ty` instead of `check_assignable`. Skip lowering pending-owner bodies (their reads can't resolve yet); this is sound iff no generic helper is called only from another generic helper (true here — euler helpers call only `eulerF`, scalar-only, `:586`; guard it: an unobserved pending param after discovery → `Error::UntypedNonEntryTupleParam`).
3. **Unify** per `(callee,index)`: all recorded `Ty` must be equal (monomorphic); else error. Rebuild `own_tables`/`exported_tables` substituting the unified `Ty` into `param_types`.
4. **Real pass** unchanged (`:245-270`) now that pending params are concrete; collect into id order.
5. Add a new `Error::UntypedNonEntryTupleParam` (mirror `UntypedEntryTupleParam`, `mod.rs:161-172`) for the unobserved/disagreement cases; wire the tests in (4).
6. Watch-items: discovery lowering **must** be side-effect-free (assert `GlobalSlots` unchanged); preserve the `index==FunctionId` invariant (`:235-236`); reject (don't guess) on any pending param a discovery pass never observed or observed with conflicting arity; `make ci` (fmt + clippy `-D warnings` + test + cargo-sort), noting `program`/`lower_function` are already at the `too_many_arguments` clippy ceiling (backlog fire#39) — thread the new state via a struct, not a 9th/10th arg.