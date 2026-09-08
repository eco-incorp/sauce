I now have a complete, precise picture across all three codebases. Here is the design.

---

# `.catch()` on RS compiler-rs — design & scoping pass

**Scope note up front:** this is beyond the designated (unrolled) north-star, it is SVM-divergent by construction, and it needs the CATCH opcode wired end-to-end. The good news, established below: the codegen "crux" is **bounded (M)** — RS's existing forward-emit-plus-patch model already does the one thing I feared was missing, so **no novel inline-sub-program primitive is required**.

---

## 1. Handler shapes — the real usage is trivially narrow

I tallied all **111** `.catch()` sites in `ecoswap/ecoswap.sauce.ts`. Every single one is a **zero-parameter arrow with a block body** and is used as a **discarded statement** (`<call>.catch(() => {...});`), never as a value, never destructured. Two shapes only:

| Shape                                                                                          | Count  | Example                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `.catch(() => { <local> = 0; })` — one assignment of literal `0` to an enclosing local OK-flag | **99** | `ICurveStableSwap.at(qPool).get_dy(qi, qj, xNext).catch(() => { ok = 0; });` (line 3006) |
| `.catch(() => { })` — empty, discard the failure                                               | **12** | line 5999 `).catch(() => { });`                                                          |

Verified negatives (grep, all empty):

- **No handler reads the caught error** — zero `.catch((e) => …)` sites.
- **No multi-statement handler** — zero handlers with two `;`.
- **No `revert()` in a handler**, no calls, no control flow.

The captured local is a **function-local** `let`, declared just above the catch (e.g. `let ok: Uint256 = 1;` at line 3002), and the idiom is **probe-then-decode**: the wrapped call's result is _discarded_; the only observable effect is whether the handler ran (setting `ok = 0`), which the very next line branches on — `if (ok === 1) { q = ICurveStableSwap.at(qPool).get_dy(...); }`. Two calls, by design, because (per TS `statement.ts:92`) a catch handler _cannot_ capture the call's outputs.

**Design target (narrowest covering shape):** a zero-parameter arrow, block body, containing **zero or one stack-neutral assignment** to an already-declared enclosing scalar local, used as a **discarded statement**. This is a strict subset of TS's `resolveCatchChain` (which additionally supports a param and multi-statement bodies) — we implement only what the recipe uses, and reject the rest with a clear message.

---

## 2. Frontend carve-out (`frontend.rs`)

**How it's rejected today:** `<call>.catch(<arrow>)` parses as a `CallExpression` whose callee is `<inner call>.catch` (a `StaticMemberExpression` whose `.object` is a `CallExpression`). The callee shape _already passes_ — `is_bindable_callee` (frontend.rs:747) recurses through `.object` being a `CallExpression` and bottoms out at the `Identifier` root, so `check_call` (frontend.rs:759) does not reject the callee. The rejection is purely at the **argument**: `check_argument` (frontend.rs:835) → `check_expression` (frontend.rs:580) → the arrow is `Expression::ArrowFunctionExpression`, not in the allowlist → `_ => reject(… "this expression")` (frontend.rs:603).

**The carve-out** (does _not_ open arrows generally — it is gated on the exact `.catch(...)` position): in `check_call`, detect when `call.callee` is a `StaticMemberExpression` with `.property.name == "catch"` and `.object` is a `CallExpression`. In that one case, validate the single argument as a **catch handler** rather than routing it through `check_expression`:

- exactly one argument, an `ArrowFunctionExpression` (or `FunctionExpression`);
- **zero params** (reject a param with a specific message — the recipe never reads the error; supporting the param is a later, separable extension, exactly as TS gates it at `expression.ts:487`);
- a `BlockStatement` body (concise-expression body rejected);
- each body statement validated through the existing statement allowlist (`check_statement`), so a handler that tries a loop/call/nested-catch is rejected with the normal message at its own span.

Everything else about the chain (the inner call's own args, the `.at(addr).method()` shape) is already validated by `check_call`'s existing `inner_chain` recursion (frontend.rs:777).

**Closure capture:** the handler body must resolve `ok` to the **same binding** the enclosing scope sees — a real lexical capture, exactly as TS compiles the handler `processBlock(handlerBody, ctx)` against the _same_ `ctx` (`expression.ts:560`). In RS this falls out for free: lowering the handler block in the enclosing scope's resolver context resolves `ok` to the enclosing `LocalId`. No new scope machinery — the handler is lowered as if its statements were siblings of the call, because on the EVM the CATCH handler runs **in the same frame**.

---

## 3. IR node (`ir.rs`)

Because every site is a discarded statement, the minimal node is a **statement**, not an expression:

```rust
/// `<call>.catch(() => { <handler> })` — run `call`; on revert, execute `handler`
/// in the same frame. EVM-only (Feature::TryCatch). The call's result is discarded
/// (the source only ever uses this in statement position). `handler` shares the
/// enclosing function's LocalId space — it may assign an enclosing local.
TryCall { call: Expr, handler: Vec<Stmt> },
```

- `call` is the ordinary lowered `Expr::EvmCall { kind, address, value, calldata }` (ir.rs:573) that RS _already_ produces for `Contract.at(addr).method(args)` — confirmed live: `lower/contract.rs` lowers the ABI inline chain via `contract_call` → `Expr::EvmCall`, and `codegen.rs:1743` emits it. So the wrapped call needs zero new work; only the CATCH wrapper is new.
- `handler: Vec<Stmt>` carries the (lowered) handler statements. The enclosing-scope binding is carried implicitly: an `ok = 0` handler lowers to `Stmt::Assign { local: <enclosing ok's LocalId>, value: Const(0) }` — the same `LocalId` the surrounding body uses.

Restrict to statement position: a `.catch()` in value position is a lower-time error (matches the fact that no site needs it, and mirrors TS's `dropIfUnused` discard). Handler statements are constrained (in lowering) to the stack-neutral subset from §1.

---

## 4. Codegen — the crux, and why it is bounded (S/M), not L

**The fear:** RS functions are separate table entries reached by `Call`/`Jump` to absolute offsets; `EVAL` takes a runtime bytes descriptor; there is no "compiled sub-program blob" concept. The EVM `CATCH` (0xB7) needs an **inline** handler blob: `<call> CATCH <len:1> <handler-bytecode>`, where on success the engine skips `len` bytes and on failure it executes them inline.

**The finding: RS already has exactly the primitive this needs — it just isn't spelled "sub-program."** RS `if`/`else` is _not_ a nested-blob mechanism; it is **jump-based, emitted inline into the single `self.bytecode` buffer** with fixed-width placeholders patched after the fact (codegen.rs:56-60 doc; `if_statement` at codegen.rs:1129; `reserve_target`/`patch_target_to` at codegen.rs:1226/1244; `pending_calls`/`function_starts` at codegen.rs:509-515). Crucially, **an `if` arm's statements are emitted at their true, final absolute offsets in the main buffer** — so any jump/call/arithmetic-guard placeholder _inside_ an arm patches to a correct absolute target like anywhere else.

A CATCH handler is the same situation. Emit it **inline into `self.bytecode` at its true final position**. Then:

```
self.expression(call)?;              // emit the EvmCall bytes (result on stack)
// (drop discipline for the discarded result — see risk below)
self.push_opcode(Opcode::Catch);     // 0xB7  (new Opcode variant)
let len_at = self.bytecode.len();
self.bytecode.push(0x00);            // 1-byte length placeholder
let start = self.bytecode.len();
let entry = self.stack.clone();      // snapshot, exactly like if_statement (codegen.rs:1150)
for s in handler { self.statement(s)?; }
self.stack = entry;                  // handler must be stack-neutral (assert / DivergentBranches)
let len = self.bytecode.len() - start;
if len > 0xFF { return Err(HandlerTooLarge); }   // matches TS 255 cap (saucer.ts:535)
self.bytecode[len_at] = len as u8;   // in-place 1-byte patch
```

This reuses the **exact** reserve-placeholder-then-patch pattern RS already uses for jump targets — the only differences are (a) the length is 1 byte instead of a `BYTE_2` target, and (b) it is patched immediately after emission (the length is known the instant the handler is done, because jump targets inside it are fixed-width and never change size — see `reserve_target` always emitting 3 bytes, codegen.rs:1227). **No scratch buffer, no sub-Codegen, no new relocation model.** An internal handler jump/call patches to its correct absolute offset because the handler sits at its final position; on the success path the engine skips `len` bytes and simply never executes them.

New codegen surface, all small:

1. `Opcode::Catch => Some(0xB7)` in the opcode byte map (targets.rs, alongside `Jump => 0xB0` at line 870).
2. Wire `Feature::TryCatch` (already declared, targets.rs:111) so EVM reports `Available` and lowering emits it; `require_available(target, Feature::TryCatch)` gates it EVM-only.
3. `Stmt::TryCall` arm in `emit_statement` (codegen.rs:1021) doing the above.

**The one genuine risk — CATCH stack discipline — and where it must be verified:** the wrapped call pushes its raw returndata descriptor; the statement discards it; the handler must leave the stack in the _same_ shape whether it runs (failure) or is skipped (success). This is a real engine-contract detail I could not fully verify read-only (the TS side notes `dropIfUnused` is a **no-op on v1** — `expression.ts:621` — implying the v1 engine's CATCH itself manages the result). The bounded, safe scope: **discarded-statement, no-param, stack-neutral handler only** (which is 100% of the recipe), and **mandatory verification against the real deployed EVM engine** via an integration test mirroring `ts-frontend`/`try-catch` conformance before this is trusted. The TS `catch` (`saucer.ts:534`) plus the engine's CATCH handler are the byte-level oracle to match.

**Breadth tax (mechanical, low-depth):** a new `Stmt::TryCall` needs a match arm in the ~11 passes that exhaustively match `Stmt` — `ir.rs` (def), `lower/statement.rs` (produce it), `reachability.rs` (**must** recurse into both `call` and `handler`, or a user-function call inside a handler would drop its callee and orphan a patch — the exact hazard codegen.rs:196-212 documents), `scope.rs`, `eval_order.rs`, `dead_store.rs`, `push_order.rs`, `fold.rs`, `unroll.rs`, `capability.rs`, `codegen.rs`. Each is a shallow "visit the call expr, then walk the handler block" — the same recursion `Stmt::If` already has. This breadth is why it's **M and not S**, but none of it is deep.

---

## 5. SVM — hard divergence, EVM-only by construction

Confirmed: `targets.rs:1131` — `Feature::TryCatch => Availability::Unavailable { reason: "the SVM engine has no try/catch" }`. In RS, compiling a `.catch()` for `target: svm` is a **compile-time capability error**, so the full ecoswap recipe **can never compile on SVM** in RS. `.catch` is EVM-only by construction. Keep it that way.

Worth recording as a **cross-compiler divergence** for the §1.2 registry: the _TS_ compiler actually _does_ emit CATCH on svm (`svm-profile.ts:32-33`), but with strictly narrower runtime semantics — CATCH intercepts only **pre-flight** CPI failures; once `invoke()` launches, a failing callee aborts the whole transaction. So even in TS, the recipe's probe-and-fallback pattern (catch a _reverting pool call_) does **not** work on svm — a genuine revert aborts the tx rather than being caught. RS's flat compile-time refusal is therefore the _more honest_ position and the one I recommend: it turns a silent runtime-semantics trap into a clear compile error. Divergence resolution: **RS = Unavailable on svm; TS = Available-but-narrower**; the recipe is EVM-only either way. Recommend documenting RS's refusal as the canonical behavior and noting TS's laxer svm emission as a known, non-load-bearing divergence.

---

## 6. Effort & recommendation

**Effort: M.** Not L. The scary part (an inline compiled-blob primitive) does not need to be built — RS's forward-emit + fixed-width-placeholder-patch model already does it; the CATCH handler is just an inline block with a 1-byte length patched in place, structurally identical to how an `if` arm is already emitted. The work is: one opcode byte, wire an already-declared feature, one new `Stmt` variant threaded through ~11 exhaustive-match passes (shallow), a lowering rule, a narrow frontend carve-out, and — the only non-mechanical item — **matching the engine's CATCH stack contract, verified on the real EVM**. Comparable in shape to NS-1/PR-13: it _looked_ like it needed a new primitive and turned out to ride existing machinery.

**Recommendation: DESIGN-DONE, BUILD-ELIGIBLE — do not force it into the autonomous loop as-is; sequence it as an explicit, gated EVM-only stretch item.** Rationale, honestly weighed:

- It is **bounded (M)** and this document is a ready-to-build spec, so it does _not_ meet the bar for "document as a scoped deferral because it's genuinely L with a novel primitive." That escape hatch doesn't apply.
- But it is **beyond the designated unrolled north-star**, it is **SVM-divergent** (so it can only ever advance the _EVM_ full-recipe stretch, never parity), and its single non-mechanical risk (CATCH stack discipline) **requires real-engine verification** that the autonomous verify lane must actually run, not reason about. Landing an unverified CATCH would be the one way this bounded change becomes a silent miscompile.

Concrete sequencing if built:

1. `Opcode::Catch = 0xB7` + `Feature::TryCatch` EVM-available; add a bare-metal codegen unit test emitting `<call> CATCH len <handler>` and byte-diffing against the TS `saucer.catch` output for the `ok = 0` handler.
2. `Stmt::TryCall` + the ~11 pass arms (reachability first — it gates the others).
3. Frontend carve-out + lowering (no-param, stack-neutral, discarded-statement subset; clear rejections for param / multi-statement / value-position, matching the recipe's actual surface).
4. **Gate:** an integration test running compiled bytecode on the real deployed EVM engine — a pool call that reverts must run the handler (`ok → 0`) and one that succeeds must skip it, with the stack reconciled on both paths. Only after this is green is `.catch` trusted.
5. Explicitly assert the svm compile-time rejection (a test pinning `Feature::TryCatch` Unavailable), so the EVM-only divergence is locked.

Net: the full `ecoswap.sauce.ts` becoming an **EVM-only** RS target is reachable with this M change; SVM parity for the full recipe is off the table by construction and should stay documented as such.
