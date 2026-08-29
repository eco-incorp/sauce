import type { Expression } from 'acorn';
import type { SaucerLike } from './saucer/index.js';
import type { VariableKind } from './context.js';
type PropertyCompile = (saucer: SaucerLike) => SaucerLike;
type MethodCompile = (saucer: SaucerLike, args: Expression[], process: (e: Expression) => SaucerLike) => SaucerLike;
export interface GlobalDef {
    kind: VariableKind;
    compile: PropertyCompile | MethodCompile;
}
export declare const GLOBALS: Record<string, Record<string, GlobalDef>>;
/**
 * STANDARD-LIBRARY freestanding functions (compiler-parity decision 0.6).
 *
 * The standard library is a first-class contributor to the global namespace: stdlib
 * symbols reach user code WITHOUT an explicit import precisely by being INJECTED into
 * globals (the standing "stdlib-injects-into-globals" design constraint,
 * docs/plans/compiler-parity-and-port-plan.md). `emit` is that model made concrete —
 * it is NOT a native intrinsic (contrast `NATIVE_GLOBAL_FUNCTIONS` above, each a direct
 * op lowering) but a LIBRARY function that COMPOSES existing primitives: it derives
 * topic0 = keccak256(signature), ABI-encodes the non-indexed fields, and lowers to the
 * one native primitive `s.log(data, topics)` (the LOG op). RS spells the same event
 * primitive `log()`; TS spells it `emit` (see the RS↔TS mapping note below).
 *
 * Keeping stdlib functions in a SEPARATE table, then spread-merging them into the
 * exported `GLOBAL_FUNCTIONS`, is what makes the injection literal: `GLOBAL_FUNCTIONS`
 * is deliberately NOT native-ops-only. Everything downstream (call dispatch in
 * `processor/expression.ts`, kind inference, and the `RESERVED_NAMES` callable set —
 * all keyed off the merged `GLOBAL_FUNCTIONS`) sees the injected `emit` identically, so
 * the classification change is byte-for-byte transparent to codegen and reservation.
 */
export declare const STDLIB_FUNCTIONS: Record<string, GlobalDef>;
/**
 * Freestanding global functions, resolved by a bare call before any user function.
 *
 * The stdlib-contributed functions (`STDLIB_FUNCTIONS`) are INJECTED here via a
 * spread-merge — the "stdlib-injects-into-globals" model (decision 0.6). No name
 * collides between the two tables, so the merged shape is exactly the native
 * intrinsics plus `emit`, keyed identically to before the extraction.
 */
export declare const GLOBAL_FUNCTIONS: Record<string, GlobalDef>;
/**
 * Names refused where a CALLABLE is DECLARED — a `function` declaration
 * (`CompilerContext.addFunc`) or an inline arrow-const function name
 * (`processor/inline.ts`). Broad on purpose: it covers every builtin the call path
 * resolves before a user function — the freestanding `GLOBAL_FUNCTIONS` (`gasLeft()`,
 * `blockHash()`, `emit()`, `uint()`, …, intercepted in `processCallExpression`) and
 * the namespace roots — so a same-named user callable can never be silently shadowed
 * (the ECO-2011 hazard class). TS's freestanding-builtin surface is WIDER than
 * compiler-rs's (RS spells the primitives `revert`/`log`, TS spells them `throw`/`emit`),
 * so this callable reservation is deliberately wider than RS's function-name set
 * ({revert,require,log,eval}); narrowing it to RS's would reopen that hazard for every
 * `GLOBAL_FUNCTIONS` name. See docs/plans/compiler-parity-BACKLOG.md §1.8 / decision 0.4.
 */
export declare const RESERVED_NAMES: Set<string>;
/**
 * Names refused only as a VALUE BINDING — a `let`/`const`/parameter
 * (`CompilerContext.setVar`). Exactly the builtin NAMESPACE ROOTS whose member calls
 * resolve THROUGH the root identifier BEFORE any scope lookup (`abi.encode`,
 * `crypto.keccak256`, `ctx.msgSender()`, `Math.sqrt`, and — landing with §1.3 — `evm.*`
 * / `svm.*`): a binding there is reachable-looking yet unreachable, so it is refused
 * rather than silently shadowed. Matches compiler-rs's binding-name rule exactly
 * (`Namespace`, `lower/mod.rs`; decision 0.4).
 *
 * Deliberately NARROWER than `RESERVED_NAMES`: every OTHER TS global (`msg`, `block`,
 * `tx`, `address`, `contract`, `storage`, `Uint8Array`) is a member-access-only or
 * call-only surface a plain value binding cannot shadow (member reads check `GLOBALS`
 * first; bare calls resolve `GLOBAL_FUNCTIONS` first) — so RS accepts `let msg = 1n;` /
 * `let block = 1n;` and, with this set, so does TS. `evm`/`svm` are reserved ahead of
 * the §1.3 namespace split (RS reserves them; nothing on TS binds them today).
 */
export declare const RESERVED_BINDING_NAMES: Set<string>;
export {};
//# sourceMappingURL=globals.d.ts.map