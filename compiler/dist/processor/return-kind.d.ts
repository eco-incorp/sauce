import type { FunctionDeclaration } from 'acorn';
import type { CompilerContext, VariableKind } from '../context.js';
/**
 * Same-file, declaration-order-INDEPENDENT analysis of every declared function's RETURN
 * storage kind — the piece `inferKindWithContext` (inference.ts) is missing to correctly
 * infer `let arr = helper();` as `dynamic` when `helper()`'s own body returns a
 * `new Array(n)`-built TUPLE (or any other dynamic-kind expression). See this repo's
 * CLAUDE.md "Same-file user-function return-kind inference" note for the full story
 * (the bug this closes, and the two already-fixed sibling bugs in the same family).
 *
 * Deliberately a FIXPOINT pre-pass, not something recorded while compiling each function's
 * body: recording kinds AS you compile is declaration-ORDER dependent — a caller declared
 * BEFORE its callee in the source would still see the callee's pre-analysis (scalar)
 * default. Seeding every function to 'scalar' and only ever PROMOTING to 'dynamic', across
 * up to `declarations.length + 1` full passes, converges regardless of declaration order
 * (including mutual/chained helper→helper calls) and terminates by construction (a
 * height-1 lattice — only one promotion per name is possible at all).
 *
 * `ctx` is the bare MODULE-level `CompilerContext` this pre-pass runs against — the same one
 * `processProgram` later compiles every function body with, but BEFORE any body has actually
 * been compiled. That is enough to resolve a `Contract.at(addr).method()` inline-chain
 * contract call (`ctx.lookupContract` is already populated by `collectImportedFunctions`'s
 * `.json`-import handling, which runs strictly before this pass) directly off `ctx`, but NOT a
 * call through a variable-bound contract (`let pool = Contract.at(addr); pool.method()`) —
 * that binding is only ever recorded into `ctx.boundContracts` on a per-function CHILD context
 * while actually compiling a body (via `consumePendingContractBinding`), so
 * `ctx.lookupBoundContract` can never have anything registered yet against THIS bare ctx.
 *
 * **Fix (this branch): a bound-variable call in `kindOfExpr`'s single-non-destructured-output
 * case no longer silently under-classifies.** `walkStatement`'s own `VariableDeclaration` case
 * now ALSO tracks a `let pool = Contract.at(addr);` declarator into a pass-LOCAL
 * `localBoundContracts` map (mirroring `consumePendingContractBinding`'s real registration,
 * but writing to this pass's own bookkeeping instead of mutating the shared `ctx` — mutating
 * `ctx.boundContracts` here would corrupt the state the REAL compile pass depends on
 * afterward), so `resolveMethodTarget` (below `kindOfExpr`) can resolve a later `pool.method()`
 * call within the SAME function even though `ctx.lookupBoundContract` itself still can't. Before
 * this fix, `kindOfExpr`'s CallExpression case fell straight through to the ctx-free
 * `inferKind` fallback for this shape — defaulting to `'scalar'` and silently dropping the
 * descriptor, the exact under-classification this whole file exists to prevent. This is FLAT,
 * function-scoped tracking, same as `locals` above, for the identical reason (SauceScript
 * shares scope across `if`/`while` bodies).
 *
 * `applyDestructuringKinds` (the destructuring-declarator case) is DELIBERATELY left
 * unchanged: it already handles an unresolvable target (including this exact variable-bound
 * shape) by conservatively promoting every bound name to `'dynamic'` rather than
 * under-classifying — see its own doc comment, and
 * `integration-test/function-return-kind.test.ts`'s "conservative fallback" test, which pins
 * that intentional, already-safe behavior as a documented characteristic, not a bug to fix here.
 *
 * **Adversarial-audit fix (this branch): a REASSIGNED bound-contract variable went stale in
 * `localBoundContracts`.** The `VariableDeclaration` case above tracks the FIRST `let pool =
 * Contract.at(addr);` binding, but `walkStatement`'s `ExpressionStatement`/`AssignmentExpression`
 * case never updated `localBoundContracts` when `pool` was later REASSIGNED
 * (`pool = Contract2.at(addr2);`) — the stale original binding stayed in the map forever, even
 * though the REAL compile stage's own `ctx.boundContracts` updates correctly on this exact
 * reassignment (`consumePendingContractBinding` fires for every store whose RHS was a standalone
 * binding call). Confirmed to cause two distinct failures, both fixed by making the
 * `AssignmentExpression` case mirror the `VariableDeclaration` case's own tracking (update on a
 * NEW resolvable binding, `localBoundContracts.delete` otherwise): a false-positive "Unknown
 * method ... on contract ..." crash in THIS pre-pass, aborting the compile of a program the real
 * compile stage accepts just fine (the two contracts don't share the called method name); and a
 * silent under-classification when they DO share a method name but differ in output shape (the
 * stale entry's scalar output masking the new binding's dynamic one, so a caller storing the
 * result drops the descriptor via WRITE_VALUE instead of WRITE_HEAP — confirmed via real EVM
 * execution, `SauceInvalidOperationArgs(0x97)` on the caller's indexed read). See
 * `test/return-kind.test.ts`'s "a reassigned variable-bound contract" describe block (compile-time
 * shape, both failure modes) and `integration-test/dynamic-kind-sweep.test.ts`'s analogous describe
 * block (the real-EVM value proof of the silent one).
 */
export declare function analyzeFunctionReturnKinds(declarations: FunctionDeclaration[], ctx: CompilerContext): Map<string, VariableKind>;
//# sourceMappingURL=return-kind.d.ts.map