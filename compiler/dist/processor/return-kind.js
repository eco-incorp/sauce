import { inferKind, abiOutputKind } from './inference.js';
import { resolveContractCallTarget, resolveCatchChain, matchStandaloneBindingShape } from './expression.js';
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
export function analyzeFunctionReturnKinds(declarations, ctx) {
    const declMap = new Map();
    const kinds = new Map();
    for (const decl of declarations) {
        const name = decl.id?.name;
        if (!name)
            continue;
        declMap.set(name, decl);
        kinds.set(name, 'scalar');
    }
    // Hard-bounded fixpoint: one extra pass beyond the number of functions guarantees a
    // chain of N distinct callers each newly discovering their callee's promotion has fully
    // propagated, even in the worst declaration order (mutual recursion just stops changing
    // once both sides have converged, so it never blows the bound either).
    const maxIterations = declMap.size + 1;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
        let changed = false;
        for (const [name, decl] of declMap) {
            if (kinds.get(name) === 'dynamic')
                continue; // monotone: never demoted, so never re-checked
            if (functionReturnsDynamic(decl, declMap, kinds, ctx)) {
                kinds.set(name, 'dynamic');
                changed = true;
            }
        }
        if (!changed)
            break;
    }
    return kinds;
}
// Whether ANY reachable `return <expr>;` in `decl`'s body is provably dynamic — the sound
// direction (see analyzeFunctionReturnKinds's own doc comment): a mixed-return function
// (one path scalar, another dynamic) is classified dynamic, which costs at most an extra
// heap slot, never a dropped descriptor.
function functionReturnsDynamic(decl, declMap, kinds, ctx) {
    // A FLAT map, deliberately: the real compiler shares scope across `if`/`while` bodies
    // (processor/statement.ts's processIfStatement/processWhileStatement never push a
    // scope — only processForStatement does), so a `let`/`const` first declared inside a
    // branch is the SAME persisting binding for the rest of the function, not a
    // block-scoped one this analysis could safely forget once the branch ends.
    const locals = new Map();
    // The SAME flat-scope reasoning applies to a `let pool = Contract.at(addr);` binding —
    // see `kindOfExpr`'s own doc comment for why this pass tracks it separately from
    // `ctx.boundContracts` rather than consulting that (empty, this early) map.
    const localBoundContracts = new Map();
    return walkStatements(decl.body.body, locals, declMap, kinds, ctx, localBoundContracts);
}
function walkStatements(statements, locals, declMap, kinds, ctx, localBoundContracts) {
    let dynamic = false;
    for (const stmt of statements) {
        if (walkStatement(stmt, locals, declMap, kinds, ctx, localBoundContracts))
            dynamic = true;
    }
    return dynamic;
}
// Visits every statement kind the base SauceScript processor itself accepts
// (processor/statement.ts's processStatement) that can carry a nested body sharing this
// function's flat scope — BlockStatement/IfStatement/ForStatement/WhileStatement — plus
// VariableDeclaration/ExpressionStatement (assignment) for tracking `locals`, and
// ReturnStatement for the verdict itself. Anything else (a bare UpdateExpression
// statement, ThrowStatement, …) contributes nothing and is intentionally not visited —
// this pass never crosses into a nested function/arrow either way, since none of those
// node types can introduce one.
function walkStatement(stmt, locals, declMap, kinds, ctx, localBoundContracts) {
    switch (stmt.type) {
        case 'BlockStatement':
            return walkStatements(stmt.body, locals, declMap, kinds, ctx, localBoundContracts);
        case 'IfStatement': {
            const ifStmt = stmt;
            const consequentDynamic = walkBody(ifStmt.consequent, locals, declMap, kinds, ctx, localBoundContracts);
            const alternateDynamic = ifStmt.alternate
                ? walkBody(ifStmt.alternate, locals, declMap, kinds, ctx, localBoundContracts)
                : false;
            return consequentDynamic || alternateDynamic;
        }
        case 'ForStatement':
            return walkBody(stmt.body, locals, declMap, kinds, ctx, localBoundContracts);
        case 'WhileStatement':
            return walkBody(stmt.body, locals, declMap, kinds, ctx, localBoundContracts);
        case 'VariableDeclaration': {
            for (const declarator of stmt.declarations) {
                if (declarator.id.type === 'Identifier' && declarator.init) {
                    const name = declarator.id.name;
                    const init = declarator.init;
                    const kind = kindOfExpr(init, locals, declMap, kinds, ctx, localBoundContracts);
                    locals.set(name, kind);
                    // `let pool = Contract.at(addr);` — track the binding so a LATER `pool.method()`
                    // call in this same function can resolve during THIS pass too (see `kindOfExpr`'s
                    // own doc comment for why `ctx.lookupBoundContract` can never see it here).
                    const standalone = matchStandaloneBindingShape(init);
                    const contract = standalone ? ctx.lookupContract(standalone.contractName) : undefined;
                    if (standalone && contract) {
                        localBoundContracts.set(name, { contract, callTypeOverride: standalone.callTypeOverride });
                    }
                    continue;
                }
                // `const [n, xs] = Contract.at(addr).method();` — a destructuring declarator, the
                // SHAPE `processDestructuringDeclaration` (statement.ts) exclusively requires for
                // array-pattern declarations. See `applyDestructuringKinds`'s own doc comment for
                // why this can't just reuse `kindOfExpr` (there is no single initializer expression
                // to classify — each bound name gets its OWN per-output ABI kind).
                if (declarator.id.type === 'ArrayPattern' && declarator.init) {
                    applyDestructuringKinds(declarator.id, declarator.init, locals, ctx);
                }
            }
            return false;
        }
        case 'ExpressionStatement': {
            const expr = stmt.expression;
            if (expr.type === 'AssignmentExpression') {
                const assign = expr;
                if (assign.operator === '=' && assign.left.type === 'Identifier') {
                    const name = assign.left.name;
                    const kind = kindOfExpr(assign.right, locals, declMap, kinds, ctx, localBoundContracts);
                    // Promote-only (never demote): a flat, sequential merge across if/else branches
                    // is only sound in the 'never demote' direction — see analyzeFunctionReturnKinds.
                    if (kind === 'dynamic')
                        locals.set(name, 'dynamic');
                    // ADVERSARIAL-AUDIT FIX (this branch): `pool = Contract2.at(addr2);` REBINDS
                    // `pool` to a (possibly different) contract — mirror the VariableDeclaration
                    // case's own tracking just above, so a LATER `pool.method()` call in this same
                    // function resolves against the NEW binding, not a stale one. Before this fix,
                    // `localBoundContracts` was populated ONLY by the declaration and never touched
                    // again here, so a reassignment left the ORIGINAL contract's binding in place
                    // forever — confirmed to cause two distinct failures: a false-positive "Unknown
                    // method ... on contract ..." crash in THIS pre-pass (aborting the compile of a
                    // program the real, `ctx.boundContracts`-backed compile stage accepts just
                    // fine — that map DOES update correctly on this exact reassignment, via
                    // `consumePendingContractBinding`), and a silent under-classification when the
                    // two contracts share a method NAME but differ in output shape (the stale
                    // entry's scalar output masking the new binding's dynamic one, so a caller
                    // storing the result drops the descriptor via WRITE_VALUE instead of
                    // WRITE_HEAP). See test/return-kind.test.ts's "a reassigned variable-bound
                    // contract" describe block for both real-world repros.
                    const standalone = matchStandaloneBindingShape(assign.right);
                    const contract = standalone ? ctx.lookupContract(standalone.contractName) : undefined;
                    if (standalone && contract) {
                        localBoundContracts.set(name, { contract, callTypeOverride: standalone.callTypeOverride });
                    }
                    else {
                        // The RHS isn't a resolvable contract binding (a plain value, an aliasing
                        // read, an unresolvable name, …) — invalidate any STALE entry rather than
                        // leaving it around to be wrongly consulted by a later `name.method()` call.
                        // Conservative: `resolveMethodTarget` simply can't resolve `name` as a bound
                        // contract anymore, exactly as if it had never been tracked at all — costs at
                        // most a missed optimization (falling back to the generic `inferKind` guess),
                        // never a wrong classification.
                        localBoundContracts.delete(name);
                    }
                }
            }
            return false;
        }
        case 'ReturnStatement': {
            const ret = stmt;
            return ret.argument
                ? kindOfExpr(ret.argument, locals, declMap, kinds, ctx, localBoundContracts) === 'dynamic'
                : false;
        }
        default:
            return false;
    }
}
// A `for`/`while`/`if` body is either a BlockStatement or a single bare statement
// (`if (c) return x;`) — both are valid `processStatement` targets, so both are walked.
function walkBody(body, locals, declMap, kinds, ctx, localBoundContracts) {
    return walkStatement(body, locals, declMap, kinds, ctx, localBoundContracts);
}
// The kind of a (sub)expression per THIS pass's own local flow reasoning, falling back to
// the file's one real ctx-free evaluator (`inferKind`) for anything not an Identifier/
// same-file-function-call/single-dynamic-output contract call — which already returns
// 'dynamic' for NewExpression/ArrayExpression/ObjectExpression/a string Literal/
// .concat()/.slice()/dynamic GLOBALS.
function kindOfExpr(expr, locals, declMap, kinds, ctx, localBoundContracts) {
    if (expr.type === 'Identifier') {
        return locals.get(expr.name) ?? 'scalar';
    }
    if (expr.type === 'CallExpression') {
        const call = expr;
        if (call.callee.type === 'Identifier') {
            const name = call.callee.name;
            // A same-file declared function: use its CURRENT fixpoint entry (never 'scalar' by
            // fallback here — an entry always exists once seeded) rather than falling through to
            // `inferKind`'s generic CallExpression case, which has no notion of same-file
            // functions at all and would otherwise default this to 'scalar' every time.
            if (declMap.has(name))
                return kinds.get(name) ?? 'scalar';
        }
        // A direct external contract-method call with a SINGLE dynamic ABI output — either the
        // inline chain shape (`Contract.at(addr).method()`, resolvable via `ctx.lookupContract`
        // THIS early) or a variable-bound call (`pool.method()`, resolvable only via THIS pass's
        // own `localBoundContracts` tracking — see `resolveMethodTarget`'s own doc comment for
        // why `ctx.lookupBoundContract` can never see the binding this early). The sibling of
        // `singleDynamicAbiOutputKind` (processor/statement.ts), which closes the identical gap
        // for the DIRECT store path. Without this case here, a HELPER that stores and returns
        // such a call stayed mis-classified even after that fix landed, since THIS pass never
        // consults statement.ts's helper at all. Excludes a `.catch()` chain for the same reason
        // `singleDynamicAbiOutputKind` does — though structurally moot here too
        // (resolveContractCallTarget/resolveMethodTarget already can't match a `.catch(...)`-
        // wrapped call's outer MemberExpression shape), spelling it out keeps both call sites in
        // this bug family visibly consistent rather than relying on that being true.
        if (!resolveCatchChain(call)) {
            const target = resolveMethodTarget(call, ctx, localBoundContracts);
            const outputs = target?.method.outputs;
            if (outputs && outputs.length === 1 && abiOutputKind(outputs[0]) === 'dynamic')
                return 'dynamic';
        }
    }
    return inferKind(expr);
}
// Resolves a call's target method, trying the real `resolveContractCallTarget` first (handles
// the inline `Contract.at(addr).method()` chain, resolvable this early via `ctx.lookupContract`
// alone) and, only if that fails, THIS pass's own `localBoundContracts` map — the variable-bound
// `pool.method()` shape `resolveContractCallTarget` can never resolve here, since
// `ctx.lookupBoundContract` is only ever populated on a per-function CHILD context while
// actually compiling a body (see `analyzeFunctionReturnKinds`'s own doc comment). Mirrors
// `resolveContractCallTarget`'s own variable-bound branch (`processor/expression.ts`) exactly,
// just sourcing the binding from this pass's pass-local map instead of `ctx.boundContracts` —
// deliberately NOT threaded through the shared, exported `resolveContractCallTarget` itself,
// since that function's signature (and every other, real-compile-time caller of it) has no use
// for a second, pre-pass-only binding source.
function resolveMethodTarget(call, ctx, localBoundContracts) {
    const target = resolveContractCallTarget(call, ctx);
    if (target)
        return target;
    if (call.callee.type !== 'MemberExpression')
        return undefined;
    const member = call.callee;
    if (member.object.type !== 'Identifier' || member.property.type !== 'Identifier')
        return undefined;
    const bound = localBoundContracts.get(member.object.name);
    if (!bound)
        return undefined;
    const methodName = member.property.name;
    const method = bound.contract.methods.get(methodName);
    if (!method)
        throw new Error(`Unknown method "${methodName}" on contract "${bound.contract.name}"`);
    return { method };
}
// Mirrors `processDestructuringDeclaration`'s (statement.ts) own per-element kind —
// `abiOutputKind(output)` — for a `const [a, b] = Contract.at(addr).method();` destructuring
// declarator, so a bound name later `return`ed resolves to its REAL ABI output kind instead
// of silently never entering `locals` at all (the under-classification this closes — see the
// finding this fixes: `xs` from `const [n, xs] = Contract.at(addr).list();` falling through
// `kindOfExpr`'s `locals.get('xs') ?? 'scalar'` default because `xs` was never recorded).
//
// Can't reuse `kindOfExpr` for this: a destructuring declarator has no single initializer
// EXPRESSION to classify — the call's overall "kind" is meaningless, only each individual
// bound name has one, taken from its own ABI output component.
//
// Only the direct `Contract.at(addr).method()`/`.view()`/`.lib()` inline-chain call shape is
// resolvable THIS early (see `analyzeFunctionReturnKinds`'s own doc comment for exactly why a
// variable-bound contract call can never resolve here). Whenever the target can't be
// resolved this way — an unrecognized call shape, a variable-bound contract, anything else —
// EVERY bound name in the pattern is conservatively marked 'dynamic' rather than left
// unrecorded (and therefore silently defaulting to 'scalar' the same way the ORIGINAL bug
// did): the same "when genuinely unsure, promote" rule `functionReturnsDynamic`'s own doc
// comment already applies to a mixed-return function. This can only ever cost an unnecessary
// extra heap slot on a shape that was always going to fail `processDestructuringDeclaration`'s
// own stricter validation anyway (destructuring requires a resolvable contract-call
// initializer, full stop) — never a dropped descriptor.
function applyDestructuringKinds(pattern, init, locals, ctx) {
    const boundNames = [];
    for (const element of pattern.elements) {
        // A hole (`const [, xs] = …`) or a rest element binds no name here — both are either
        // skipped or hard-rejected by `processDestructuringDeclaration` itself; either way there
        // is nothing for THIS pass to record.
        if (element && element.type === 'Identifier')
            boundNames.push(element.name);
    }
    const target = resolveContractCallTarget(init, ctx);
    if (!target) {
        // Unresolvable this early (see doc comment above) — promote every bound name rather
        // than silently leaving it unrecorded (which `kindOfExpr` would then default to
        // 'scalar', reproducing the exact bug this function exists to close).
        for (const name of boundNames)
            locals.set(name, 'dynamic');
        return;
    }
    const outputs = target.method.outputs ?? [];
    pattern.elements.forEach((element, index) => {
        if (!element || element.type !== 'Identifier')
            return;
        const output = outputs[index];
        const name = element.name;
        // An out-of-range index has no ABI component to consult (the real compiler rejects this
        // shape outright — `pattern.elements.length > outputs.length` — before it would ever
        // reach here); promote rather than guess.
        locals.set(name, output ? abiOutputKind(output) : 'dynamic');
    });
}
