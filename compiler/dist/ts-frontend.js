import * as ts from 'typescript';
import { evaluate } from 'ts-evaluator';
// ── TypeScript front-end: fold + strip a `.ts`/`.sauce.ts` module BEFORE acorn ──
//
// Runs strictly earlier than the existing acorn pipeline: it turns TS source text into
// plain JS source text, folding provably-constant branches/expressions/loops along the
// way. Everything downstream (const-eval.ts, tree-shaking, statement.ts fold sites) is
// unchanged — it only ever sees narrower/simpler text than before, never different
// codegen for the same emitted shape.
//
// TWO evaluators, layered:
//  1. `tsEvalConst` — a hand-rolled bigint evaluator (Literal/Identifier/Unary/Binary),
//     mirroring processor/const-eval.ts's logic but retargeted to ts.Node. It exists
//     because `ts-evaluator` cannot reliably evaluate bigint arithmetic AT ALL (see the
//     crash note on `tryEvaluate` below) — and SauceScript is bigint-only, so this is the
//     PRIMARY evaluator for everything that matters here (conditions, arithmetic, and the
//     loop-unroller's bound resolution). Identifiers resolve against `consts`, every
//     same-file top-level `const NAME = <literal>` (collected once per module, in
//     declaration order, so a later const may reference an earlier one).
//  2. `tryEvaluate` (ts-evaluator) — a fallback for shapes the hand-rolled evaluator
//     doesn't cover (bare boolean/string identifiers, ternaries-as-values, templates). No
//     `ts.Program`/TypeChecker is built, so it resolves identifiers only within the same
//     source file (its own documented no-checker behavior) and cannot see into arrays/
//     object property access or function calls without one — folding across a TS import
//     boundary, or over array/object data, is out of scope here (the existing source-file
//     FUNCTION import mechanism is separate and already cross-file).
//
// A failed/unresolvable evaluation always leaves the node untouched — folding can only
// ever remove/replace something PROVABLY constant, so a runtime-derived condition or loop
// compiles exactly as if this pass didn't run.
const POLICY = {
    io: false,
    network: false,
    process: false,
    console: false,
    deterministic: true,
    maxOps: 100_000,
    maxOpDuration: 2_000,
};
/** A countable `for` loop unrolls into at most this many copies of its body. */
const MAX_UNROLL_ITERATIONS = 256;
/** A local `new Array(n)` construction (see the "Local `new Array(n)` construction folding"
 * section further below) folds only when `n` resolves to `1..this`. A SEPARATE cap, deliberately
 * not a reuse of `MAX_UNROLL_ITERATIONS` even though it starts at the same value: that one bounds
 * emitted BYTECODE GROWTH (N copies of a loop body), this one bounds the tracked ELEMENT TABLE
 * and how many write statements the region classifier must match — sharing the identifier would
 * silently couple two unrelated tuning decisions. 256 is the natural value regardless: a
 * construction run realistically comes FROM an unrolled loop, itself capped at 256 — an array
 * larger than that can only have been written by a loop that did NOT unroll, whose writes are
 * disqualified by this pass anyway. Enforced at the declaration gate (`newArraySize`), before any
 * `bigint[]` element table is even allocated, so a hostile `new Array(1e9)` costs one comparison. */
const MAX_FOLDED_ARRAY_ELEMENTS = 256;
/** A `return arr;` return-escape fold (see Rule 6b in `scanArrayUses`, and the "one escaping
 * shape that IS authorized" note above it) only ever fires for `candidate.size` up to THIS,
 * a separate and deliberately SMALLER cap than `MAX_FOLDED_ARRAY_ELEMENTS`. Every OTHER
 * sub-case of this pass shrinks bytecode (an eliminated `NEW_ARRAY`/`SET_INDEX`/`INDEX`
 * costs far more than the literal it's replaced by); this one is the exception — a wide
 * (BYTE_32-forced, see "Forcing uint256 element width") literal element costs 32 bytes
 * against roughly 10 for the `SET_INDEX` it replaces, a measured ~3.5× growth at 64
 * elements (2052 vs 586 bytes) that would be ~8.2 KB at the shared 256 cap. Kept well
 * under that so this one growth-direction sub-case can't blow up bytecode size the way
 * the pass's own charter (capped so it can't) already promises for every other rule. */
const MAX_FOLDED_RETURN_ARRAY_ELEMENTS = 64;
/** Shared empty shadow set — module (top-level) scope has nothing shadowing it, and a
 * same-file top-level function's own body/defaults are evaluated fresh against this (see
 * `tsEvalCall`): its free variables can only be OTHER top-level bindings, never whatever
 * happens to be shadowed at whatever call site is being folded. */
const EMPTY_SHADOW = new Set();
function tryEvaluate(node) {
    try {
        const result = evaluate({ node, typescript: ts, environment: { preset: 'NONE' }, policy: POLICY });
        return result.success ? { success: true, value: result.value } : { success: false };
    }
    catch {
        // ts-evaluator@2.0.0 throws (rather than returning a failure result) for some node
        // shapes it can't evaluate — e.g. a bare BigIntLiteral (`BigInt(node.text)` on text
        // like "3n" is itself a SyntaxError). Folding must never crash a compile: treat a
        // thrown error the same as an unsuccessful evaluation and leave the node untouched.
        return { success: false };
    }
}
function tsEvalConst(node, consts, functions, shadowed) {
    if (ts.isParenthesizedExpression(node))
        return tsEvalConst(node.expression, consts, functions, shadowed);
    if (ts.isBigIntLiteral(node))
        return BigInt(node.text.slice(0, -1)); // strip the "n" ts-evaluator's own BigInt() call rejects
    if (ts.isNumericLiteral(node)) {
        // `node.text` is NOT the literal's raw source text — the TS scanner normalizes a
        // NumericLiteral's own `.text` through a lossy JS-`number` round-trip (confirmed: a
        // suffix-less hex/decimal literal beyond Number.MAX_SAFE_INTEGER comes back as e.g.
        // `"1.157920892373162e+77"`, already wrong before this function ever runs — reproduces
        // even for a PLAIN decimal integer literal, not just hex). `getText()` returns the
        // literal exactly as written (radix prefix intact, full digit string, no float
        // round-trip), which `BigInt()` parses exactly; it throws for any non-integer form
        // (float/exponential literal, or a numeric-separator underscore we strip first since a
        // legal `1_000_000` must still fold) — a thrown/undefined result is the correct "can't
        // fold this" outcome here, matching the old `Number.isInteger` reject path it replaces.
        try {
            return BigInt(node.getText().replace(/_/g, ''));
        }
        catch {
            return undefined;
        }
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword)
        return 1n;
    if (node.kind === ts.SyntaxKind.FalseKeyword)
        return 0n;
    // A name reserved by ANY enclosing scope between this node and the top level (a parameter,
    // a nested function/let/const/var/catch-binding of the same name, …) can never be resolved
    // against the top-level `consts` map — the identifier refers to THAT binding at runtime,
    // never necessarily the same-named top-level const, so this must fail closed (undefined)
    // rather than guess. See `foldTransformer`'s scope-introducing branches, which grow
    // `shadowed` on the way down (mirroring `constPropagationTransformer`'s own shadow tracking).
    if (ts.isIdentifier(node))
        return shadowed.has(node.text) ? undefined : consts.get(node.text);
    if (ts.isPrefixUnaryExpression(node))
        return tsEvalUnary(node, consts, functions, shadowed);
    if (ts.isBinaryExpression(node))
        return tsEvalBinary(node, consts, functions, shadowed);
    if (ts.isCallExpression(node))
        return tsEvalCall(node, consts, functions, shadowed);
    return undefined;
}
function tsEvalUnary(node, consts, functions, shadowed) {
    const v = tsEvalConst(node.operand, consts, functions, shadowed);
    if (v === undefined)
        return undefined;
    switch (node.operator) {
        case ts.SyntaxKind.MinusToken:
            return -v;
        case ts.SyntaxKind.PlusToken:
            return v;
        case ts.SyntaxKind.TildeToken:
            return ~v;
        case ts.SyntaxKind.ExclamationToken:
            return v === 0n ? 1n : 0n;
        default:
            return undefined;
    }
}
function tsEvalBinary(node, consts, functions, shadowed) {
    const op = node.operatorToken.kind;
    // Short-circuit && / ||, matching const-eval.ts: a known-falsy left collapses `&&`, a
    // known-truthy left collapses `||`, even when the right side isn't itself constant.
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
        const left = tsEvalConst(node.left, consts, functions, shadowed);
        const isAnd = op === ts.SyntaxKind.AmpersandAmpersandToken;
        if (left !== undefined && (isAnd ? left === 0n : left !== 0n))
            return isAnd ? 0n : 1n;
        const right = tsEvalConst(node.right, consts, functions, shadowed);
        if (left === undefined || right === undefined)
            return undefined;
        return (isAnd ? left !== 0n && right !== 0n : left !== 0n || right !== 0n) ? 1n : 0n;
    }
    const a = tsEvalConst(node.left, consts, functions, shadowed);
    const b = tsEvalConst(node.right, consts, functions, shadowed);
    if (a === undefined || b === undefined)
        return undefined;
    switch (op) {
        case ts.SyntaxKind.PlusToken:
            return a + b;
        case ts.SyntaxKind.MinusToken:
            return a - b;
        case ts.SyntaxKind.AsteriskToken:
            return a * b;
        case ts.SyntaxKind.SlashToken:
            return b === 0n ? undefined : a / b;
        case ts.SyntaxKind.PercentToken:
            return b === 0n ? undefined : a % b;
        case ts.SyntaxKind.AsteriskAsteriskToken:
            return b < 0n ? undefined : a ** b;
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsToken:
            return a === b ? 1n : 0n;
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsToken:
            return a !== b ? 1n : 0n;
        case ts.SyntaxKind.LessThanToken:
            return a < b ? 1n : 0n;
        case ts.SyntaxKind.LessThanEqualsToken:
            return a <= b ? 1n : 0n;
        case ts.SyntaxKind.GreaterThanToken:
            return a > b ? 1n : 0n;
        case ts.SyntaxKind.GreaterThanEqualsToken:
            return a >= b ? 1n : 0n;
        case ts.SyntaxKind.AmpersandToken:
            return a & b;
        case ts.SyntaxKind.BarToken:
            return a | b;
        case ts.SyntaxKind.CaretToken:
            return a ^ b;
        case ts.SyntaxKind.LessThanLessThanToken:
            return a << b;
        case ts.SyntaxKind.GreaterThanGreaterThanToken:
            return a >> b;
        default:
            return undefined;
    }
}
// `collectTopLevelConsts` (real `const` only) has grown into `analyzeTopLevelConsts`, defined
// further down (after the shadow-tracking helpers it now shares with `substituteConstReads`) —
// see the "effectively-const `let`/`var` detection" section below for the full story.
/**
 * True if a CallExpression or NewExpression occurs anywhere in `node`, including `node`
 * itself. A same-file top-level function is only ever a call-folding candidate when its body
 * contains ZERO of these anywhere (see `foldableReturnExpr`) — a body that never calls
 * anything trivially can't recurse (so no separate recursion analysis is needed) and can't
 * reach a side effect through a nested call either, which is the entire soundness argument
 * for folding the call away.
 */
function containsCallOrNew(node) {
    if (ts.isCallExpression(node) || ts.isNewExpression(node))
        return true;
    let found = false;
    ts.forEachChild(node, (child) => {
        if (!found && containsCallOrNew(child))
            found = true;
    });
    return found;
}
/**
 * The narrow shape a same-file top-level function must have before a CALL to it can ever
 * fold (see `tsEvalCall`): it is neither a generator nor `async` (calling either never
 * yields its `return`ed value directly — a generator returns an Iterator, `async` returns a
 * Promise — so folding straight to the resolved literal would be a genuine semantic
 * divergence from what the source actually does when run), its ENTIRE body is exactly one
 * `return <expr>;` statement (no other statements, no bare `return;`), every parameter is a
 * plain identifier (no destructuring, no rest), and neither the return expression nor any
 * parameter's default initializer contains a CallExpression/NewExpression anywhere. Returns
 * the return expression when eligible, `undefined` otherwise — fails closed, same convention
 * as every other check in this evaluator, so an ineligible function simply leaves every call
 * to it untouched rather than throwing or guessing.
 */
function foldableReturnExpr(fn) {
    if (fn.asteriskToken)
        return undefined; // generator — calling it returns an Iterator, never its `return`ed value
    if (ts.getModifiers(fn)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword))
        return undefined; // async — returns a Promise
    if (!fn.body || fn.body.statements.length !== 1)
        return undefined;
    const [stmt] = fn.body.statements;
    if (!ts.isReturnStatement(stmt) || !stmt.expression)
        return undefined;
    if (containsCallOrNew(stmt.expression))
        return undefined;
    for (const param of fn.parameters) {
        if (!ts.isIdentifier(param.name) || param.dotDotDotToken)
            return undefined; // no destructuring/rest params
        if (param.initializer && containsCallOrNew(param.initializer))
            return undefined;
    }
    return stmt.expression;
}
/**
 * Folds a CALL to a same-file, side-effect-free, single-`return`-expression top-level
 * function (`foldableReturnExpr`) when every argument itself resolves to a compile-time
 * constant. Parameters are bound as a temporary overlay ON TOP OF `consts` (a fresh `Map`
 * copy — the caller's own `consts` is never mutated) and the return expression is evaluated
 * through the SAME `tsEvalConst` machinery, so a body that reads a module-level `const`
 * alongside its own parameter(s) resolves correctly (the overlay simply shadows a same-named
 * outer const, exactly like a real parameter would at runtime). The callee's own body/
 * defaults are evaluated against a FRESH (empty) shadow set, never the caller's `shadowed` —
 * a top-level function's free variables can only be other same-file top-level bindings,
 * never whatever happens to be shadowed at whatever call site is being folded.
 *
 * The callee identifier itself must resolve to the top-level function map entry UNSHADOWED:
 * if anything between the call site and the top level (a parameter, a nested function/let/
 * const of the same name, …) rebinds the same name, the call site's callee refers to THAT
 * binding at runtime — never necessarily the top-level function of the same name — so this
 * declines to fold rather than guess which one was meant (see `foldTransformer`'s
 * scope-introducing branches, which grow `shadowed` on the way down).
 *
 * A call that omits an argument for a parameter with a default initializer evaluates that
 * default instead — deliberately handled (not rejected): defaults are evaluated left to
 * right, so a later default may reference an earlier already-bound parameter, matching real
 * JS call semantics, and `foldableReturnExpr` already guarantees a default itself contains no
 * nested call. Every one of the callee's OWN parameter names is excluded from the overlay's
 * initial seed (before any are individually bound below) — real JS/TS parameter-list scoping
 * puts every parameter name (including ones bound LATER in the same list) in its own TDZ for
 * the whole parameter list, so an earlier default referencing a later (or its own,
 * not-yet-bound) parameter name throws at runtime rather than silently reading an outer
 * const of the same name; excluding those names up front reproduces that (the reference
 * simply fails to resolve, declining the fold, instead of reading the wrong value). Any other
 * mismatch — an unknown callee, a callee that isn't a plain identifier (e.g. `obj.method()`),
 * a callee whose body isn't the exact eligible shape, too many arguments, or any argument (or
 * used default) that doesn't itself resolve to a constant — returns `undefined`, leaving the
 * call site completely untouched.
 */
function tsEvalCall(node, consts, functions, shadowed) {
    if (!ts.isIdentifier(node.expression))
        return undefined; // same-file plain calls only — no `obj.method()`
    const calleeName = node.expression.text;
    if (shadowed.has(calleeName))
        return undefined; // the name is rebound between here and the top level
    const fn = functions.get(calleeName);
    if (!fn)
        return undefined;
    const returnExpr = foldableReturnExpr(fn);
    if (!returnExpr)
        return undefined;
    if (node.arguments.length > fn.parameters.length)
        return undefined; // too many args — never valid
    const ownParamNames = new Set();
    for (const param of fn.parameters) {
        if (ts.isIdentifier(param.name))
            ownParamNames.add(param.name.text);
    }
    // Seed the overlay from the outer `consts`, but WITHOUT any name that's also one of the
    // callee's own parameters — that name is reserved for the whole parameter list (TDZ),
    // never the outer const of the same name, even before it's individually bound below.
    const overlay = new Map([...consts].filter(([name]) => !ownParamNames.has(name)));
    for (let i = 0; i < fn.parameters.length; i++) {
        const param = fn.parameters[i];
        const arg = node.arguments[i];
        // `arg` evaluates in the CALLER's scope (their own shadowing applies); an omitted arg's
        // default evaluates in the CALLEE's own (fresh) scope, against the overlay built so far,
        // so it can see earlier parameters already bound this call — but never an unbound later/
        // own one, which correctly fails to resolve instead of reading the outer const.
        let value;
        if (arg)
            value = tsEvalConst(arg, consts, functions, shadowed);
        else if (param.initializer)
            value = tsEvalConst(param.initializer, overlay, functions, EMPTY_SHADOW);
        if (value === undefined)
            return undefined;
        overlay.set(param.name.text, value); // guaranteed Identifier by foldableReturnExpr
    }
    return tsEvalConst(returnExpr, overlay, functions, EMPTY_SHADOW);
}
/** Every same-file top-level NAMED `function` declaration, keyed by name — hoisting-order
 * independent (unlike `consts`, which must be resolved in declaration order): a call or a
 * `const` initializer may reference a function declared anywhere else in the file, matching
 * real JS function-hoisting semantics. */
function collectTopLevelFunctions(sourceFile) {
    const functions = new Map();
    for (const stmt of sourceFile.statements) {
        if (ts.isFunctionDeclaration(stmt) && stmt.name)
            functions.set(stmt.name.text, stmt);
    }
    return functions;
}
/**
 * Every JS/TS assignment-operator token — `=`, `+=`, `&&=`, etc. A BinaryExpression using
 * one of these has a SIDE EFFECT (it mutates its left operand); folding it down to "just its
 * resulting value" would silently discard that mutation. `tsEvalConst`'s own switch already
 * has no case for any of these (so it never resolves one), but `ts-evaluator`'s `evaluate()`
 * — the fallback — DOES "successfully" evaluate a bare assignment expression as if it were a
 * pure value (confirmed: `evaluate()` on `a = 1` returns `1`), so `foldExpression` must refuse
 * to consult EITHER evaluator on one of these, rather than relying on tsEvalConst's silence.
 */
const ASSIGNMENT_OPERATOR_TOKENS = new Set([
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.PlusEqualsToken,
    ts.SyntaxKind.MinusEqualsToken,
    ts.SyntaxKind.AsteriskEqualsToken,
    ts.SyntaxKind.AsteriskAsteriskEqualsToken,
    ts.SyntaxKind.SlashEqualsToken,
    ts.SyntaxKind.PercentEqualsToken,
    ts.SyntaxKind.LessThanLessThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    ts.SyntaxKind.AmpersandEqualsToken,
    ts.SyntaxKind.BarEqualsToken,
    ts.SyntaxKind.CaretEqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken,
]);
/**
 * Does `node` contain, anywhere (not crossing into a nested function-like scope — a separate
 * scope `foldTransformer` visits independently, with its own narrowed `shadowed` set), a bare
 * Identifier whose name is in `shadowed`? Gates the `tryEvaluate` (ts-evaluator) fallback in
 * `foldExpression` below: `tsEvalConst` resolves an Identifier through the `shadowed`/`consts`
 * pair passed to it (already correctly shadow-aware), but `tryEvaluate` delegates to
 * `ts-evaluator`'s OWN same-file identifier resolution — a third-party black box this file
 * does not control and cannot confirm respects LOCAL (parameter/`let`/`const`) shadowing at
 * all. Confirmed empirically that it does NOT: `const FLAG = true; function f(FLAG) { if
 * (FLAG) { ... } }` — `tsEvalConst` correctly fails closed on the shadowed `FLAG` read, but
 * `ts-evaluator`'s `evaluate()` still resolves it against the OUTER `const FLAG = true`,
 * silently pruning the `if` on the parameter's shadowing name instead of failing closed. So
 * whenever a shadowed name could be in play anywhere in the expression, this must decline the
 * ts-evaluator fallback entirely.
 */
function containsShadowedIdentifier(node, shadowed) {
    if (shadowed.size === 0)
        return false;
    if (ts.isIdentifier(node))
        return shadowed.has(node.text);
    let found = false;
    ts.forEachChild(node, (child) => {
        if (!found && containsShadowedIdentifier(child, shadowed))
            found = true;
    });
    return found;
}
/** Combines both evaluators: the reliable bigint path first, ts-evaluator as a fallback. */
function foldExpression(node, consts, functions, shadowed) {
    if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATOR_TOKENS.has(node.operatorToken.kind)) {
        return { success: false };
    }
    const hand = tsEvalConst(node, consts, functions, shadowed);
    if (hand !== undefined)
        return { success: true, value: hand };
    // A CallExpression is deliberately NEVER handed to the ts-evaluator fallback: folding a
    // call is governed entirely by `tsEvalCall`'s own hard-boundary eligibility rules above
    // (same-file, single-return, zero nested calls, constant args), and ts-evaluator's
    // no-checker `evaluate()` cannot resolve a function call at all today anyway (confirmed —
    // it fails closed on every call shape, not just the ones this evaluator declines) — but
    // relying on that behavior implicitly would silently change if a future ts-evaluator
    // version learned to interpret same-file calls itself, bypassing our eligibility checks
    // entirely. This mirrors the `ASSIGNMENT_OPERATOR_TOKENS` guard just above: fail closed by
    // construction, not by coincidence.
    if (ts.isCallExpression(node))
        return { success: false };
    // A shadowed name anywhere in the expression must decline this fallback outright — see
    // `containsShadowedIdentifier`'s own comment: `ts-evaluator`'s same-file identifier
    // resolution is confirmed to ignore local (parameter/`let`/`const`) shadowing entirely, so
    // handing it an expression containing one risks silently resolving against the WRONG (outer,
    // unrelated) top-level binding instead of failing closed like `tsEvalConst` already does.
    if (containsShadowedIdentifier(node, shadowed))
        return { success: false };
    return tryEvaluate(node);
}
/** A JS primitive foldable into a literal AST node (object/array/function/symbol/null/undefined are not). */
function toLiteralNode(value) {
    if (typeof value === 'boolean')
        return value ? ts.factory.createTrue() : ts.factory.createFalse();
    if (typeof value === 'string')
        return ts.factory.createStringLiteral(value);
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value < 0
            ? ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, ts.factory.createNumericLiteral(-value))
            : ts.factory.createNumericLiteral(value);
    }
    if (typeof value === 'bigint') {
        return value < 0n
            ? ts.factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, ts.factory.createBigIntLiteral(`${-value}n`))
            : ts.factory.createBigIntLiteral(`${value}n`);
    }
    return undefined;
}
/**
 * Node kinds safe to fold to a literal wherever they're found: none of these can ever be an
 * assignment target (an lvalue), so replacing one in place is always semantically safe —
 * unlike a bare Identifier, which might be the left side of an assignment or a declaration
 * name. A CallExpression is included here too — it's likewise never an lvalue — but actually
 * folds only for the narrow same-file/single-return/constant-args shape `tsEvalCall` accepts;
 * any other call (an unresolvable callee, `console.log(...)`, a multi-statement function,
 * etc.) simply fails `foldExpression` and is left exactly as found, same as always.
 */
function isFoldableValueExpression(node) {
    return (ts.isBinaryExpression(node) ||
        ts.isPrefixUnaryExpression(node) ||
        ts.isTemplateExpression(node) ||
        ts.isCallExpression(node));
}
// ── Loop unrolling: a "countable" `for` with a constant start/bound/step becomes N copies
// of its body, the counter substituted by its literal value each time. ──
/** `i++`/`i--`/`i += step`/`i -= step` on the counter → the signed per-iteration step. */
function extractStep(incrementor, loopVar, consts, functions, shadowed) {
    if (!incrementor)
        return undefined;
    if (ts.isPostfixUnaryExpression(incrementor) || ts.isPrefixUnaryExpression(incrementor)) {
        if (!ts.isIdentifier(incrementor.operand) || incrementor.operand.text !== loopVar)
            return undefined;
        if (incrementor.operator === ts.SyntaxKind.PlusPlusToken)
            return 1n;
        if (incrementor.operator === ts.SyntaxKind.MinusMinusToken)
            return -1n;
        return undefined;
    }
    if (ts.isBinaryExpression(incrementor) && ts.isIdentifier(incrementor.left) && incrementor.left.text === loopVar) {
        const op = incrementor.operatorToken.kind;
        if (op === ts.SyntaxKind.PlusEqualsToken || op === ts.SyntaxKind.MinusEqualsToken) {
            const rhs = tsEvalConst(incrementor.right, consts, functions, shadowed);
            if (rhs === undefined)
                return undefined;
            return op === ts.SyntaxKind.PlusEqualsToken ? rhs : -rhs;
        }
        // `i = i + step` / `i = i - step` (a plain reassignment, not `+=`/`-=`) — the RHS
        // itself must be `loopVar +/- <const>`; `i = <anything else>` isn't a countable step.
        if (op === ts.SyntaxKind.EqualsToken && ts.isBinaryExpression(incrementor.right)) {
            const rhsOp = incrementor.right.operatorToken.kind;
            if ((rhsOp === ts.SyntaxKind.PlusToken || rhsOp === ts.SyntaxKind.MinusToken) &&
                ts.isIdentifier(incrementor.right.left) &&
                incrementor.right.left.text === loopVar) {
                const step = tsEvalConst(incrementor.right.right, consts, functions, shadowed);
                if (step === undefined)
                    return undefined;
                return rhsOp === ts.SyntaxKind.PlusToken ? step : -step;
            }
        }
        return undefined;
    }
    return undefined;
}
/**
 * Conservative safety guard: bail out of unrolling if the body redeclares the counter name
 * (a nested `let`/`const`/param/catch-binding shadowing it — over-approximated, we don't
 * track scopes precisely, we just decline to unroll rather than risk a wrong substitution)
 * or contains a `break`/`continue`/`return` (control flow unrolling can't simply preserve).
 * Over-conservative by construction: it may decline to unroll a few loops that are
 * technically fine, but never unrolls one that isn't.
 */
function bodyBlocksUnrolling(node, loopVar) {
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node) || ts.isReturnStatement(node))
        return true;
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text === loopVar) {
        return true;
    }
    let blocked = false;
    ts.forEachChild(node, (child) => {
        if (!blocked && bodyBlocksUnrolling(child, loopVar))
            blocked = true;
    });
    return blocked;
}
/**
 * True if `statements` — the ALREADY-EXPANDED, flattened result of splicing one or more copies
 * of a loop body directly into the SAME enclosing statement list (unrolling doesn't give each
 * iteration its own `Block` scope — it substitutes the counter and splices the body's own
 * statements straight into the surrounding list, see `unrollCountingLoop`/
 * `tryUnrollForOfArrayTable` below) — declares the SAME name more than once via a direct
 * `let`/`const`/nested `function`, OR redeclares a name already reserved by an OUTER enclosing
 * scope (`outerNames`, e.g. a sibling `let` declared before the loop in the same block). Either
 * shape is invalid to actually emit: `ts.transpileModule`'s printer happily prints it as text,
 * but the very next stage (`acorn.parse`, inside `compile()`) rejects a duplicate lexical
 * declaration in one scope with a hard `SyntaxError: Identifier 'x' has already been declared`.
 *
 * This inspects the ACTUAL, already-expanded output — not the original per-iteration body in
 * isolation — so a loop body whose own declaration is fully CONSUMED/ELIDED by a further nested
 * unroll (e.g. the paired `while`-counting idiom, which elides its own counter declaration
 * entirely once unrolled) is correctly judged safe: nothing of that name survives to collide.
 * Only counting a name once it's ACTUALLY duplicated (or collides with something outside the
 * loop entirely) is what lets ordinary, already-tested unroll-cascades keep working, while still
 * catching the case that would otherwise crash: a body that declares its own per-iteration local
 * (e.g. `let doubled = i * 2n;`) that has nothing to consume it.
 */
function collidesWithSurroundingDeclarations(statements, outerNames) {
    const seen = new Set(outerNames);
    for (const stmt of statements) {
        const names = new Set();
        collectDirectlyDeclaredNames([stmt], names);
        for (const name of names) {
            if (seen.has(name))
                return true;
            seen.add(name);
        }
    }
    return false;
}
/** Replace every reference to `loopVar` in `node` with the literal `value`. */
function substituteCounter(node, loopVar, value, context) {
    const sub = (n) => ts.isIdentifier(n) && n.text === loopVar ? value : ts.visitEachChild(n, sub, context);
    return sub(node);
}
/** `decl.initializer` syntactically a BigIntLiteral (through a leading unary minus)? */
function looksBigInt(node) {
    return ts.isPrefixUnaryExpression(node) ? looksBigInt(node.operand) : ts.isBigIntLiteral(node);
}
function referencesIdentifier(node, name) {
    if (ts.isIdentifier(node) && node.text === name)
        return true;
    let found = false;
    ts.forEachChild(node, (child) => {
        if (!found && referencesIdentifier(child, name))
            found = true;
    });
    return found;
}
/**
 * The shared unroll core: given a resolved counter/bound/step/comparison and a body, expands
 * to N copies of the body with the counter substituted by its per-iteration literal — used by
 * both `for` (bounds come from its own init/condition/incrementor) and the `while` counting
 * idiom (bounds come from a preceding decl + the condition + the body's own last statement).
 */
function unrollCountingLoop(loopVar, start, cmp, bound, step, body, useBigInt, consts, functions, shadowed, context, visit) {
    const isLess = cmp === ts.SyntaxKind.LessThanToken || cmp === ts.SyntaxKind.LessThanEqualsToken;
    const isGreater = cmp === ts.SyntaxKind.GreaterThanToken || cmp === ts.SyntaxKind.GreaterThanEqualsToken;
    if (!isLess && !isGreater)
        return undefined;
    // Direction sanity: a forward (`i < / <= bound`) loop needs a positive step, a backward
    // one a negative step — the other pairing either never runs (fine, unrolls to nothing,
    // handled below) or genuinely never terminates. Bail on the latter rather than hang.
    if ((isLess && step < 0n) || (isGreater && step > 0n))
        return undefined;
    if (bodyBlocksUnrolling(body, loopVar))
        return undefined;
    const continues = (v) => {
        switch (cmp) {
            case ts.SyntaxKind.LessThanToken:
                return v < bound;
            case ts.SyntaxKind.LessThanEqualsToken:
                return v <= bound;
            case ts.SyntaxKind.GreaterThanToken:
                return v > bound;
            default:
                return v >= bound;
        }
    };
    const values = [];
    for (let v = start; continues(v); v += step) {
        if (values.length >= MAX_UNROLL_ITERATIONS)
            return undefined; // too large — leave it as real runtime code
        values.push(v);
    }
    const bodyStatements = ts.isBlock(body) ? body.statements : [body];
    const result = values.flatMap((v) => {
        const literal = toLiteralNode(useBigInt ? v : Number(v));
        const substituted = bodyStatements.map((s) => substituteCounter(s, loopVar, literal, context));
        return foldStatementList(substituted, consts, functions, shadowed, context, visit);
    });
    // A body that declares its OWN per-iteration local (e.g. `let doubled = i * 2n;`, an entirely
    // ordinary shape) would otherwise duplicate that declaration once per unrolled iteration,
    // directly in this SAME flattened list — invalid to emit (see
    // `collidesWithSurroundingDeclarations`'s own comment). Bail to the well-tested "not unrolled,
    // stays real runtime code" path rather than hand back output the next compile stage can't
    // even parse.
    return collidesWithSurroundingDeclarations(result, shadowed) ? undefined : result;
}
function tryUnrollForLoop(node, consts, functions, shadowed, context, visit) {
    const init = node.initializer;
    if (!init || !ts.isVariableDeclarationList(init) || init.declarations.length !== 1)
        return undefined;
    const decl = init.declarations[0];
    if (!ts.isIdentifier(decl.name) || !decl.initializer)
        return undefined;
    const loopVar = decl.name.text;
    const start = tsEvalConst(decl.initializer, consts, functions, shadowed);
    if (start === undefined)
        return undefined;
    const cond = node.condition;
    if (!cond || !ts.isBinaryExpression(cond) || !ts.isIdentifier(cond.left) || cond.left.text !== loopVar) {
        return undefined;
    }
    const bound = tsEvalConst(cond.right, consts, functions, shadowed);
    if (bound === undefined)
        return undefined;
    const step = extractStep(node.incrementor, loopVar, consts, functions, shadowed);
    if (step === undefined || step === 0n)
        return undefined;
    return unrollCountingLoop(loopVar, start, cond.operatorToken.kind, bound, step, node.statement, looksBigInt(decl.initializer), consts, functions, shadowed, context, visit);
}
/**
 * A `while` loop has no init/incrementor clauses of its own, so the countable idiom must be
 * spelled as a separate preceding counter declaration plus an increment as the body's own
 * last statement: `let i = <const>; while (i <cmp> bound) { ...; i++; }`. `rest` is every
 * statement AFTER the while in the same list — since eliding `prev` removes `loopVar` from
 * the enclosing scope entirely, this only fires when nothing after the loop still reads it
 * (a post-loop use of the counter, e.g. a "found index" pattern, must keep the loop as-is).
 */
function tryUnrollCountingWhile(prev, whileStmt, rest, consts, functions, shadowed, context, visit) {
    if (!ts.isVariableStatement(prev) || prev.declarationList.declarations.length !== 1)
        return undefined;
    const decl = prev.declarationList.declarations[0];
    if (!ts.isIdentifier(decl.name) || !decl.initializer)
        return undefined;
    const loopVar = decl.name.text;
    const start = tsEvalConst(decl.initializer, consts, functions, shadowed);
    if (start === undefined)
        return undefined;
    const cond = whileStmt.expression;
    if (!ts.isBinaryExpression(cond) || !ts.isIdentifier(cond.left) || cond.left.text !== loopVar)
        return undefined;
    const bound = tsEvalConst(cond.right, consts, functions, shadowed);
    if (bound === undefined)
        return undefined;
    const bodyStatements = whileStmt.statement
        ? ts.isBlock(whileStmt.statement)
            ? whileStmt.statement.statements
            : [whileStmt.statement]
        : [];
    const last = bodyStatements[bodyStatements.length - 1];
    if (!last || !ts.isExpressionStatement(last))
        return undefined;
    const step = extractStep(last.expression, loopVar, consts, functions, shadowed);
    if (step === undefined || step === 0n)
        return undefined;
    if (rest.some((s) => referencesIdentifier(s, loopVar)))
        return undefined;
    const innerBody = ts.factory.createBlock(bodyStatements.slice(0, -1), true); // exclude the consumed increment
    return unrollCountingLoop(loopVar, start, cond.operatorToken.kind, bound, step, innerBody, looksBigInt(decl.initializer), consts, functions, shadowed, context, visit);
}
/**
 * Visits a statement list, recognizing the `[counter decl, while (...) {...}]` pairing
 * before falling back to per-statement visiting — the natural place for this since eliding
 * the pair replaces TWO adjacent statements with N, which a single-node visitor can't express.
 */
function foldStatementList(statements, consts, functions, shadowed, context, visit) {
    const out = [];
    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const next = statements[i + 1];
        if (next && ts.isWhileStatement(next)) {
            const unrolled = tryUnrollCountingWhile(stmt, next, statements.slice(i + 2), consts, functions, shadowed, context, visit);
            if (unrolled) {
                out.push(...unrolled);
                i++; // consumed `next` (the while) too
                continue;
            }
        }
        const visited = visit(stmt, shadowed);
        if (Array.isArray(visited))
            out.push(...visited);
        else if (visited)
            out.push(visited);
    }
    return out;
}
/**
 * `foldTransformer`'s own scope tracking, mirroring `constPropagationTransformer`'s
 * (`isPlainFunctionScope`/`isMethodLikeScope`/`collectVarNames`/`collectBindingNames`/
 * `collectDirectlyDeclaredNames`, defined further below — reused as-is here; JS/TS function
 * hoisting means the declaration order in this file doesn't matter). Every scope-introducing
 * node grows a `shadowed` set of names reserved by SOMETHING between the current node and the
 * top level (a parameter, a nested function/let/const/var/catch-binding/for-loop-declaration
 * of the same name, …) — `tsEvalConst`'s Identifier case and `tsEvalCall`'s callee lookup
 * both consult this set before ever touching the top-level `consts`/`functions` maps, so a
 * shadowed name is never folded against the WRONG (top-level, unrelated) binding. Without
 * this, a nested function/parameter/block-scoped `let` sharing a name with a top-level
 * const or function would silently hijack every fold inside that scope to the outer
 * binding's value instead of the real (shadowing) one.
 */
function foldTransformer(consts, functions) {
    return (context) => {
        const visit = (node, shadowed) => {
            if (ts.isIfStatement(node)) {
                const evaluated = foldExpression(node.expression, consts, functions, shadowed);
                if (evaluated.success) {
                    const taken = Boolean(evaluated.value) ? node.thenStatement : node.elseStatement;
                    if (!taken)
                        return undefined;
                    // A taken Block replaces the IfStatement in a statement LIST (Block.statements /
                    // SourceFile.statements) — flatten its contents into that list (via foldStatementList,
                    // so a while-pairing inside the taken branch is still recognized) rather than nesting
                    // a bare Block, which the downstream SauceScript compiler's statement processor does
                    // not accept as a standalone statement. Since the Block's own contents are being
                    // flattened rather than visited via the `ts.isBlock` case below, its directly-declared
                    // names are computed here too (same as that case) so a `let`/`const`/nested `function`
                    // in the taken branch still shadows correctly once flattened.
                    if (ts.isBlock(taken)) {
                        const names = new Set(shadowed);
                        collectDirectlyDeclaredNames(taken.statements, names);
                        const result = foldStatementList(taken.statements, consts, functions, names, context, visit);
                        // A taken branch's OWN `let`/`const`/nested-`function` (an entirely ordinary
                        // shape — `if (true) { let x = 2n; ... }`) would otherwise duplicate an
                        // already-declared name once spliced directly into the SAME enclosing statement
                        // list (e.g. an outer `let x = 1n;` before this `if`) — invalid to emit, the
                        // identical root cause (splicing into an enclosing scope without checking for a
                        // collision) as the loop-unroll crash `collidesWithSurroundingDeclarations` was
                        // added for; reused here unchanged. Checked against the ORIGINAL outer `shadowed`
                        // (not the branch-extended `names`, which would trivially "collide" with itself).
                        // A collision bails to the well-tested "if stays real runtime code" path (falls
                        // through to the generic `ts.visitEachChild` below, which visits the Block via
                        // its own `ts.isBlock` case — a genuine nested scope, so no collision there)
                        // rather than handing back output the next compile stage can't even parse.
                        if (!collidesWithSurroundingDeclarations(result, shadowed))
                            return result;
                    }
                    else {
                        return visit(taken, shadowed);
                    }
                }
            }
            else if (ts.isConditionalExpression(node)) {
                const evaluated = foldExpression(node.condition, consts, functions, shadowed);
                if (evaluated.success) {
                    return visit(Boolean(evaluated.value) ? node.whenTrue : node.whenFalse, shadowed);
                }
            }
            else if (ts.isForStatement(node)) {
                const unrolled = tryUnrollForLoop(node, consts, functions, shadowed, context, visit);
                if (unrolled)
                    return unrolled;
                // Not unrolled (a non-constant/non-canonical bound, say) — the loop stays real
                // runtime code, but its own declared counter still shadows for the condition/
                // incrementor/body, same as any other scope-introducing node.
                const names = new Set(shadowed);
                if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
                    for (const decl of node.initializer.declarations)
                        collectBindingNames(decl.name, names);
                }
                return ts.factory.updateForStatement(node, node.initializer ? visit(node.initializer, names) : undefined, node.condition ? visit(node.condition, names) : undefined, node.incrementor ? visit(node.incrementor, names) : undefined, visit(node.statement, names));
            }
            else if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
                const names = new Set(shadowed);
                if (ts.isVariableDeclarationList(node.initializer)) {
                    for (const decl of node.initializer.declarations)
                        collectBindingNames(decl.name, names);
                }
                const visitedInit = visit(node.initializer, names);
                const visitedStmt = visit(node.statement, names);
                // The iterated/enumerated expression runs in the OUTER scope, before any iteration binds.
                const visitedExpr = visit(node.expression, shadowed);
                return ts.isForOfStatement(node)
                    ? ts.factory.updateForOfStatement(node, node.awaitModifier, visitedInit, visitedExpr, visitedStmt)
                    : ts.factory.updateForInStatement(node, visitedInit, visitedExpr, visitedStmt);
            }
            else if (ts.isBlock(node)) {
                const names = new Set(shadowed);
                collectDirectlyDeclaredNames(node.statements, names);
                return ts.factory.updateBlock(node, foldStatementList(node.statements, consts, functions, names, context, visit));
            }
            else if (ts.isCatchClause(node)) {
                const names = new Set(shadowed);
                if (node.variableDeclaration)
                    collectBindingNames(node.variableDeclaration.name, names);
                return ts.factory.updateCatchClause(node, node.variableDeclaration, visit(node.block, names));
            }
            else if (isPlainFunctionScope(node)) {
                const names = new Set(shadowed);
                for (const p of node.parameters)
                    collectBindingNames(p.name, names);
                if (node.body)
                    collectVarNames(node.body, names);
                // ALSO shadow every name `collectLexicalNamesInScope` finds anywhere in the body — not
                // just this function's own DIRECT declarations — since the real SauceScript compiler
                // shares scope across `if`/`while`/bare-block bodies (only a `for` loop pushes a genuine
                // new one; see `processor/statement.ts`'s `processIfStatement`/`processWhileStatement`,
                // neither of which calls `ctx.pushScope`, versus `processForStatement`, which does). A
                // name FIRST `let`/`const`-declared inside such a branch is therefore NOT block-scoped
                // away once the branch ends — without this, `tsEvalConst`/`foldExpression` could resolve
                // a read of it AFTER the branch against a same-named top-level const/function instead of
                // failing closed, exactly mirroring `constPropagationTransformer`'s own fix below (see
                // its matching comment) — this pass must agree with that one on what counts as shadowed.
                if (node.body)
                    collectLexicalNamesInScope(node.body, names);
                // A named function (declaration, or named function EXPRESSION) can reference itself.
                if (node.name)
                    names.add(node.name.text);
                return ts.visitEachChild(node, (child) => (child === node.name ? child : visit(child, names)), context);
            }
            else if (isMethodLikeScope(node)) {
                const names = new Set(shadowed);
                for (const p of node.parameters)
                    collectBindingNames(p.name, names);
                if (node.body)
                    collectVarNames(node.body, names);
                if (node.body)
                    collectLexicalNamesInScope(node.body, names); // see isPlainFunctionScope's note above
                return ts.visitEachChild(node, (child) => {
                    if (child === node.name) {
                        // A COMPUTED key genuinely reads whatever's inside, in the OUTER scope — a
                        // method/getter/setter can't reference its own (non-computed) key as a variable.
                        return ts.isComputedPropertyName(node.name)
                            ? ts.factory.updateComputedPropertyName(node.name, visit(node.name.expression, shadowed))
                            : node.name;
                    }
                    return visit(child, names);
                }, context);
            }
            else if (isFoldableValueExpression(node)) {
                const evaluated = foldExpression(node, consts, functions, shadowed);
                const literal = evaluated.success ? toLiteralNode(evaluated.value) : undefined;
                if (literal)
                    return literal;
            }
            return ts.visitEachChild(node, (child) => visit(child, shadowed), context);
        };
        return (sourceFile) => ts.factory.updateSourceFile(sourceFile, foldStatementList(sourceFile.statements, consts, functions, new Set(), context, visit));
    };
}
// ── Constant propagation to reads + dead-declaration elimination ──
//
// The fold pass above resolves every top-level `const`'s value into `consts` up front
// (`collectTopLevelConsts`) and already folds FOLDABLE initializer expressions in place
// (`const b = a + 3` becomes `const b = 4n`) — but it never touches a bare `Identifier`
// sitting in ordinary read position (`console.log(c)` stays `console.log(c)`), because a
// bare Identifier could just as easily be an lvalue, and `isFoldableValueExpression`
// deliberately excludes it (only Binary/PrefixUnary/TemplateExpression — none of which can
// ever be an assignment target — are folded wherever found). These two passes close that
// gap, running strictly AFTER fold+unroll, on ITS OUTPUT: a loop bound consumed by
// unrolling, or a condition consumed by branch-pruning, is already gone from the tree
// before either pass below ever looks for a reference to it.
//
// 1. `constPropagationTransformer` walks the (already folded/unrolled) tree and replaces
//    every unshadowed read of a top-level const name with its resolved literal.
// 2. `deadConstEliminationTransformer` then deletes any top-level `const` declaration left
//    with ZERO remaining `Identifier` occurrences of its name anywhere in the file.
//
// Both are scope-LOCAL to the SAME `consts` map the fold pass already trusts — same-file
// top-level `const`s only. `let`/`var`/reassignment chains are untouched by construction,
// not by a special guard: `collectTopLevelConsts` only ever records `NodeFlags.Const`
// declarations, so a `let`/`var` name is simply never a key in `consts`, and a bare
// Identifier that doesn't resolve in `consts` is always left exactly as found.
//
// Shadowing is tracked precisely enough to be safe without being a general dataflow engine:
// a nested `let`/`const`/`var`/function/parameter/catch-binding/for-loop-declaration with the
// SAME name reserves that name for its entire enclosing scope, matching real JS/TS semantics
// (a block-scoped name is reserved from the top of its scope, TDZ notwithstanding —
// referencing it before the declaration is a runtime error, never a silent fall-through to
// an outer binding of the same name) — so the WHOLE scope is computed once, up front, rather
// than incrementally per-statement. `var` is additionally hoisted to its enclosing FUNCTION
// (not block) scope, matching real `var` semantics, by a separate pre-scan that doesn't cross
// nested function/class boundaries. Only same-file top-level `const`s are ever tracked this
// way — no attempt is made to extend `consts` itself to nested-scope bindings (that stays out
// of scope, same as today).
/** Every Identifier bound by a (possibly nested/destructuring) binding name. */
function collectBindingNames(name, out) {
    if (ts.isIdentifier(name)) {
        out.add(name.text);
        return;
    }
    for (const element of name.elements) {
        if (ts.isBindingElement(element))
            collectBindingNames(element.name, out);
    }
}
/** The 3 function-DECLARATION/EXPRESSION scope shapes this narrow language surface actually
 * has — no classes, but object-literal method/getter/setter shorthand (see
 * `isMethodLikeScope` below) is still ordinary TS/JS syntax a `.sauce.ts` source can contain
 * (e.g. building a router struct argument), so it gets its own parallel scope check. */
function isPlainFunctionScope(node) {
    return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}
/**
 * The node kinds TypeScript uses for object-literal (and class) method/getter/setter
 * shorthand — a separate function-like-scope family from `isPlainFunctionScope`'s three
 * shapes, since none of `ts.isFunctionDeclaration`/`isFunctionExpression`/`isArrowFunction`
 * matches a `MethodDeclaration`/`GetAccessorDeclaration`/`SetAccessorDeclaration`. Classes are
 * already fully out of scope for this feature (`isOutOfScopeForPropagation` skips
 * `ts.isClassLike` outright, without descending), so in practice this only ever matters for
 * object-literal shorthand — but the scoping rules are identical either way: the parameter
 * list reserves each parameter's name for the whole method/getter/setter body, exactly like a
 * plain function.
 */
function isMethodLikeScope(node) {
    return ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
}
function isFunctionLikeScope(node) {
    return isPlainFunctionScope(node) || isMethodLikeScope(node);
}
/**
 * Every `var`-declared name reachable from `node` WITHOUT crossing into a nested function/
 * class boundary (those are separate `var` scopes of their own) — `var` is function-scoped,
 * not block-scoped, so a `var` declared inside a nested `if`/`for`/block still reserves its
 * name for the whole enclosing function, unlike `let`/`const`.
 */
function collectVarNames(node, out) {
    ts.forEachChild(node, (child) => {
        if (isPlainFunctionScope(child) || isMethodLikeScope(child) || ts.isClassLike(child))
            return; // a separate var-scope
        if (ts.isVariableStatement(child) && !(child.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let))) {
            for (const decl of child.declarationList.declarations)
                collectBindingNames(decl.name, out);
        }
        collectVarNames(child, out);
    });
}
/**
 * Every name a (possibly nested) LEXICAL declaration — `let`/`const`, a nested named
 * `function`, a `for`/`for-of`/`for-in` loop's own binding, a `catch` binding — introduces
 * anywhere reachable from `node` WITHOUT crossing into a nested function-like scope or class
 * (each of those is its own separate variable scope). Unlike `collectVarNames` (which only
 * hoists a `var`), this DELIBERATELY includes a name first declared inside a nested `if`/
 * `while`/bare-`{}` block: the real SauceScript compiler shares scope across those (only a
 * `for` loop pushes a genuine new one — see `processor/statement.ts`'s `processIfStatement`/
 * `processWhileStatement`, neither of which calls `ctx.pushScope`, versus
 * `processForStatement`, which does), so a `let`/`const` first declared inside such a branch is
 * NOT block-scoped away once the branch ends — it is the SAME persisting variable for the rest
 * of the function. A nested named `function` declaration is included for the identical
 * reason (and, separately, so a same-named top-level function is never wrongly resolved as the
 * callee of a call to this nested one — see `tsEvalCall`'s own `shadowed` check, consulted by
 * the local constant-propagation pass further down whenever it evaluates an expression via the
 * real `tsEvalConst`/`tsEvalBinary`/`tsEvalUnary` family). Over-including a name here (treating
 * it as reserved for the WHOLE function when a narrower, block-precise analysis might not have)
 * costs at most a missed optimization — an unresolved read simply defers to the real compiler's
 * own correct `getVar`-then-`getConstant`/function-lookup resolution — never a wrong fold.
 */
function collectLexicalNamesInScope(node, out) {
    if (ts.isFunctionDeclaration(node) && node.name)
        out.add(node.name.text); // record before treating as a nested scope below
    if (isFunctionLikeScope(node) || ts.isClassLike(node))
        return; // a separate scope — don't recurse into its own body
    if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations)
            collectBindingNames(decl.name, out);
    }
    else if (ts.isForStatement(node) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
        for (const decl of node.initializer.declarations)
            collectBindingNames(decl.name, out);
    }
    else if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) &&
        ts.isVariableDeclarationList(node.initializer)) {
        for (const decl of node.initializer.declarations)
            collectBindingNames(decl.name, out);
    }
    else if (ts.isCatchClause(node) && node.variableDeclaration) {
        collectBindingNames(node.variableDeclaration.name, out);
    }
    ts.forEachChild(node, (child) => collectLexicalNamesInScope(child, out));
}
/** Names a Block/statement-list declares DIRECTLY (not through a further-nested block/function). */
function collectDirectlyDeclaredNames(statements, out) {
    for (const stmt of statements) {
        if (ts.isVariableStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations)
                collectBindingNames(decl.name, out);
        }
        else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
            out.add(stmt.name.text);
        }
        else if (ts.isClassDeclaration(stmt) && stmt.name) {
            out.add(stmt.name.text);
        }
    }
}
/**
 * Node kinds that are entirely out of scope for this feature — real object/array DATA
 * processing, and TS-only declaration forms that hold no runtime value read anyway (types
 * are stripped later regardless of what this pass does to them). Left completely untouched
 * (not even recursed into): classes/enums/namespaces don't occur in this language surface
 * ("no closures/classes/async" per the compiler's own scope), and import/export specifiers
 * are pure name bindings, never a value read.
 */
function isOutOfScopeForPropagation(node) {
    return (ts.isTypeNode(node) ||
        ts.isTypeParameterDeclaration(node) ||
        ts.isClassLike(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isImportDeclaration(node) ||
        ts.isImportEqualsDeclaration(node) ||
        ts.isExportDeclaration(node) ||
        ts.isBreakStatement(node) ||
        ts.isContinueStatement(node));
}
/** Recurse into a (possibly nested/destructuring) binding NAME position — never a read. */
function substituteBindingName(name, shadowed, consts, context) {
    if (ts.isIdentifier(name))
        return name; // a binding target, never itself a read
    if (ts.isObjectBindingPattern(name)) {
        return ts.factory.updateObjectBindingPattern(name, name.elements.map((el) => substituteConstReads(el, shadowed, consts, context)));
    }
    return ts.factory.updateArrayBindingPattern(name, name.elements.map((el) => ts.isBindingElement(el) ? substituteConstReads(el, shadowed, consts, context) : el));
}
/**
 * Recurse into an ASSIGNMENT TARGET — the left side of `=`/a compound-assignment operator, or
 * a `++`/`--` operand — where TypeScript represents destructuring ASSIGNMENT (`({a} = obj)`,
 * `[a, b] = arr`) with the SAME node kinds as an ordinary object/array literal VALUE (only the
 * parse position, not the node kind, distinguishes a target from a value), so this can't reuse
 * the plain read-position visitor. A bare `Identifier` (the binding actually being written to)
 * is never substituted — that mirrors `substituteBindingName`'s "a binding target, never
 * itself a read" rule for real destructuring DECLARATIONS, just for the assignment-expression
 * shape instead. Everything nested inside that genuinely still a READ, evaluated in the outer
 * (pre-assignment) scope, IS substituted: a `PropertyAccessExpression`/`ElementAccessExpression`
 * target's object expression (and, for the latter, its computed key), a computed object-literal
 * property key, and any destructuring DEFAULT value (`{ a = 1 } = obj`, `[a = 1] = arr`).
 */
function visitAssignmentTarget(node, shadowed, consts, context) {
    const read = (n) => substituteConstReads(n, shadowed, consts, context);
    const target = (n) => visitAssignmentTarget(n, shadowed, consts, context);
    if (ts.isParenthesizedExpression(node)) {
        return ts.factory.updateParenthesizedExpression(node, target(node.expression));
    }
    if (ts.isIdentifier(node) || ts.isOmittedExpression(node))
        return node; // the write target itself, never a read
    if (ts.isPropertyAccessExpression(node)) {
        return ts.factory.updatePropertyAccessExpression(node, read(node.expression), node.name);
    }
    if (ts.isElementAccessExpression(node)) {
        return ts.factory.updateElementAccessExpression(node, read(node.expression), read(node.argumentExpression));
    }
    if (ts.isArrayLiteralExpression(node)) {
        // A destructuring-assignment array pattern (`[a, ...rest] = arr`) — each element (or the
        // rest target) recurses as a further assignment target, not a plain read.
        return ts.factory.updateArrayLiteralExpression(node, node.elements.map((el) => ts.isSpreadElement(el) ? ts.factory.updateSpreadElement(el, target(el.expression)) : target(el)));
    }
    if (ts.isObjectLiteralExpression(node)) {
        // A destructuring-assignment object pattern (`{ a, b: c, ...rest } = obj`).
        return ts.factory.updateObjectLiteralExpression(node, node.properties.map((prop) => {
            if (ts.isShorthandPropertyAssignment(prop)) {
                // `{ a }` as a target binds `a` — never a read; `{ a = 1 }`'s default IS a read,
                // evaluated in the outer (pre-assignment) scope.
                return prop.objectAssignmentInitializer
                    ? ts.factory.updateShorthandPropertyAssignment(prop, prop.name, read(prop.objectAssignmentInitializer))
                    : prop;
            }
            if (ts.isPropertyAssignment(prop)) {
                // `{ a: target }` — the key is a label (a COMPUTED key genuinely reads whatever's
                // inside), the value recurses as a further assignment target, not a plain read.
                const name = ts.isComputedPropertyName(prop.name)
                    ? ts.factory.updateComputedPropertyName(prop.name, read(prop.name.expression))
                    : prop.name;
                return ts.factory.updatePropertyAssignment(prop, name, target(prop.initializer));
            }
            if (ts.isSpreadAssignment(prop))
                return ts.factory.updateSpreadAssignment(prop, target(prop.expression));
            return prop;
        }));
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        // A default inside an ARRAY pattern (`[a = 1] = arr`) parses its element as a plain `=`
        // BinaryExpression (unlike an object pattern's dedicated `objectAssignmentInitializer`
        // slot) — the left is still the write target, the right is a genuine read.
        return ts.factory.updateBinaryExpression(node, target(node.left), node.operatorToken, read(node.right));
    }
    // Any other shape here isn't a real assignment target — leave it untouched rather than guess.
    return node;
}
/**
 * The substitution visitor: replaces every unshadowed read of a top-level const name with
 * its literal, threading a growing `shadowed` set down through every scope-introducing node.
 * Falls back to generic `ts.visitEachChild` recursion (under the SAME `shadowed` set) for any
 * node kind not specially handled — safe because the only slots that are ever NOT a value
 * read (declaration/binding names, property-access member names, non-computed object-literal
 * keys, and — see the assignment/update-operator cases below — an assignment's left-hand side
 * or an update expression's operand) are exactly the ones special-cased below.
 */
function substituteConstReads(node, shadowed, consts, context) {
    const visit = (n, s = shadowed) => substituteConstReads(n, s, consts, context);
    if (isOutOfScopeForPropagation(node))
        return node;
    if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATOR_TOKENS.has(node.operatorToken.kind)) {
        // `a = 1`, `a += 1`, `({a} = obj)`, `[a] = arr`, … — the left side (however deeply nested
        // a destructuring-assignment pattern it is) is a WRITE target, never a read, regardless of
        // which assignment operator is used (even `+=`/etc., which also reads the current value,
        // still can't have its target replaced by a literal — you can't assign into `1n`). Only
        // the right side is substituted as an ordinary read.
        return ts.factory.updateBinaryExpression(node, visitAssignmentTarget(node.left, shadowed, consts, context), node.operatorToken, visit(node.right));
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        // `a++`/`--a`/etc. — the operand is a write target (it's re-assigned), same rule as above.
        const operand = visitAssignmentTarget(node.operand, shadowed, consts, context);
        return ts.isPrefixUnaryExpression(node)
            ? ts.factory.updatePrefixUnaryExpression(node, operand)
            : ts.factory.updatePostfixUnaryExpression(node, operand);
    }
    if (ts.isIdentifier(node)) {
        if (shadowed.has(node.text))
            return node;
        const value = consts.get(node.text);
        if (value === undefined)
            return node;
        return toLiteralNode(value) ?? node;
    }
    if (ts.isPropertyAccessExpression(node)) {
        // `.name` (the member label after the dot) is never a variable reference.
        return ts.factory.updatePropertyAccessExpression(node, visit(node.expression), node.name);
    }
    if (ts.isElementAccessExpression(node)) {
        return ts.factory.updateElementAccessExpression(node, visit(node.expression), visit(node.argumentExpression));
    }
    if (ts.isShorthandPropertyAssignment(node)) {
        // `{ a }` — `a` is BOTH the object key and an implicit read of the variable `a`.
        // `objectAssignmentInitializer` only ever appears when this shorthand is itself a
        // DESTRUCTURING target (`({ a = 1 } = obj)`), not a value read — left alone (out of
        // scope, same as any other binding-pattern default).
        if (!node.objectAssignmentInitializer && !shadowed.has(node.name.text)) {
            const value = consts.get(node.name.text);
            const literal = value !== undefined ? toLiteralNode(value) : undefined;
            if (literal)
                return ts.factory.createPropertyAssignment(node.name, literal);
        }
        return node;
    }
    if (ts.isPropertyAssignment(node)) {
        // A non-computed key (`{ a: ... }`) is a label, not a read; a computed key
        // (`{ [a]: ... }`) genuinely reads `a`.
        const name = ts.isComputedPropertyName(node.name)
            ? ts.factory.updateComputedPropertyName(node.name, visit(node.name.expression))
            : node.name;
        return ts.factory.updatePropertyAssignment(node, name, visit(node.initializer));
    }
    if (ts.isVariableDeclaration(node)) {
        return ts.factory.updateVariableDeclaration(node, substituteBindingName(node.name, shadowed, consts, context), node.exclamationToken, node.type, node.initializer ? visit(node.initializer) : undefined);
    }
    if (ts.isBindingElement(node)) {
        return ts.factory.updateBindingElement(node, node.dotDotDotToken, node.propertyName, substituteBindingName(node.name, shadowed, consts, context), node.initializer ? visit(node.initializer) : undefined);
    }
    if (ts.isParameter(node)) {
        return ts.factory.updateParameterDeclaration(node, node.modifiers, node.dotDotDotToken, substituteBindingName(node.name, shadowed, consts, context), node.questionToken, node.type, node.initializer ? visit(node.initializer) : undefined);
    }
    if (ts.isCatchClause(node)) {
        const names = new Set(shadowed);
        if (node.variableDeclaration)
            collectBindingNames(node.variableDeclaration.name, names);
        return ts.factory.updateCatchClause(node, node.variableDeclaration, visit(node.block, names));
    }
    if (ts.isBlock(node)) {
        const names = new Set(shadowed);
        collectDirectlyDeclaredNames(node.statements, names);
        return ts.factory.updateBlock(node, node.statements.map((s) => visit(s, names)));
    }
    if (isPlainFunctionScope(node)) {
        const names = new Set(shadowed);
        for (const p of node.parameters)
            collectBindingNames(p.name, names);
        if (node.body)
            collectVarNames(node.body, names);
        // ALSO shadow every name `collectLexicalNamesInScope` finds anywhere in the body — not
        // just this function's own DIRECT declarations — since the real SauceScript compiler
        // shares scope across `if`/`while`/bare-block bodies (only a `for` loop pushes a genuine
        // new one; see `processor/statement.ts`'s `processIfStatement`/`processWhileStatement`,
        // neither of which calls `ctx.pushScope`, versus `processForStatement`, which does). A
        // name FIRST `let`/`const`-declared inside such a branch is therefore NOT block-scoped
        // away once the branch ends — it is the SAME persisting variable for the rest of the
        // function — so without this, a read of it AFTER the branch would wrongly fall through to
        // a same-named top-level const instead of staying an (unsubstituted) real runtime read:
        // `const FEE = 100n; function f(cond) { if (cond) { let FEE = 5n; } return FEE; }` must
        // stay `return FEE;`, never fold to `100n`.
        if (node.body)
            collectLexicalNamesInScope(node.body, names);
        // A named function (declaration, or named function EXPRESSION) can reference itself.
        if (node.name)
            names.add(node.name.text);
        const childVisitor = (child) => (child === node.name ? child : visit(child, names));
        return ts.visitEachChild(node, childVisitor, context);
    }
    if (isMethodLikeScope(node)) {
        const names = new Set(shadowed);
        for (const p of node.parameters)
            collectBindingNames(p.name, names);
        if (node.body)
            collectVarNames(node.body, names);
        if (node.body)
            collectLexicalNamesInScope(node.body, names); // see isPlainFunctionScope's note above
        // A non-computed key (`method(...)` / `get x()` / `set x(...)`) is a label, not a read —
        // unlike a named function EXPRESSION, a method/getter/setter can't reference its own key
        // as a variable, so (unlike isPlainFunctionScope above) there's no self-reference name to
        // add to `names`. A COMPUTED key (`[expr](...)`) genuinely reads whatever's inside, and
        // that expression runs in the OUTER scope — before the method's own parameter scope
        // exists — same as a computed object-literal property key (see isPropertyAssignment below).
        const childVisitor = (child) => {
            if (child === node.name) {
                return ts.isComputedPropertyName(node.name)
                    ? ts.factory.updateComputedPropertyName(node.name, visit(node.name.expression, shadowed))
                    : node.name;
            }
            return visit(child, names);
        };
        return ts.visitEachChild(node, childVisitor, context);
    }
    if (ts.isForStatement(node)) {
        const names = new Set(shadowed);
        if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
            for (const decl of node.initializer.declarations)
                collectBindingNames(decl.name, names);
        }
        return ts.factory.updateForStatement(node, node.initializer ? visit(node.initializer, names) : undefined, node.condition ? visit(node.condition, names) : undefined, node.incrementor ? visit(node.incrementor, names) : undefined, visit(node.statement, names));
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
        const names = new Set(shadowed);
        let visitedInit;
        if (ts.isVariableDeclarationList(node.initializer)) {
            for (const decl of node.initializer.declarations)
                collectBindingNames(decl.name, names);
            visitedInit = visit(node.initializer, names);
        }
        else {
            // Reusing an EXISTING binding as the loop target (`for (x of arr)`, `for (x in obj)`, or a
            // destructuring reuse `for ([x, y] of pairs)`/`for ({val: x} of arr)`) is a genuine WRITE
            // on every iteration, never a read — route it through the same assignment-target visitor
            // every other write shape in this file already uses, instead of treating it as an ordinary
            // read position (which would let a tracked const/effectively-const name get substituted
            // into the loop's own binding target).
            visitedInit = visitAssignmentTarget(node.initializer, names, consts, context);
        }
        const visitedStmt = visit(node.statement, names);
        // The iterated/enumerated expression is evaluated in the OUTER scope — it can never see
        // the loop's own declaration, regardless of TDZ (it runs once, before any iteration binds).
        const visitedExpr = visit(node.expression, shadowed);
        return ts.isForOfStatement(node)
            ? ts.factory.updateForOfStatement(node, node.awaitModifier, visitedInit, visitedExpr, visitedStmt)
            : ts.factory.updateForInStatement(node, visitedInit, visitedExpr, visitedStmt);
    }
    if (ts.isLabeledStatement(node)) {
        return ts.factory.updateLabeledStatement(node, node.label, visit(node.statement));
    }
    return ts.visitEachChild(node, (child) => visit(child), context);
}
// ── Effectively-const `let`/`var` detection (top-level scope only) ──
//
// A top-level `let`/`var` that is WRITTEN EXACTLY ONCE across its entire (shadow-respecting)
// visible scope is semantically indistinguishable from a `const` — nothing downstream can ever
// observe a second value, so folding it into the exact same `consts` map real top-level
// `const`s already use is just as sound (the standard "effectively final" analysis — the same
// rule Java applies to lambda capture). Two shapes are recognized, both scoped to TOP-LEVEL
// declarations only (the identical scope boundary real `const` tracking already uses — a
// function-local/nested-scope `let` is out of scope here, same as before):
//
//  1. PRIMARY — `let x = <init>;` (or `var`) where `x` is never written again anywhere in the
//     file. Handled by `analyzeTopLevelConsts` below in exactly the same pass, and exactly the
//     same way, as a real top-level `const` — added to `consts`, later eliminated by
//     `deadConstEliminationTransformer` once every read has been substituted away.
//  2. STRETCH — the two-statement idiom `let x; x = <init>;` (a bare predeclaration —
//     `NodeFlags.Let`/`Var`, no initializer — immediately... not necessarily ADJACENT, but
//     both statements are direct, unconditional members of the SAME top-level statement list,
//     e.g. the multi-declarator `let a, b, c;` followed by three separate later top-level
//     assignments). Recognized ONLY when the declaration and its sole assignment are both
//     direct `sourceFile.statements` entries (never nested inside an `if`/`for`/`while`/
//     function/block) — a conditional or nested assignment is never even considered, let alone
//     folded. This is a genuinely new kind of elimination: it removes a STATEMENT PAIR (the
//     predeclaration's now-empty declarator + its one assignment statement), not a single
//     declarator — handled by `deadConstEliminationTransformer` alongside (but structurally
//     distinct from) the existing single-declaration removal.
//
// CRITICAL SOUNDNESS RULE: "written exactly once/never again" is a flat SYNTACTIC count of
// every assignment/compound-assignment/update-expression/destructuring-assignment target
// anywhere in the file that resolves (respecting lexical shadowing) to that top-level binding —
// NOT a reachability analysis. A second write inside an `if`/loop/function that might never
// execute at runtime still counts and still disqualifies the name; this is the conservative,
// sound rule the task requires (a syntactic "does ANY write exist" check), mirroring how the
// existing scope-shadowing analysis above is already computed once, up front, per scope.
//
// Interaction with the existing while-loop-unroll pairing (`foldStatementList` /
// `tryUnrollCountingWhile`, which ALSO recognizes an adjacent `[counter decl, while] `
// statement pair): a genuine loop counter is, by construction, written again inside the loop
// body (its own increment) — so PRIMARY's "zero further writes" check always disqualifies it
// before it can ever reach `consts`, regardless of whether the counter is declared with or
// without an initializer. STRETCH only ever matches a NO-initializer predeclaration, which
// `tryUnrollCountingWhile`'s `prev` shape never accepts anyway (it requires `decl.initializer`).
// And since `consts` here is fully precomputed ONCE, before `foldTransformer` (and therefore the
// while-unroll pass) ever runs, there is no ordering race between the two mechanisms — a name
// can only ever be claimed by one of them, decided purely by whether it's ever written again.
/**
 * Every bare-Identifier WRITE TARGET reachable from a (possibly nested/destructuring)
 * assignment-target expression — the same recursive shape `visitAssignmentTarget` above already
 * walks (a destructuring-assignment pattern reuses ordinary object/array-literal node kinds), but
 * this COLLECTS rather than substitutes: reports every leaf Identifier actually being written to.
 * A `PropertyAccessExpression`/`ElementAccessExpression` target (`obj.x = …`) writes a PROPERTY
 * of `obj`, never the variable `obj` itself — mirroring `visitAssignmentTarget`'s treatment of
 * that position as a nested READ (irrelevant here: a read is never a write).
 */
function collectAssignmentTargetIdentifiers(node, report) {
    if (ts.isParenthesizedExpression(node)) {
        collectAssignmentTargetIdentifiers(node.expression, report);
        return;
    }
    if (ts.isIdentifier(node)) {
        report(node.text);
        return;
    }
    if (ts.isOmittedExpression(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        return; // a property write, or a hole in an array pattern — never a variable write
    }
    if (ts.isArrayLiteralExpression(node)) {
        for (const el of node.elements) {
            collectAssignmentTargetIdentifiers(ts.isSpreadElement(el) ? el.expression : el, report);
        }
        return;
    }
    if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) {
            if (ts.isShorthandPropertyAssignment(prop))
                report(prop.name.text); // `{ a }` as a target writes `a`
            else if (ts.isPropertyAssignment(prop))
                collectAssignmentTargetIdentifiers(prop.initializer, report);
            else if (ts.isSpreadAssignment(prop))
                collectAssignmentTargetIdentifiers(prop.expression, report);
        }
        return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        // A destructuring default (`[a = 1] = arr`) — the LEFT is still the real target.
        collectAssignmentTargetIdentifiers(node.left, report);
    }
}
/**
 * For every name in `candidateNames`, how many times it is WRITTEN to (assignment target,
 * compound-assignment target, or `++`/`--` operand) anywhere in `root` — respecting the SAME
 * lexical-shadowing rules `substituteConstReads` already applies (a nested re-declaration of the
 * same name reserves it for that inner scope, so a write inside a shadowing scope doesn't count
 * against the outer binding of the same spelling). This mirrors `substituteConstReads`'s own
 * scope-threading shape (Block/CatchClause/ForStatement/ForIn/ForOf/plain-function/method-like)
 * exactly, but COUNTS instead of substituting — see the module comment above for why a flat
 * syntactic count (not reachability) is the correct, conservative rule here.
 */
function collectWriteCounts(root, candidateNames) {
    const counts = new Map();
    const bump = (name) => {
        if (!candidateNames.has(name))
            return;
        counts.set(name, (counts.get(name) ?? 0) + 1);
    };
    const reportIfUnshadowed = (shadowed) => (name) => {
        if (!shadowed.has(name))
            bump(name);
    };
    const visit = (node, shadowed) => {
        if (isOutOfScopeForPropagation(node))
            return;
        if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATOR_TOKENS.has(node.operatorToken.kind)) {
            collectAssignmentTargetIdentifiers(node.left, reportIfUnshadowed(shadowed));
            visit(node.right, shadowed);
            return;
        }
        if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
            (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
            collectAssignmentTargetIdentifiers(node.operand, reportIfUnshadowed(shadowed));
            return;
        }
        if (ts.isCatchClause(node)) {
            const names = new Set(shadowed);
            if (node.variableDeclaration)
                collectBindingNames(node.variableDeclaration.name, names);
            visit(node.block, names);
            return;
        }
        if (ts.isBlock(node)) {
            const names = new Set(shadowed);
            collectDirectlyDeclaredNames(node.statements, names);
            for (const s of node.statements)
                visit(s, names);
            return;
        }
        if (isPlainFunctionScope(node)) {
            const names = new Set(shadowed);
            for (const p of node.parameters)
                collectBindingNames(p.name, names);
            if (node.body)
                collectVarNames(node.body, names);
            // See foldTransformer's isPlainFunctionScope note: a name FIRST let/const-declared
            // inside a nested if/while/bare-block shadows for the REST of the function too. This
            // only ever REMOVES a false-positive write attribution here (a write to a locally-
            // shadowing name of the same text was previously miscounted as a write to the top-level
            // binding); it can only lower a reported write count, matching the REAL count of writes
            // that actually reach the top-level variable, so this fix can only newly (and correctly)
            // qualify a name as effectively-const, never disqualify one that genuinely is.
            if (node.body)
                collectLexicalNamesInScope(node.body, names);
            if (node.name)
                names.add(node.name.text);
            ts.forEachChild(node, (child) => {
                if (child !== node.name)
                    visit(child, names);
            });
            return;
        }
        if (isMethodLikeScope(node)) {
            const names = new Set(shadowed);
            for (const p of node.parameters)
                collectBindingNames(p.name, names);
            if (node.body)
                collectVarNames(node.body, names);
            if (node.body)
                collectLexicalNamesInScope(node.body, names); // see isPlainFunctionScope's note above
            ts.forEachChild(node, (child) => visit(child, child === node.name ? shadowed : names));
            return;
        }
        if (ts.isForStatement(node)) {
            const names = new Set(shadowed);
            if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
                for (const decl of node.initializer.declarations)
                    collectBindingNames(decl.name, names);
            }
            if (node.initializer)
                visit(node.initializer, names);
            if (node.condition)
                visit(node.condition, names);
            if (node.incrementor)
                visit(node.incrementor, names);
            visit(node.statement, names);
            return;
        }
        if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
            const names = new Set(shadowed);
            if (ts.isVariableDeclarationList(node.initializer)) {
                for (const decl of node.initializer.declarations)
                    collectBindingNames(decl.name, names);
            }
            else {
                // Reusing an EXISTING top-level `let`/`var` as the loop target (`for (x of arr)`,
                // `for (x in obj)`, or a destructuring reuse `for ([x, y] of pairs)`/`for ({val: x} of
                // arr)`) is a genuine WRITE on every iteration — route it through the same
                // assignment-target collector every other write shape in this file already uses, so it
                // counts as (at least) a second write and can never be folded as effectively-const.
                collectAssignmentTargetIdentifiers(node.initializer, reportIfUnshadowed(shadowed));
            }
            visit(node.initializer, names);
            visit(node.statement, names);
            visit(node.expression, shadowed); // the iterated/enumerated expression runs in the OUTER scope
            return;
        }
        ts.forEachChild(node, (child) => visit(child, shadowed));
    };
    visit(root, new Set());
    return counts;
}
/** Every top-level `let`/`var` declared name (never `const`) — the candidate universe for
 * effectively-const detection, matching the same top-level-only scope boundary real `const`
 * tracking already uses. */
function collectTopLevelMutableNames(sourceFile) {
    const names = new Set();
    for (const stmt of sourceFile.statements) {
        if (!ts.isVariableStatement(stmt))
            continue;
        if (stmt.declarationList.flags & ts.NodeFlags.Const)
            continue;
        for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name))
                names.add(decl.name.text);
        }
    }
    return names;
}
/** If `stmt` is exactly a bare `name = <expr>;` ExpressionStatement, its target `name` —
 * otherwise `undefined`. Used only to recognize a STRETCH pair's resolving assignment. */
function simpleAssignmentTargetName(stmt) {
    if (!ts.isExpressionStatement(stmt))
        return undefined;
    const expr = stmt.expression;
    if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
        return undefined;
    return ts.isIdentifier(expr.left) ? expr.left.text : undefined;
}
function analyzeTopLevelConsts(sourceFile, functions) {
    const consts = new Map();
    const primaryNames = new Set();
    const pairNames = new Set();
    const mutableNames = collectTopLevelMutableNames(sourceFile);
    const writeCounts = collectWriteCounts(sourceFile, mutableNames);
    // Names predeclared (no initializer) by a top-level `let`/`var` not yet resolved, awaiting
    // their sole later top-level assignment statement — the STRETCH idiom in progress. Tracked
    // as a plain Set here (not a statement reference): once matched, all this local pass needs
    // is "yes, a predeclaration for this name exists earlier in the file".
    const pendingPredecl = new Set();
    for (const stmt of sourceFile.statements) {
        // STRETCH soundness: `let x;` genuinely makes `x` readable (as `undefined`) from that point
        // forward — a real value, distinct from whatever `x` is later assigned. Any statement OTHER
        // than a pending name's own resolving assignment that references it is therefore a read of
        // that still-unassigned state; folding the name would let `constPropagationTransformer`
        // (which substitutes every unshadowed read file-wide, with no notion of statement order)
        // silently replace that read with the FUTURE value. Poison (permanently disqualify) any
        // pending name referenced by any statement that isn't its own resolving assignment — this
        // also covers a pending name read from inside another statement's initializer/expression
        // (e.g. `let x; let y = x + 1; x = 5;`), which would otherwise let `foldTransformer` (using
        // the final, order-blind `consts` map) fold `y`'s initializer using `x`'s eventual value.
        const resolvingName = simpleAssignmentTargetName(stmt);
        if (pendingPredecl.size > 0) {
            for (const name of [...pendingPredecl]) {
                if (name !== resolvingName && referencesIdentifier(stmt, name))
                    pendingPredecl.delete(name);
            }
        }
        if (ts.isVariableStatement(stmt)) {
            const isConst = Boolean(stmt.declarationList.flags & ts.NodeFlags.Const);
            for (const decl of stmt.declarationList.declarations) {
                if (!ts.isIdentifier(decl.name))
                    continue;
                const name = decl.name.text;
                if (isConst) {
                    if (!decl.initializer)
                        continue;
                    const value = tsEvalConst(decl.initializer, consts, functions, EMPTY_SHADOW);
                    if (value !== undefined)
                        consts.set(name, value);
                    continue;
                }
                if (decl.initializer) {
                    if ((writeCounts.get(name) ?? 0) > 0)
                        continue; // written again somewhere — not effectively const
                    const value = tsEvalConst(decl.initializer, consts, functions, EMPTY_SHADOW);
                    if (value === undefined)
                        continue;
                    consts.set(name, value);
                    primaryNames.add(name);
                }
                else {
                    pendingPredecl.add(name); // no initializer: only a STRETCH candidate
                }
            }
            continue;
        }
        if (!ts.isExpressionStatement(stmt))
            continue;
        const expr = stmt.expression;
        if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
            continue;
        if (!ts.isIdentifier(expr.left))
            continue;
        const name = expr.left.text;
        if (!pendingPredecl.has(name))
            continue;
        pendingPredecl.delete(name); // this IS the name's one recognized write, resolvable or not
        if (writeCounts.get(name) !== 1)
            continue; // a write exists elsewhere too — not sound to fold
        const value = tsEvalConst(expr.right, consts, functions, EMPTY_SHADOW);
        if (value === undefined)
            continue;
        consts.set(name, value);
        pairNames.add(name);
    }
    return { consts, primaryNames, pairNames };
}
/**
 * Structurally RE-DERIVES, from whatever tree currently holds it, a STRETCH pair name's two
 * statements (the no-initializer predeclaration + its sole top-level assignment) and their
 * non-read name nodes — the same shape `analyzeTopLevelConsts` itself matched, just re-applied
 * fresh. Never relies on a node reference carried in from elsewhere: by the time
 * `deadConstEliminationTransformer` runs, `foldTransformer`/`constPropagationTransformer` have
 * already rebuilt at least the assignment statement for any pair whose RHS was itself foldable
 * (e.g. `b = a + 3` → `b = 4n`), so a node identity captured any earlier would already be stale.
 */
function findPairStatements(sourceFile, name) {
    let declStatement;
    let declName;
    let assignStatement;
    let assignTargetName;
    for (const stmt of sourceFile.statements) {
        if (ts.isVariableStatement(stmt) && !(stmt.declarationList.flags & ts.NodeFlags.Const)) {
            for (const decl of stmt.declarationList.declarations) {
                if (ts.isIdentifier(decl.name) && decl.name.text === name && !decl.initializer) {
                    declStatement = stmt;
                    declName = decl.name;
                }
            }
        }
        else if (ts.isExpressionStatement(stmt)) {
            const expr = stmt.expression;
            if (ts.isBinaryExpression(expr) &&
                expr.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isIdentifier(expr.left) &&
                expr.left.text === name) {
                assignStatement = stmt;
                assignTargetName = expr.left;
            }
        }
    }
    if (!declStatement || !declName || !assignStatement || !assignTargetName)
        return undefined;
    return { declStatement, declName, assignStatement, assignTargetName };
}
function constPropagationTransformer(consts) {
    return (context) => {
        return (sourceFile) => {
            const statements = sourceFile.statements.map((stmt) => substituteConstReads(stmt, new Set(), consts, context));
            return ts.factory.updateSourceFile(sourceFile, statements);
        };
    };
}
/**
 * How many `Identifier`s named `name` occur in `root`, ignoring any node in `exclude` — and
 * ignoring LABEL positions the same way `substituteConstReads` itself already does (a
 * non-computed `PropertyAssignment`/`ShorthandPropertyAssignment` key is never a variable
 * read), so a struct-literal shorthand read that pass already substituted away (`{ a }` →
 * `{ a: <literal> }`, reusing the original `a` Identifier as the new key) doesn't count as a
 * phantom "still referenced" use of the const whose value was just inlined there. A surviving
 * (not-rewritten) `ShorthandPropertyAssignment` can never itself be a genuine unshadowed read
 * of a tracked top-level const either — if it were, `constPropagationTransformer` would
 * already have converted it — so its key is excluded too; only a destructuring default
 * (`objectAssignmentInitializer`) is still walked, since that IS a real read. `exclude` is a
 * SET (not a single node) because the STRETCH two-statement idiom has TWO non-read occurrences
 * to ignore — the predeclaration's own name AND the sole assignment's LHS target — where a
 * real `const`/PRIMARY `let` only ever has the one declarator name.
 */
function countIdentifierRefs(root, name, exclude) {
    let count = 0;
    const walk = (node) => {
        if (exclude.has(node))
            return;
        if (ts.isIdentifier(node) && node.text === name) {
            count++;
            return;
        }
        if (ts.isPropertyAssignment(node)) {
            if (ts.isComputedPropertyName(node.name))
                walk(node.name);
            walk(node.initializer);
            return;
        }
        if (ts.isShorthandPropertyAssignment(node)) {
            if (node.objectAssignmentInitializer)
                walk(node.objectAssignmentInitializer);
            return;
        }
        ts.forEachChild(node, walk);
    };
    walk(root);
    return count;
}
/** Every array element must itself resolve via `tsEvalConst` — no spreads, no nested tables. */
function foldArrayLiteralElements(lit, consts, functions) {
    const out = [];
    for (const el of lit.elements) {
        if (ts.isSpreadElement(el) || ts.isArrayLiteralExpression(el) || ts.isObjectLiteralExpression(el))
            return undefined;
        const value = tsEvalConst(el, consts, functions, EMPTY_SHADOW);
        if (value === undefined)
            return undefined;
        out.push(value);
    }
    return out;
}
/**
 * Every property must be a plain (non-computed) `key: value` / `"key": value` assignment whose
 * value itself resolves via `tsEvalConst` — no shorthand/spread/method/getter/setter, no computed
 * keys, no nested tables.
 */
function foldObjectLiteralProps(lit, consts, functions) {
    const out = new Map();
    for (const prop of lit.properties) {
        if (!ts.isPropertyAssignment(prop) || ts.isComputedPropertyName(prop.name))
            return undefined;
        if (ts.isArrayLiteralExpression(prop.initializer) || ts.isObjectLiteralExpression(prop.initializer))
            return undefined;
        const key = ts.isIdentifier(prop.name)
            ? prop.name.text
            : ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name)
                ? prop.name.text
                : undefined;
        if (key === undefined)
            return undefined;
        const value = tsEvalConst(prop.initializer, consts, functions, EMPTY_SHADOW);
        if (value === undefined)
            return undefined;
        out.set(key, value);
    }
    return out;
}
/**
 * The OUTERMOST node representing the same logical value as `node` — `node` itself, or (if
 * `node` sits directly inside one or more `(parens)`) the outermost of those wrapping
 * `ParenthesizedExpression`s. Needed because an AST parent field (`BinaryExpression.left`,
 * `CallExpression.expression`, a `PropertyAssignment.initializer`, ...) points at whatever its
 * DIRECT child is — for `(ARR.foo)++`, the `PostfixUnaryExpression`'s `.operand` is the
 * `ParenthesizedExpression`, NOT the inner `PropertyAccessExpression` — so comparing a field
 * against `node` directly would silently miss a parenthesized write/call target. Every
 * `isTableAccessUnsafeUsage` field-identity check below compares against THIS, not the raw node.
 */
function outermostParenWrapper(node) {
    let current = node;
    while (current.parent && ts.isParenthesizedExpression(current.parent))
        current = current.parent;
    return current;
}
/**
 * True if `access` (a `NAME.prop`/`NAME[k]` access already known to have `NAME` as its base) sits
 * anywhere a WRITE or a CALL could happen: a call/new callee, a `delete` operand, an update
 * (`++`/`--`) operand, a plain/compound-assignment target, or — climbing up through the
 * object/array-literal "pattern" node shapes TypeScript reuses for destructuring assignment —
 * nested (however deeply) inside a pattern that is itself the target of `=` or a for-of/for-in
 * loop's per-iteration binding. The climb is what catches `({ k: NAME.x } = obj)` / `[NAME.x] =
 * arr`: a destructuring-assignment pattern parses with the exact same node kinds as an ordinary
 * object/array-literal VALUE, so only the OUTERMOST wrapper (an assignment's left side, or a
 * for-of/for-in binding) tells a target apart from a read — a single immediate-parent check
 * would miss it. Every step re-wraps through `outermostParenWrapper` so an arbitrarily
 * parenthesized target (`(ARR.foo)++`, `({ x: (ARR.y) } = obj)`, ...) is still caught.
 */
function isTableAccessUnsafeUsage(access) {
    const wrapped = outermostParenWrapper(access);
    const immediateParent = wrapped.parent;
    if (immediateParent && ts.isCallExpression(immediateParent) && immediateParent.expression === wrapped)
        return true;
    if (immediateParent && ts.isNewExpression(immediateParent) && immediateParent.expression === wrapped)
        return true;
    if (immediateParent && ts.isDeleteExpression(immediateParent) && immediateParent.expression === wrapped)
        return true;
    if (immediateParent &&
        (ts.isPrefixUnaryExpression(immediateParent) || ts.isPostfixUnaryExpression(immediateParent)) &&
        (immediateParent.operator === ts.SyntaxKind.PlusPlusToken ||
            immediateParent.operator === ts.SyntaxKind.MinusMinusToken) &&
        immediateParent.operand === wrapped) {
        return true;
    }
    let current = access;
    for (;;) {
        const w = outermostParenWrapper(current);
        const parent = w.parent;
        if (!parent)
            return false;
        if (ts.isBinaryExpression(parent) &&
            parent.left === w &&
            ASSIGNMENT_OPERATOR_TOKENS.has(parent.operatorToken.kind)) {
            return true;
        }
        if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === w)
            return true;
        if (ts.isPropertyAssignment(parent) && parent.initializer === w) {
            current = parent;
            continue;
        }
        if ((ts.isSpreadAssignment(parent) || ts.isSpreadElement(parent)) && parent.expression === w) {
            current = parent;
            continue;
        }
        if (ts.isArrayLiteralExpression(parent) || ts.isObjectLiteralExpression(parent)) {
            current = parent;
            continue;
        }
        return false;
    }
}
/**
 * True if the Identifier `id` (already known to be an unshadowed reference to a tracked table
 * name) is used in the ONE safe shape this feature ever folds: immediately the base of a
 * property/element access that is not itself a write/call target. Anything else — a bare
 * argument, an alias, a return, a spread, the table's own name being reassigned/updated, a
 * method call, an element/property WRITE — falls through to `false`. This is an ALLOWLIST (only
 * the recognized-safe shape passes), not a blocklist, so an unrecognized shape fails closed.
 */
function isSafeTableRead(id) {
    const parent = id.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === id)
        return !isTableAccessUnsafeUsage(parent);
    if (ts.isElementAccessExpression(parent) && parent.expression === id)
        return !isTableAccessUnsafeUsage(parent);
    return false;
}
/**
 * `id` is the (unshadowed) iterated-expression identifier of a `for (x of id) {...}` loop — a
 * safe, read-only, non-aliasing use for an ARRAY table specifically (`kind` is checked by the
 * caller): its elements are bigints, primitive values with no aliasing/mutation risk, so
 * iterating them can never itself escape or mutate the array, regardless of whether the STRETCH
 * for-of UNROLL below can actually unroll this particular loop shape — an unrollable-shape
 * failure just leaves the loop as real runtime code, iterating the (still fully tracked, still
 * correctly-folded-elsewhere) array unchanged. A `for await...of` is excluded out of caution
 * (this narrow language surface has no async, but fail closed regardless).
 */
function isForOfIterableExpression(id) {
    const parent = id.parent;
    return ts.isForOfStatement(parent) && parent.expression === id && !parent.awaitModifier;
}
/**
 * Whole-file, shadow-aware safety scan for the tracked table `name` (of table-kind `kind`):
 * returns `false` the moment ANY occurrence of the (unshadowed) identifier isn't a safe read
 * (`isSafeTableRead`) or — for an array table only — a safe for-of iteration
 * (`isForOfIterableExpression`) — a single disqualifying use anywhere (reachable or not) rules
 * out the whole table. `exclude` is the declaration's own name node (a binding, never itself a
 * "use"). Shadowing is tracked with the EXACT same rules as `substituteConstReads` (reusing its
 * own helper functions), so a same-named inner declaration's occurrences are skipped entirely —
 * they refer to a different binding, not this table, and neither disqualify it nor participate
 * in `checkTableSafety`'s scan.
 *
 * Deliberately does NOT reuse `isOutOfScopeForPropagation`'s blanket "class/enum/module → skip
 * entirely, don't even descend" for THIS scan: that skip is sound for scalar constant
 * propagation (a const's *value* can't be mutated from inside one of these without illegally
 * reassigning the binding itself, already a hard error) but not for a tracked ARRAY/OBJECT
 * table — a class method, or a namespace function, can legally call a mutating method on (or
 * write through) an outer const table without ever reassigning the table's own binding, and
 * that occurrence must not be invisible to this scan. These node kinds aren't part of the
 * supported base language surface ("no closures/classes/async"), and a real class/namespace
 * anywhere in a source is independently rejected before `compile()` ever reaches this feature's
 * output — but `tsPartialEval` is itself a separately exported function, so this fails closed
 * on its own rather than leaning on that upstream gate: encountering one of these node kinds
 * disqualifies the table outright the moment the tracked name occurs ANYWHERE inside it (not a
 * "safe read" recheck — this scanner doesn't attempt to precisely re-derive scoping/aliasing
 * inside a node shape it otherwise never has to reason about, so it conservatively treats any
 * textual occurrence as disqualifying rather than risk missing a real one).
 */
function checkTableSafety(node, name, kind, shadowed, exclude) {
    if (node === exclude)
        return true;
    if (ts.isClassLike(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) {
        return !referencesIdentifier(node, name);
    }
    if (isOutOfScopeForPropagation(node))
        return true;
    if (ts.isIdentifier(node) && node.text === name) {
        if (shadowed.has(name))
            return true;
        return isSafeTableRead(node) || (kind === 'array' && isForOfIterableExpression(node));
    }
    if (ts.isBlock(node)) {
        const names = new Set(shadowed);
        collectDirectlyDeclaredNames(node.statements, names);
        return node.statements.every((s) => checkTableSafety(s, name, kind, names, exclude));
    }
    if (isPlainFunctionScope(node)) {
        const names = new Set(shadowed);
        for (const p of node.parameters)
            collectBindingNames(p.name, names);
        if (node.body)
            collectVarNames(node.body, names);
        // See foldTransformer's isPlainFunctionScope note: a name FIRST let/const-declared inside
        // a nested if/while/bare-block is NOT block-scoped away for the rest of the function (the
        // real SauceScript compiler shares scope across if/while bodies), so it must shadow here
        // too — otherwise a table access AFTER such a branch would be wrongly treated as an
        // unshadowed read of the OUTER top-level table.
        if (node.body)
            collectLexicalNamesInScope(node.body, names);
        if (node.name)
            names.add(node.name.text);
        let ok = true;
        ts.forEachChild(node, (child) => {
            if (child === node.name)
                return;
            if (!checkTableSafety(child, name, kind, names, exclude))
                ok = false;
        });
        return ok;
    }
    if (isMethodLikeScope(node)) {
        const names = new Set(shadowed);
        for (const p of node.parameters)
            collectBindingNames(p.name, names);
        if (node.body)
            collectVarNames(node.body, names);
        if (node.body)
            collectLexicalNamesInScope(node.body, names); // see isPlainFunctionScope's note above
        let ok = true;
        ts.forEachChild(node, (child) => {
            if (child === node.name) {
                if (ts.isComputedPropertyName(node.name) &&
                    !checkTableSafety(node.name.expression, name, kind, shadowed, exclude)) {
                    ok = false;
                }
                return;
            }
            if (!checkTableSafety(child, name, kind, names, exclude))
                ok = false;
        });
        return ok;
    }
    if (ts.isForStatement(node)) {
        const names = new Set(shadowed);
        if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
            for (const decl of node.initializer.declarations)
                collectBindingNames(decl.name, names);
        }
        let ok = true;
        if (node.initializer && !checkTableSafety(node.initializer, name, kind, names, exclude))
            ok = false;
        if (node.condition && !checkTableSafety(node.condition, name, kind, names, exclude))
            ok = false;
        if (node.incrementor && !checkTableSafety(node.incrementor, name, kind, names, exclude))
            ok = false;
        if (!checkTableSafety(node.statement, name, kind, names, exclude))
            ok = false;
        return ok;
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
        const names = new Set(shadowed);
        if (ts.isVariableDeclarationList(node.initializer)) {
            for (const decl of node.initializer.declarations)
                collectBindingNames(decl.name, names);
        }
        let ok = checkTableSafety(node.expression, name, kind, shadowed, exclude); // the iterated expr: outer scope
        if (!checkTableSafety(node.initializer, name, kind, names, exclude))
            ok = false;
        if (!checkTableSafety(node.statement, name, kind, names, exclude))
            ok = false;
        return ok;
    }
    if (ts.isCatchClause(node)) {
        const names = new Set(shadowed);
        if (node.variableDeclaration)
            collectBindingNames(node.variableDeclaration.name, names);
        return checkTableSafety(node.block, name, kind, names, exclude);
    }
    let ok = true;
    ts.forEachChild(node, (child) => {
        if (!checkTableSafety(child, name, kind, shadowed, exclude))
            ok = false;
    });
    return ok;
}
/**
 * Every same-file top-level `const NAME = [<foldable>, ...] / { key: <foldable>, ... }` that
 * passes BOTH soundness gates: (1) every element/property folds to a bigint via `tsEvalConst`
 * (so `consts` — the scalar top-level consts, collected first — may be referenced by a table's
 * elements, but a table may never reference another table), and (2) the whole-file
 * `checkTableSafety` scan finds zero disqualifying uses of the name. A literal failing either
 * gate is simply never added here — `tableFoldTransformer` only ever touches names present in
 * this map, so anything not tracked is left byte-for-byte untouched, same as before this
 * feature existed.
 */
function collectTopLevelTables(sourceFile, consts, functions) {
    const tables = new Map();
    for (const stmt of sourceFile.statements) {
        if (!ts.isVariableStatement(stmt))
            continue;
        if (!(stmt.declarationList.flags & ts.NodeFlags.Const))
            continue;
        for (const decl of stmt.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !decl.initializer)
                continue;
            const name = decl.name.text;
            const init = decl.initializer;
            let entry;
            if (ts.isArrayLiteralExpression(init)) {
                const elements = foldArrayLiteralElements(init, consts, functions);
                if (elements)
                    entry = { kind: 'array', elements };
            }
            else if (ts.isObjectLiteralExpression(init)) {
                const props = foldObjectLiteralProps(init, consts, functions);
                if (props)
                    entry = { kind: 'object', props };
            }
            if (!entry)
                continue; // not a fully-foldable literal — never a candidate, left completely alone
            if (checkTableSafety(sourceFile, name, entry.kind, new Set(), decl.name))
                tables.set(name, entry);
        }
    }
    return tables;
}
/** Resolve a single `NAME[k]` / `NAME.prop` / `NAME["prop"]` access to its literal element/property value, if provable. */
function foldTableAccess(node, table, consts, functions, shadowed) {
    if (ts.isPropertyAccessExpression(node)) {
        if (table.kind !== 'object')
            return undefined;
        const value = table.props.get(node.name.text);
        return value !== undefined ? toLiteralNode(value) : undefined;
    }
    if (table.kind === 'array') {
        const index = tsEvalConst(node.argumentExpression, consts, functions, shadowed);
        if (index === undefined || index < 0n || index >= BigInt(table.elements.length))
            return undefined;
        return toLiteralNode(table.elements[Number(index)]);
    }
    // Object table via a computed key — only a literal string (`TABLE["key"]`) is resolved; any
    // other computed-key shape is left untouched (this table has no OTHER disqualifying uses, so
    // this single unresolvable access simply stays as real runtime code, same as an out-of-bounds
    // array index).
    if (!ts.isStringLiteralLike(node.argumentExpression))
        return undefined;
    const value = table.props.get(node.argumentExpression.text);
    return value !== undefined ? toLiteralNode(value) : undefined;
}
/**
 * The table-folding transformer: shadow-aware (identical scope rules to
 * `constPropagationTransformer`/`substituteConstReads`, reusing the same helpers), replaces every
 * resolvable `NAME[k]`/`NAME.prop`/`NAME["prop"]` access — where `NAME` is an unshadowed
 * reference to a tracked table — with its literal value. A resolvable access is always safe to
 * fold outright (never a write/call target): `collectTopLevelTables`'s `checkTableSafety` gate
 * already proved zero such uses exist anywhere for a tracked name, and `foldTableAccess` itself
 * re-checks boundedness/constancy per access — this transformer additionally re-derives
 * `isTableAccessUnsafeUsage` per access as a second, independent guard (the same "belt and
 * suspenders" double-check this file already applies to the assignment-operator guard).
 */
/**
 * `for (const x of ARR) { ... }` where `ARR` is a tracked ARRAY table unrolls into one copy of
 * the body per element, the loop variable substituted by its literal value — the STRETCH-GOAL
 * counterpart of `unrollCountingLoop` above, adapted to iterate over TABLE ELEMENTS instead of
 * an arithmetic sequence, reusing the exact same safety infrastructure: `MAX_UNROLL_ITERATIONS`
 * (capped by element count, no need to count up to it — the length is already known),
 * `bodyBlocksUnrolling` (break/continue/return/counter-shadowing bail — "counter" here is the
 * loop variable), and `substituteCounter`. Declines (returns `undefined`, leaving the loop as
 * real runtime code) on: `for await...of`, a destructured loop variable (`for (const [a,b] of
 * ARR)` — out of scope, only a single plain identifier is supported), a shadowed or non-array-
 * table iterated expression, or a body that `bodyBlocksUnrolling` rejects. `reprocess` re-enters
 * the SAME statement-list visiting (`visitStatementList`) on each unrolled copy so a nested
 * `if`/loop/table-access keyed on the loop variable cascades to a fully-resolved literal per
 * iteration, exactly like the numeric unroller's own `foldStatementList` re-entry.
 */
function tryUnrollForOfArrayTable(node, tables, shadowed, context, reprocess) {
    if (node.awaitModifier)
        return undefined; // for-await — out of scope
    if (!ts.isIdentifier(node.expression) || shadowed.has(node.expression.text))
        return undefined;
    const table = tables.get(node.expression.text);
    if (!table || table.kind !== 'array')
        return undefined; // only an ARRAY table has an iteration order
    if (!ts.isVariableDeclarationList(node.initializer) || node.initializer.declarations.length !== 1)
        return undefined;
    const decl = node.initializer.declarations[0];
    if (!ts.isIdentifier(decl.name))
        return undefined; // a destructured loop variable — out of scope, decline
    const loopVar = decl.name.text;
    if (table.elements.length > MAX_UNROLL_ITERATIONS)
        return undefined;
    if (bodyBlocksUnrolling(node.statement, loopVar))
        return undefined;
    const bodyStatements = ts.isBlock(node.statement) ? node.statement.statements : [node.statement];
    const result = table.elements.flatMap((value) => {
        const literal = toLiteralNode(value);
        const substituted = bodyStatements.map((s) => substituteCounter(s, loopVar, literal, context));
        return reprocess(substituted, shadowed);
    });
    // See `unrollCountingLoop`'s matching guard / `collidesWithSurroundingDeclarations`'s own
    // comment: a body declaring its own per-iteration local would otherwise duplicate that
    // declaration once per table element, directly in this SAME flattened list.
    return collidesWithSurroundingDeclarations(result, shadowed) ? undefined : result;
}
/**
 * Visits a statement list for `tableFoldTransformer`, recognizing an unrollable `for...of` over
 * a tracked array table before falling back to the ordinary per-statement `visit` — the natural
 * place for this (mirroring `foldStatementList` above) since eliding one `ForOfStatement` in
 * favor of N unrolled copies replaces ONE list entry with MANY, which a single-node visitor
 * (`ts.visitEachChild`'s single-slot callback contract) cannot express. Kept as a SEPARATE
 * function from the single-node `visit` specifically so the unroll attempt only ever fires from
 * a genuine statement-LIST position (`Block.statements` / `SourceFile.statements`) — a for-of
 * loop sitting in a single-statement slot (e.g. the un-braced body of an outer `for`/`if`) is
 * conservatively left un-unrolled (falls through to `visit`'s own, ordinary — shadow-aware,
 * non-unrolling — `ForOfStatement` handling) rather than risk returning an array where exactly
 * one `ts.Statement` is structurally required.
 */
function visitStatementList(statements, visit, shadowed, tables, context) {
    const reprocess = (stmts, s) => visitStatementList(stmts, visit, s, tables, context);
    return statements.flatMap((stmt) => {
        if (ts.isForOfStatement(stmt)) {
            const unrolled = tryUnrollForOfArrayTable(stmt, tables, shadowed, context, reprocess);
            if (unrolled)
                return unrolled;
        }
        return [visit(stmt, shadowed)];
    });
}
function tableFoldTransformer(tables, consts, functions) {
    return (context) => {
        const visit = (node, shadowed) => {
            if (isOutOfScopeForPropagation(node))
                return node;
            if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
                ts.isIdentifier(node.expression) &&
                !shadowed.has(node.expression.text) &&
                tables.has(node.expression.text) &&
                !isTableAccessUnsafeUsage(node)) {
                const table = tables.get(node.expression.text);
                const literal = foldTableAccess(node, table, consts, functions, shadowed);
                if (literal)
                    return literal;
            }
            if (ts.isBlock(node)) {
                const names = new Set(shadowed);
                collectDirectlyDeclaredNames(node.statements, names);
                return ts.factory.updateBlock(node, visitStatementList(node.statements, visit, names, tables, context));
            }
            if (isPlainFunctionScope(node)) {
                const names = new Set(shadowed);
                for (const p of node.parameters)
                    collectBindingNames(p.name, names);
                if (node.body)
                    collectVarNames(node.body, names);
                // See foldTransformer's isPlainFunctionScope note (and checkTableSafety's matching
                // copy above): a name FIRST let/const-declared inside a nested if/while/bare-block
                // shadows for the REST of the function too, matching the real SauceScript compiler's
                // shared if/while scope — without this, a table access after such a branch would be
                // folded against the OUTER top-level table instead of staying an unresolved real read.
                if (node.body)
                    collectLexicalNamesInScope(node.body, names);
                if (node.name)
                    names.add(node.name.text);
                const childVisitor = (child) => (child === node.name ? child : visit(child, names));
                return ts.visitEachChild(node, childVisitor, context);
            }
            if (isMethodLikeScope(node)) {
                const names = new Set(shadowed);
                for (const p of node.parameters)
                    collectBindingNames(p.name, names);
                if (node.body)
                    collectVarNames(node.body, names);
                if (node.body)
                    collectLexicalNamesInScope(node.body, names); // see isPlainFunctionScope's note above
                const childVisitor = (child) => {
                    if (child === node.name) {
                        return ts.isComputedPropertyName(node.name)
                            ? ts.factory.updateComputedPropertyName(node.name, visit(node.name.expression, shadowed))
                            : node.name;
                    }
                    return visit(child, names);
                };
                return ts.visitEachChild(node, childVisitor, context);
            }
            if (ts.isForStatement(node)) {
                const names = new Set(shadowed);
                if (node.initializer && ts.isVariableDeclarationList(node.initializer)) {
                    for (const decl of node.initializer.declarations)
                        collectBindingNames(decl.name, names);
                }
                return ts.factory.updateForStatement(node, node.initializer ? visit(node.initializer, names) : undefined, node.condition ? visit(node.condition, names) : undefined, node.incrementor ? visit(node.incrementor, names) : undefined, visit(node.statement, names));
            }
            if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
                const names = new Set(shadowed);
                if (ts.isVariableDeclarationList(node.initializer)) {
                    for (const decl of node.initializer.declarations)
                        collectBindingNames(decl.name, names);
                }
                const visitedInit = visit(node.initializer, names);
                const visitedStmt = visit(node.statement, names);
                const visitedExpr = visit(node.expression, shadowed); // outer scope
                return ts.isForOfStatement(node)
                    ? ts.factory.updateForOfStatement(node, node.awaitModifier, visitedInit, visitedExpr, visitedStmt)
                    : ts.factory.updateForInStatement(node, visitedInit, visitedExpr, visitedStmt);
            }
            if (ts.isCatchClause(node)) {
                const names = new Set(shadowed);
                if (node.variableDeclaration)
                    collectBindingNames(node.variableDeclaration.name, names);
                return ts.factory.updateCatchClause(node, node.variableDeclaration, visit(node.block, names));
            }
            return ts.visitEachChild(node, (child) => visit(child, shadowed), context);
        };
        return (sourceFile) => ts.factory.updateSourceFile(sourceFile, visitStatementList(sourceFile.statements, visit, new Set(), tables, context));
    };
}
/**
 * Removes any top-level `const` (or effectively-const PRIMARY `let`/`var`, or array/object
 * lookup-table declaration tracked in `tables`) whose name has zero remaining `Identifier`
 * occurrences anywhere in the (already-substituted) file — and, for a STRETCH pair, removes
 * its sole assignment statement too once the same holds. Deliberately a flat, whole-file
 * textual count — NOT scope-aware — matching `constPropagationTransformer`'s own guarantee
 * that it already replaced every reachable, unshadowed reference with a literal (and
 * `tableFoldTransformer`'s equivalent guarantee for a table's every resolvable access): by
 * this point, any occurrence still in the tree is either a shadowing inner declaration of the
 * SAME name (a coincidental false-positive "still referenced" that simply keeps this
 * otherwise-dead declaration around, harmlessly) or a genuine remaining use this pass
 * correctly declines to touch.
 *
 * DCE-of-a-PAIR design decision: once a STRETCH name becomes fully dead, BOTH its
 * predeclaration's (now-empty) declarator and its one assignment statement are removed
 * together, in this same pass — not left as an orphaned `let x;` (a declaration with no
 * initializer and no further use is exactly as dead as the assignment that gave it its only
 * value) and not deferred to a separate pass (nothing downstream should ever see a naked
 * `let x;` this transformer chain itself introduced by only removing half the pair).
 */
function deadConstEliminationTransformer(consts, primaryNames, pairNames, tables) {
    return (_context) => {
        return (sourceFile) => {
            // Real const + PRIMARY let/var: a single declarator, found directly (identity is safe
            // here — these node references come from THIS SAME `sourceFile`, never carried in).
            const declNameNodes = new Map();
            for (const stmt of sourceFile.statements) {
                if (!ts.isVariableStatement(stmt))
                    continue;
                const isConst = Boolean(stmt.declarationList.flags & ts.NodeFlags.Const);
                for (const decl of stmt.declarationList.declarations) {
                    if (!ts.isIdentifier(decl.name) || declNameNodes.has(decl.name.text))
                        continue;
                    const name = decl.name.text;
                    const tracked = isConst ? consts.has(name) || tables.has(name) : primaryNames.has(name);
                    if (tracked)
                        declNameNodes.set(name, decl.name);
                }
            }
            // STRETCH pairs: re-derived structurally, fresh, from this same `sourceFile` — see
            // `findPairStatements`'s own comment for why a carried-in node reference can't be used.
            const pairInfo = new Map();
            for (const name of pairNames) {
                const found = findPairStatements(sourceFile, name);
                if (found)
                    pairInfo.set(name, found);
            }
            if (declNameNodes.size === 0 && pairInfo.size === 0)
                return sourceFile;
            const eliminable = new Set();
            for (const [name, nameNode] of declNameNodes) {
                if (countIdentifierRefs(sourceFile, name, new Set([nameNode])) === 0)
                    eliminable.add(name);
            }
            for (const [name, info] of pairInfo) {
                const exclude = new Set([info.declName, info.assignTargetName]);
                if (countIdentifierRefs(sourceFile, name, exclude) === 0)
                    eliminable.add(name);
            }
            if (eliminable.size === 0)
                return sourceFile;
            const statements = sourceFile.statements.flatMap((stmt) => {
                // A STRETCH pair's assignment statement is removed OUTRIGHT once its name is dead.
                for (const [name, info] of pairInfo) {
                    if (eliminable.has(name) && info.assignStatement === stmt)
                        return [];
                }
                if (!ts.isVariableStatement(stmt))
                    return [stmt];
                const isConst = Boolean(stmt.declarationList.flags & ts.NodeFlags.Const);
                const kept = stmt.declarationList.declarations.filter((decl) => {
                    if (!ts.isIdentifier(decl.name))
                        return true;
                    const name = decl.name.text;
                    if (isConst)
                        return !((consts.has(name) || tables.has(name)) && eliminable.has(name));
                    if (primaryNames.has(name))
                        return !eliminable.has(name);
                    const pair = pairInfo.get(name);
                    if (pair && pair.declStatement === stmt)
                        return !eliminable.has(name);
                    return true;
                });
                if (kept.length === stmt.declarationList.declarations.length)
                    return [stmt];
                if (kept.length === 0)
                    return [];
                return [
                    ts.factory.updateVariableStatement(stmt, stmt.modifiers, ts.factory.updateVariableDeclarationList(stmt.declarationList, kept)),
                ];
            });
            return ts.factory.updateSourceFile(sourceFile, statements);
        };
    };
}
/** `node`, paren-stripped. Shared by every write/escape/target check below — TypeScript
 * represents `(arr[0]) = 1n;`/`(arr) = new Array(2);` etc. with the parens as their own wrapper
 * node, so every shape-check here must see through them the same way `tsEvalConst`'s own
 * `ts.isParenthesizedExpression` case does. */
function stripParens(node) {
    return ts.isParenthesizedExpression(node) ? stripParens(node.expression) : node;
}
/**
 * `tsEvalConst`'s `ts.isNumericLiteral` branch calls `node.getText()` — which THROWS
 * (`Debug Failure. False expression: Node must have a real position for this operation`,
 * confirmed directly against a factory-synthesized node) for any node with no real source
 * position (`node.pos < 0`), a case `tsEvalConst`'s own try/catch already converts to
 * `undefined` for ITS callers. This matters specifically HERE: `unrollCountingLoop`'s
 * `substituteCounter` step synthesizes EXACTLY such a node whenever the unrolled loop's counter
 * is a plain `number` literal rather than a `bigint` one (`for (let i = 0; i < 3; i++)` — see
 * `toLiteralNode`, which is what builds it) — and this pass exists specifically to recognize the
 * straight-line writes THAT unrolling produces, so declining this shape entirely would silently
 * never fold the whole plain-number-counter family. This is a NARROW, LOCAL-TO-THIS-PASS
 * fallback (see `evalArrayConst`) rather than a change to `tsEvalConst` itself — fixing it there
 * would alter fold behavior for every other existing pass, a separate change with its own
 * regression tests. A synthesized node's `.text` field (unlike `getText()`) is populated
 * directly at construction and is always safe to read — and since a literal built this way is
 * always exactly what `toLiteralNode` produced from a real bigint (canonical, decimal, no
 * separators), `BigInt(node.text)` needs no further validation, unlike `tsEvalConst`'s own
 * `getText()` path (which must also strip user-typed numeric separators). A synthesized
 * `BigIntLiteral` needs no equivalent handling: `tsEvalConst`'s own `ts.isBigIntLiteral` branch
 * already reads `.text` directly, never `getText()`, so it's already safe regardless of position.
 */
function synthesizedNumericValue(node) {
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
        const inner = synthesizedNumericValue(node.operand);
        return inner === undefined ? undefined : -inner;
    }
    if (!ts.isNumericLiteral(node) || node.pos >= 0)
        return undefined; // has a real position — tsEvalConst already handles it
    try {
        return BigInt(node.text);
    }
    catch {
        return undefined;
    }
}
/**
 * `tsEvalConst` first (the ordinary, real-position case — literals, same-file top-level
 * `consts`/`functions`, all unchanged), `synthesizedNumericValue` as the ONLY fallback (a
 * synthesized plain-number counter/value the loop-unroller produced). Used everywhere this pass
 * needs to resolve a compile-time constant: the `new Array(<expr>)` size argument, a
 * construction write's index/value, and a later read's index.
 */
function evalArrayConst(expr, consts, functions, shadowed) {
    const direct = tsEvalConst(expr, consts, functions, shadowed);
    return direct !== undefined ? direct : synthesizedNumericValue(expr);
}
/**
 * Recognizes `new Array(<expr>)` (matching `processNewExpression`'s own arity rule,
 * compiler/src/processor/expression.ts: exactly 1 argument) and resolves that argument to an
 * in-range constant size via `evalArrayConst`. Because the argument resolves ONLY through
 * `tsEvalConst`, whose only call-folding path is `tsEvalCall` (same-file, single-`return`, ZERO
 * nested `Call`/`New` anywhere in the callee's body), a resolvable size argument is provably
 * side-effect-free — discarding its evaluation (this whole pass's premise) is therefore sound.
 * Anything else (wrong callee, wrong arity, an unresolvable/non-integer/out-of-range argument —
 * a parameter, `pools.length`, a call with a side effect) returns `undefined`: not a candidate,
 * left completely untouched, no diagnostic. This alone rejects the entire real-world population
 * of `../sauce-recipes/ecoswap/ecoswap.sauce.ts`'s ~30 `new Array(pools.length)` declarations at
 * the cheapest possible gate, before any per-candidate scanning ever begins.
 */
function newArraySize(init, consts, functions, shadowed) {
    if (!ts.isNewExpression(init))
        return undefined;
    if (!ts.isIdentifier(init.expression) || init.expression.text !== 'Array')
        return undefined;
    if (!init.arguments || init.arguments.length !== 1)
        return undefined;
    const size = evalArrayConst(init.arguments[0], consts, functions, shadowed);
    if (size === undefined || size < 1n || size > BigInt(MAX_FOLDED_ARRAY_ELEMENTS))
        return undefined;
    return Number(size);
}
/** True the moment ANY `new Array(...)` call occurs anywhere in `node`, WITHOUT crossing into a
 * nested function-like scope (that scope is analyzed independently, on its own merits, by the
 * driver — see `localArrayFoldTransformer`). The cheapest possible per-function gate: a body
 * containing zero of these can never have a fold opportunity, so both the driver and
 * `analyzeLocalArrays` check this FIRST, before building a shadow set or walking statements. */
function containsNewArrayConstruction(node) {
    if (isFunctionLikeScope(node))
        return false;
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Array')
        return true;
    let found = false;
    ts.forEachChild(node, (child) => {
        if (!found && containsNewArrayConstruction(child))
            found = true;
    });
    return found;
}
/** Does any Identifier anywhere in `node` have its text in `names`? The multi-name analogue of
 * `referencesIdentifier` — used only by `isCandidateWriteStatement`'s defense-in-depth
 * self/cross-referential-construction check (see its own comment for why this is checked
 * EXPLICITLY rather than left to `evalArrayConst` merely failing to resolve an
 * `ElementAccessExpression`, which it always does today, but this pass must not silently depend
 * on that remaining true). */
function referencesAnyName(node, names) {
    if (names.size === 0)
        return false;
    if (ts.isIdentifier(node))
        return names.has(node.text);
    let found = false;
    ts.forEachChild(node, (child) => {
        if (!found && referencesAnyName(child, names))
            found = true;
    });
    return found;
}
/**
 * `arr[k] = v;` — a PLAIN (`=` only; a compound operator like `+=` is deliberately rejected
 * here, so it falls through to the escape rules as an ordinary disqualifying use — this is
 * exactly the `a[i] += 5` shape pinned by the existing `test/index.test.ts:209` fixture, which
 * must never be mistaken for a pure construction write) assignment statement whose LEFT is an
 * `ElementAccessExpression` based on `name`, and whose index AND value both resolve to a
 * constant via `evalArrayConst` — with NEITHER the index nor the value expression referencing
 * ANY candidate array name in `candidateNames` (rejects `arr[1] = arr[0] + 1n` — self-
 * referential construction, deliberately out of scope for v1 — and any cross-array read during
 * construction, checked EXPLICITLY here rather than relying on `evalArrayConst` incidentally
 * failing to resolve an `ElementAccessExpression`, which it always does today since
 * `tsEvalConst` has no case for one at all — but this soundness argument must not silently
 * depend on that remaining true forever). Anything else (not an `ExpressionStatement`, a
 * compound/update operator, a non-candidate target, an unresolvable or negative index, an
 * unresolvable value, a self- or cross-referential expression) returns `undefined` — simply not
 * a recognized write; the caller (`classifyConstructionRegion`) treats that exactly like any
 * other non-write occurrence of the name.
 */
function isCandidateWriteStatement(stmt, name, candidateNames, shadowed, top) {
    if (!ts.isExpressionStatement(stmt))
        return undefined;
    const expr = stripParens(stmt.expression);
    if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
        return undefined;
    const left = stripParens(expr.left);
    if (!ts.isElementAccessExpression(left))
        return undefined;
    if (!ts.isIdentifier(left.expression) || left.expression.text !== name)
        return undefined;
    if (referencesAnyName(left.argumentExpression, candidateNames) || referencesAnyName(expr.right, candidateNames)) {
        return undefined;
    }
    const index = evalArrayConst(left.argumentExpression, top.consts, top.functions, shadowed);
    if (index === undefined || index < 0n)
        return undefined;
    const value = evalArrayConst(expr.right, top.consts, top.functions, shadowed);
    if (value === undefined)
        return undefined;
    return { index, value };
}
/**
 * Scans forward from `declIndex + 1` over `statements` (the function body's own flat top-level
 * list), accumulating exactly `size` recognized writes (`isCandidateWriteStatement`) to DISTINCT
 * in-range indices. COMPLETENESS is required — every index in `[0, size)` written EXACTLY
 * once — not merely "every index that's later read": this is what makes `elements` a TOTAL
 * array, so the read-fold path can never encounter a hole and never has to model what an
 * unwritten `new Array` slot contains at runtime (a real engine property this pass has not
 * verified on-chain and deliberately refuses to depend on — the read-index-only relaxation is a
 * sound, but explicitly deferred, v2 item). WRITE ORDER IS UNCONSTRAINED
 * (`arr[2]=…; arr[0]=…; arr[1]=…` is accepted): within the region, every occurrence of `name`
 * that ISN'T a recognized write disqualifies the WHOLE candidate outright (so every write
 * necessarily precedes every read), and every index is written exactly once — so write order is
 * simply unobservable, and completeness + uniqueness are the only properties this fold depends
 * on. A statement that doesn't mention `name` AT ALL is skipped (allowed to sit inside the
 * region) — this is what lets two independent arrays' constructions interleave, and lets an
 * unrelated statement (`let z = 1n;`) sit between writes. Returns `undefined` (disqualify the
 * whole candidate) on: a duplicate write to an already-written index, an out-of-range write
 * index, any statement that mentions `name` but isn't a recognized write (a runtime-indexed
 * write, a compound/update write, a plain read, …), or running out of statements before every
 * index is covered (a hole).
 */
function classifyConstructionRegion(statements, declIndex, name, size, candidateNames, shadowed, top) {
    const elements = new Array(size).fill(undefined);
    const writeStatements = new Set();
    let written = 0;
    for (let i = declIndex + 1; i < statements.length; i++) {
        const stmt = statements[i];
        const write = isCandidateWriteStatement(stmt, name, candidateNames, shadowed, top);
        if (write) {
            const idx = Number(write.index);
            if (idx >= size || elements[idx] !== undefined)
                return undefined; // out of range, or a duplicate write to one index
            elements[idx] = write.value;
            writeStatements.add(stmt);
            written++;
            if (written === size)
                return { writeStatements, lastWriteIndex: i, elements: elements };
            continue;
        }
        if (referencesIdentifier(stmt, name))
            return undefined; // mentions `name` but isn't a recognized write — disqualify
        // Doesn't mention `name` at all — an unrelated statement (another array's own
        // construction, a sibling local, …) is allowed to sit inside the region, skipped.
    }
    return undefined; // ran out of statements before every index was covered — a hole, disqualify
}
/**
 * Declaration recognition + construction-region classification, over ONE function body's own
 * flat top-level statement list. First pass: every DIRECT, single-declarator `let`/`const`
 * statement (never `var` — see the design's scope rule 3) whose initializer is a
 * `new Array(<const>)` resolving to an in-range size (`newArraySize`) is a raw declaration —
 * gathered into `candidateNames` FIRST, independent of whether its construction region will
 * later validate, purely so `isCandidateWriteStatement`'s self/cross-referential check (see its
 * own comment) can see every candidate name in the function, not just the one currently being
 * classified. Second pass: each raw declaration is independently run through
 * `classifyConstructionRegion`; only those that fully validate become a `LocalArrayCandidate`.
 */
function collectArrayCandidates(statements, shadowed, top) {
    const rawDeclarations = [];
    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (!ts.isVariableStatement(stmt))
            continue;
        const flags = stmt.declarationList.flags;
        if (!(flags & ts.NodeFlags.Let) && !(flags & ts.NodeFlags.Const))
            continue; // `var` — never a candidate
        if (stmt.declarationList.declarations.length !== 1)
            continue;
        const decl = stmt.declarationList.declarations[0];
        if (!ts.isIdentifier(decl.name) || !decl.initializer)
            continue;
        const size = newArraySize(decl.initializer, top.consts, top.functions, shadowed);
        if (size === undefined)
            continue;
        rawDeclarations.push({ index: i, name: decl.name.text, size, stmt });
    }
    const candidateNames = new Set(rawDeclarations.map((d) => d.name));
    const candidates = [];
    for (const { index: declIndex, name, size, stmt } of rawDeclarations) {
        const region = classifyConstructionRegion(statements, declIndex, name, size, candidateNames, shadowed, top);
        if (!region)
            continue;
        candidates.push({
            name,
            size,
            declStatement: stmt,
            declIndex,
            writeStatements: region.writeStatements,
            lastWriteIndex: region.lastWriteIndex,
            elements: region.elements,
        });
    }
    return candidates;
}
/**
 * Scans an assignment/update TARGET — the left side of `=`/a compound-assignment operator, or a
 * `++`/`--` operand — for `candidate`'s escape scan (`scanArrayUses`' rules 3/4): mirrors
 * `visitAssignmentTarget`/`visitLocalAssignmentTarget`'s exact dispatch one section below
 * (recurse into a genuine nested READ — a computed member-access key, e.g.
 * `other[arr[0]] = 5n;` — via the ordinary `scan` callback; never treat the bound
 * identifier/base itself as a read), but CLASSIFYING (disqualify-or-scan-nested) instead of
 * substituting. `disqualify` fires the moment the target's OWN base is the candidate (a
 * rebind — `arr = …` — or an element/property WRITE — `arr[i] = …`/`arr.x = …`) or the target is
 * a destructuring pattern (object/array-literal reused as an assignment target) mentioning the
 * candidate anywhere inside — rule 20's "at any depth" requirement, deliberately without trying
 * to distinguish a destructuring default's own genuinely-read value from its binding position,
 * unlike the real substitution passes: ANY occurrence there is conservatively treated as an
 * escape, matching this pass's stricter-than-the-table-feature "resolvable, not just safe"
 * standard (see this section's own header comment).
 */
function scanAssignmentTarget(node, name, scan, disqualify) {
    const target = stripParens(node);
    if (ts.isIdentifier(target)) {
        if (target.text === name)
            disqualify(); // a rebind: `arr = …`
        return;
    }
    if (ts.isElementAccessExpression(target)) {
        if (ts.isIdentifier(target.expression) && target.expression.text === name) {
            disqualify(); // an element WRITE: `arr[i] = …`
            return;
        }
        scan(target.expression); // e.g. another candidate as the base: `other[i] = …`
        scan(target.argumentExpression); // a genuine nested read: `other[arr[0]] = …`
        return;
    }
    if (ts.isPropertyAccessExpression(target)) {
        if (ts.isIdentifier(target.expression) && target.expression.text === name) {
            disqualify(); // a property WRITE: `arr.x = …` (never a legal SauceScript shape, fail closed regardless)
            return;
        }
        scan(target.expression);
        return;
    }
    if (referencesIdentifier(target, name)) {
        disqualify(); // a destructuring-assignment pattern mentioning the candidate anywhere inside
        return;
    }
    scan(target);
}
/**
 * The whole-function, top-down, fail-closed ALLOWLIST escape scan for `candidate`: TWO
 * authorized shapes — the base identifier of an `ElementAccessExpression`, in READ position,
 * whose index resolves to an in-range constant (Rule 6); and, ONLY when `allowReturnEscape` is
 * true (a top-level `function main`, set by `localArrayFoldTransformer`), the bare identifier as
 * the SOLE, entire operand of a `ReturnStatement` (Rule 6b) — every other occurrence of
 * `candidate.name` anywhere in `body` disqualifies the whole candidate. Same philosophy as the
 * lookup-table feature's `isSafeTableRead`/`checkTableSafety` above, with one MANDATORY
 * implementation difference and two deliberate strengthenings (see this section's own header
 * comment for the full "why"):
 *
 *  * MANDATORY: this must be a TOP-DOWN walk that classifies a node BEFORE descending into it,
 *    never consulting `.parent`. `isTableAccessUnsafeUsage` walks UP through `node.parent` — but
 *    a node SYNTHESIZED by an earlier transformer stage (confirmed directly: `ts.factory.
 *    createNumericLiteral(7).parent` is `undefined`) has no parent chain to walk, and the
 *    unrolled writes this pass exists to recognize are EXACTLY such synthesized nodes. Walking
 *    up from a synthesized `arr[0n]` inside a synthesized `arr[0n] = 5n;` would silently report
 *    a WRITE as a safe READ — a catastrophic, silent misclassification this pass cannot risk
 *    (the existing table-fold guard has the identical weakness, but is harmless there only
 *    because `checkTableSafety` already proved the file write-free on the fully-parented ORIGINAL
 *    tree before that guard ever runs).
 *  * STRENGTHENING (a): safe is not enough — every surviving occurrence must also be provably
 *    RESOLVABLE, because this pass DELETES the backing allocation (the table feature can leave a
 *    single unresolvable access untouched precisely because it only removes a declaration that
 *    ALREADY has zero remaining references).
 *  * STRENGTHENING (b): an occurrence textually BEFORE the declaration disqualifies (checked by
 *    the caller, `analyzeLocalArrays` — real TDZ; SauceScript would reject it as an undefined
 *    variable regardless, never silently fold it).
 *
 * `candidate.declStatement` and every one of `candidate.writeStatements` are skipped OUTRIGHT
 * (by statement IDENTITY, before any classification) the moment the walk reaches them — they
 * are pre-authorized by `classifyConstructionRegion`'s own narrower proof (a plain `=`, constant
 * index/value, no self/cross-candidate reference), so descending into one would otherwise let
 * rule 3 below wrongly flag the array's OWN legitimate construction write as a disqualifying
 * write-to-self. This is deliberately NOT restricted to `candidate`'s own writes only: a
 * DIFFERENT candidate's write statement (`other[0] = arr[0];`) is still fully descended into,
 * so a legitimate cross-array READ of `candidate` sitting inside it is still found and folded,
 * independent of whether `other` itself ever validates.
 */
function scanArrayUses(candidate, body, statements, shadowed, top, out, allowReturnEscape, returnOut) {
    const name = candidate.name;
    let ok = true;
    const disqualify = () => {
        ok = false;
    };
    const scan = (node) => {
        if (!ok)
            return;
        if (node === candidate.declStatement || candidate.writeStatements.has(node))
            return;
        // Rule 1: out-of-scope node kinds (types, imports, break/continue, and — via
        // `isOutOfScopeForPropagation`'s own membership — class/enum/namespace bodies) are left
        // completely unrecursed, UNLESS the candidate's name occurs anywhere inside — mirroring
        // `checkTableSafety`'s deliberate refusal to blanket-skip a class/enum/namespace body for a
        // MUTABLE value (a class method or namespace function could legally mutate an outer array
        // without ever reassigning its binding; this scan doesn't attempt to precisely re-derive
        // safety inside a node shape it otherwise never has to reason about, so any textual
        // occurrence there conservatively disqualifies rather than risk missing a real one).
        if (isOutOfScopeForPropagation(node)) {
            if (referencesIdentifier(node, name))
                disqualify();
            return;
        }
        // Rule 2: any nested function/arrow/method/accessor TOUCHING the candidate disqualifies it
        // outright, regardless of how read-only it looks — the same real hazard
        // `bailsForOuterClosure` documents further below (`something.catch(handler)` compiles the
        // handler's body against the SAME `CompilerContext` as its surrounding code, so a nested
        // body genuinely reaches the enclosing scope at the bytecode level, not a harmless JS
        // closure no-op).
        if (isFunctionLikeScope(node)) {
            if (referencesIdentifier(node, name))
                disqualify();
            return;
        }
        // Rule 3: any assignment (plain `=` OR compound — `arr[0] += 1n` disqualifies here exactly
        // like `arr[0] = 1n` outside the construction region would) — the target is classified by
        // `scanAssignmentTarget`, the (already skipped, if this candidate's own) RHS is scanned
        // normally.
        if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATOR_TOKENS.has(node.operatorToken.kind)) {
            scanAssignmentTarget(node.left, name, scan, disqualify);
            scan(node.right);
            return;
        }
        // Rule 4: `++`/`--` — the operand is an assignment target too.
        if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
            (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
            scanAssignmentTarget(node.operand, name, scan, disqualify);
            return;
        }
        // Rule 5: `delete arr[k]` / any call or `new` whose CALLEE references the candidate —
        // `arr.anything(...)` (no method whitelist), `delete arr[0]`, or the candidate itself
        // called as if it were a function. A call/new whose callee does NOT reference the
        // candidate scans its arguments normally (`f(arr[0])` is fine; `f(arr)` is caught by rule 7
        // once the bare `arr` argument is reached).
        if (ts.isDeleteExpression(node)) {
            if (referencesIdentifier(node.expression, name))
                disqualify();
            return;
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            if (referencesIdentifier(node.expression, name)) {
                disqualify();
                return;
            }
            if (node.arguments)
                for (const arg of node.arguments)
                    scan(arg);
            return;
        }
        // Rule 6: THE one authorized shape — `candidate`'s base identifier, immediately the
        // subject of an ElementAccessExpression, in read position (never reached as a write target
        // — rule 3 intercepts and classifies those before `scan` ever sees them as a plain
        // ElementAccessExpression), with an index resolving to an in-range constant. Deliberately
        // does NOT descend into `node.expression` (the base identifier is now fully accounted for)
        // — only the index expression is scanned further, since it may itself reference another
        // candidate.
        if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
            const index = evalArrayConst(node.argumentExpression, top.consts, top.functions, shadowed);
            if (index === undefined || index < 0n || index >= BigInt(candidate.size)) {
                disqualify();
                return;
            }
            out.set(node, candidate.elements[Number(index)]);
            scan(node.argumentExpression);
            return;
        }
        // Rule 6b: THE one OTHER authorized shape — `return arr;` (or `return (arr);`, via
        // `stripParens`) where `arr` is the SOLE, entire operand of a `ReturnStatement`, ONLY when
        // `allowReturnEscape` is true (a top-level `function main` — see
        // `localArrayFoldTransformer`; never a helper, see the "one escaping shape that IS
        // authorized" doc note above this function). MUST sit before Rule 7 (the bare-Identifier
        // catch-all that disqualifies `return arr;` today) and MUST intercept at the
        // ReturnStatement level, since this scan is top-down and never consults `.parent` — by the
        // time a bare `arr` reached as `node.expression` got to Rule 7, there would be no way to
        // tell it apart from an alias/call-argument/spread bare identifier. Falling through WITHOUT
        // matching (wrong shape, or `allowReturnEscape` false) leaves `node.expression` to be
        // scanned normally below, so `return arr[0] + 1n;`/`return foo(arr);`/`return (arr, 5n);`
        // still correctly reach Rules 6/5/7 exactly as before this rule existed.
        if (allowReturnEscape && ts.isReturnStatement(node) && node.expression) {
            const inner = stripParens(node.expression);
            if (ts.isIdentifier(inner) && inner.text === name) {
                // A negative element would make `encodeArray` (saucer/array.ts) THROW ("array elements
                // must be literals or dynamic types") for a program that compiles fine TODAY via the
                // heap `new Array` spelling (`compile('function main(){ return [-5n, 1n]; }')` already
                // throws that same error) — folding must never turn a compiling program into a compile
                // error, so bail instead of authorizing the escape. See "Forcing uint256 element width".
                if (candidate.elements.some((v) => v < 0n)) {
                    disqualify();
                    return;
                }
                // This is the ONE sub-case of this whole pass that GROWS bytecode (a forced-wide 32-byte
                // literal element vs. the small `SET_INDEX` it replaces) — a dedicated, smaller cap than
                // `MAX_FOLDED_ARRAY_ELEMENTS` bounds that growth; see `MAX_FOLDED_RETURN_ARRAY_ELEMENTS`.
                if (candidate.size > MAX_FOLDED_RETURN_ARRAY_ELEMENTS) {
                    disqualify();
                    return;
                }
                returnOut.set(inner, candidate.elements);
                return;
            }
        }
        // Rule 7: a bare Identifier named `name`, reached by ANY other path — an alias, a call
        // argument, a spread, a template interpolation, `for (const v of arr)`'s iterated
        // expression, `arr.length`/`arr.anything` (via its PropertyAccessExpression's `.expression`
        // child, reached through rule 8's generic recursion), a redeclaration of the name anywhere
        // in this same function scope (its OWN declaration binding name reached this way too, but
        // is already skipped by the statement-identity check above), or `return arr;` when Rule 6b
        // didn't authorize it (a helper, i.e. `allowReturnEscape` false) — disqualifies.
        // This single rule is what makes the allowlist TOTAL: no special case is needed for any of
        // the shapes just listed, or any shape not yet invented.
        if (ts.isIdentifier(node)) {
            if (node.text === name)
                disqualify();
            return;
        }
        // Rule 8: anything else recurses ordinarily.
        ts.forEachChild(node, scan);
    };
    scan(body);
    return ok;
}
/**
 * Runs the full per-candidate pipeline over ONE function body: the cheap gate
 * (`containsNewArrayConstruction`), `collectArrayCandidates`, then — per candidate — the TDZ
 * check (any occurrence in `statements[0, declIndex)` disqualifies — real TDZ; SauceScript would
 * reject it as `undefined variable:` regardless) and `scanArrayUses`. Accumulates every
 * successfully-folded candidate's deletions/access-values/return-arrays into ONE
 * `LocalArrayPlan` — a function with two independent local arrays where only one validates still
 * gets that one folded, the other left completely untouched. Returns `undefined` (nothing to do)
 * when the gate fails, no candidates exist, or every candidate fails its own scan.
 *
 * `allowReturnEscape` (default false — every existing caller/behavior is unchanged) gates
 * `scanArrayUses`'s Rule 6b, the ONE new authorized escape shape: `localArrayFoldTransformer`
 * passes `true` only for a top-level `function main`.
 */
function analyzeLocalArrays(body, shadowed, top, allowReturnEscape = false) {
    if (!containsNewArrayConstruction(body))
        return undefined;
    const statements = body.statements;
    const candidates = collectArrayCandidates(statements, shadowed, top);
    if (candidates.length === 0)
        return undefined;
    const deleteStatements = new Set();
    const accessValues = new Map();
    const returnArrays = new Map();
    const deletedNames = new Set();
    for (const candidate of candidates) {
        let occursBeforeDecl = false;
        for (let i = 0; i < candidate.declIndex && !occursBeforeDecl; i++) {
            if (referencesIdentifier(statements[i], candidate.name))
                occursBeforeDecl = true;
        }
        if (occursBeforeDecl)
            continue;
        const candidateAccessValues = new Map();
        const candidateReturnArrays = new Map();
        if (!scanArrayUses(candidate, body, statements, shadowed, top, candidateAccessValues, allowReturnEscape, candidateReturnArrays)) {
            continue;
        }
        deleteStatements.add(candidate.declStatement);
        for (const w of candidate.writeStatements)
            deleteStatements.add(w);
        for (const [node, value] of candidateAccessValues)
            accessValues.set(node, value);
        for (const [node, values] of candidateReturnArrays)
            returnArrays.set(node, values);
        deletedNames.add(candidate.name);
    }
    if (deletedNames.size === 0)
        return undefined;
    return { deleteStatements, accessValues, returnArrays, deletedNames };
}
/**
 * Applies a validated `LocalArrayPlan` to `body`: drops every statement in
 * `plan.deleteStatements` (the declaration and every construction write, for every
 * successfully-folded candidate) — deletion happens ONLY among `body.statements` directly, by
 * this pass's own scope rule (a candidate's declaration/writes can never be anywhere else), so
 * there is no splicing/reindexing concern here, and — unlike `unrollCountingLoop`/the if-branch
 * flattener/the STRETCH `for...of` table unroller — no need for
 * `collidesWithSurroundingDeclarations` either: REMOVING statements can never introduce a
 * duplicate lexical declaration the way INSERTING spliced copies can. What's left is then
 * visited once, replacing every node present in `plan.returnArrays`/`plan.accessValues` with its
 * literal by IDENTITY — this rewriter never re-derives or re-checks anything the analysis
 * already proved; a node either is one of the accepted nodes or it isn't, so there is no scope
 * logic and no `.parent` access here at all. A nested function-like scope is an OPAQUE LEAF
 * (mirroring `substituteLocalReads`'s identical treatment one section below) — by
 * `scanArrayUses` rule 2, no candidate ever survives with a use inside one, so there is nothing
 * to replace there anyway; it gets its own independent visit from the driver regardless.
 *
 * `wideSink` (the out-of-band width-forcing meta channel — see "Forcing uint256 element width")
 * records the fingerprint (`elements.join(',')`) of every literal array THIS rewrite
 * synthesizes from a `plan.returnArrays` entry, so `compile()` can force BYTE_32 element width
 * for the matching return-position array literal once `acorn` re-parses the emitted text.
 */
function rewriteFoldedArrayBody(body, plan, context, wideSink) {
    const survivors = body.statements.filter((s) => !plan.deleteStatements.has(s));
    const visit = (node) => {
        const returnValues = plan.returnArrays.get(node);
        if (returnValues !== undefined) {
            wideSink?.add(returnValues.join(','));
            return ts.factory.createArrayLiteralExpression(returnValues.map((v) => toLiteralNode(v)));
        }
        const value = plan.accessValues.get(node);
        if (value !== undefined)
            return toLiteralNode(value) ?? node;
        if (isOutOfScopeForPropagation(node) || isFunctionLikeScope(node))
            return node;
        return ts.visitEachChild(node, visit, context);
    };
    return ts.factory.updateBlock(body, survivors.map((s) => visit(s)));
}
/**
 * The top-level driver: recursively finds every function-like scope in the file (the SAME
 * recursion shape `localConstPropagationTransformer`'s own driver uses one section below — a
 * deliberate duplication, not a shared helper, since the two passes need entirely different
 * per-scope analyses) and, for each one with a `Block` body, attempts to fold away every
 * function-local `new Array(n)` construction that provably never escapes. A concise (non-Block)
 * arrow body is skipped outright — mirroring `transformFunctionLikeScopeBody`'s own early
 * return — and the cheap `containsNewArrayConstruction` gate runs BEFORE building a `shadowed`
 * set at all, so a function with no `new Array` anywhere pays only that one cheap walk.
 *
 * `shadowed` mirrors `foldTransformer`'s own `isPlainFunctionScope`/`isMethodLikeScope`
 * construction exactly: every parameter name, every `var`-hoisted name (`collectVarNames`),
 * every name `collectLexicalNamesInScope` finds anywhere in the body (crossing `if`/`while`/
 * bare-block boundaries, since the real SauceScript compiler shares scope across those — only a
 * `for` loop pushes a genuine new one), and — for a named function declaration/expression only,
 * never an arrow or a method/getter/setter, which can't reference their own key as a variable —
 * its own name.
 *
 * `wideSink` (optional — the out-of-band width-forcing meta channel `tsPartialEvalWithMeta`
 * threads through, see "Forcing uint256 element width") is handed straight to
 * `rewriteFoldedArrayBody`, which records a fingerprint there whenever it actually synthesizes a
 * literal array from a Rule 6b return-escape.
 */
function localArrayFoldTransformer(top, wideSink) {
    return (context) => {
        const visit = (node) => {
            if (isOutOfScopeForPropagation(node))
                return node;
            if (!isFunctionLikeScope(node))
                return ts.visitEachChild(node, visit, context);
            if (!node.body || !ts.isBlock(node.body) || !containsNewArrayConstruction(node.body)) {
                return ts.visitEachChild(node, visit, context);
            }
            const shadowed = new Set();
            for (const p of node.parameters)
                collectBindingNames(p.name, shadowed);
            collectVarNames(node.body, shadowed);
            collectLexicalNamesInScope(node.body, shadowed);
            if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
                shadowed.add(node.name.text);
            }
            // The ONE new authorized escape shape (`scanArrayUses` Rule 6b, `return arr;`) is gated to
            // a top-level `function main` ONLY — see the "one escaping shape that IS authorized" doc
            // note above `scanArrayUses` for the full "why" (a helper's returned array has no working
            // consumer TODAY — every read/write across the call boundary already reverts — but folding
            // it into an IMMUTABLE packed literal could regress a future fix to that PRE-EXISTING gap;
            // main's return value structurally can't have that exposure — it exits the SauceScript
            // program entirely and `main` itself is never callable). `node.name?.text === 'main'` also
            // correctly sees through `export function main() {…}` (an ordinary `FunctionDeclaration`
            // either way) and correctly excludes `const main = () => {…}` (an ArrowFunction, not a
            // FunctionDeclaration) and a method/getter/setter/accessor named `main`.
            const isMain = ts.isFunctionDeclaration(node) && node.name?.text === 'main';
            const plan = analyzeLocalArrays(node.body, shadowed, top, isMain);
            if (!plan)
                return ts.visitEachChild(node, visit, context);
            const rewritten = rewriteFoldedArrayBody(node.body, plan, context, wideSink);
            // Post-condition guard: sound BY CONSTRUCTION per the scan's own allowlist argument, but
            // cheap enough to also verify BY CHECKING — converting "sound by argument" into "sound by
            // construction" the same way `deadConstEliminationTransformer`'s own design note
            // discusses. If any deleted name still occurs anywhere in the rewritten body, the whole
            // rewrite for THIS scope is thrown away (falls back to the original, untouched node)
            // rather than ever risk handing back a dangling reference to a removed declaration. This
            // still does real work for a Rule 6b fold: the folded `return arr;` no longer mentions
            // `arr` at all once rewritten to a literal array, so a leftover occurrence of `arr`
            // ANYWHERE else in the rewritten body still throws the whole rewrite away.
            const stale = [...plan.deletedNames].some((name) => referencesIdentifier(rewritten, name));
            const newNode = stale ? node : updateFunctionLikeBody(node, rewritten);
            return ts.visitEachChild(newNode, visit, context);
        };
        return (sourceFile) => {
            const statements = sourceFile.statements.map((stmt) => visit(stmt));
            return ts.factory.updateSourceFile(sourceFile, statements);
        };
    };
}
// ── Local (per-function) constant propagation ──
//
// Everything above this point tracks only same-file TOP-LEVEL `const`s (plus effectively-const
// `let`/`var`s and array/object lookup tables — still all TOP-LEVEL). A `let`/`const` declared
// and reassigned INSIDE a function body gets none of that benefit. This is a NEW, SEPARATE pass
// closing that gap: a control-flow-sensitive (but deliberately NOT a real fixpoint dataflow —
// see the loop rule below) sequential abstract interpreter, walked fresh and independently per
// function-like scope (`FunctionDeclaration`/`FunctionExpression`/`ArrowFunction`/
// `MethodDeclaration`/`GetAccessorDeclaration`/`SetAccessorDeclaration` with a `Block` body),
// tracking a `Map<name, bigint | NAC>` ("NAC" = not a compile-time constant) per variable per
// program point and substituting a read with its known value wherever provable. It does not
// touch, duplicate, or depend on the mutable behavior of `constPropagationTransformer`/
// `deadConstEliminationTransformer`/`tableFoldTransformer` above — it only ever READS the
// same-file top-level `consts`/`functions` maps those trust, as a fallback for a name this
// pass's own function never itself declares/assigns. It runs strictly AFTER every pass above
// (last in `tsPartialEval`'s pipeline): a constant-condition `if`/a fully-unrolled loop is
// already gone from the tree, and whatever the top-level passes already substituted/eliminated
// stays exactly as they left it — this pass's own top-level fallback only ever matters for a
// read this pass's OWN evaluation can resolve in the SAME expression as a genuine local (e.g.
// `x + RATE`).
//
// Every real `tsEvalConst`/`tsEvalUnary`/`tsEvalBinary` call this pass makes uses the SAME
// 4-argument signature (`node, consts, functions, shadowed`) every other pass in this file
// uses — there is no second evaluator or lookup abstraction here, only a small per-call-site
// SNAPSHOT (`resolveLocalEnv`/`LocalResolution`, further below) of what this pass's own
// evolving `env` currently resolves each name to, expressed in exactly those 3 extra arguments.
//
// The lattice: known-bigint-value, or NAC, per variable name, per program point, tracked in a
// plain `Map<name, bigint | NAC>` — walked fresh, independently, per function-like scope with a
// Block body; a nested function-like scope encountered while walking is always an OPAQUE LEAF
// here (left completely untouched by the walk in progress) because it gets its OWN independent
// visit — a fresh environment, from scratch — from the top-level driver below. This is the
// single biggest behavioral difference from `substituteConstReads` above (which INTENTIONALLY
// recurses into a nested function body, since a top-level const's value is valid everywhere
// unshadowed): a local's value from this pass's env is only ever meaningful within the ONE
// function body currently being walked.
const NAC = Symbol('not a compile-time constant');
function resolveLocalEnv(env, top) {
    const consts = new Map(top.consts);
    const shadowed = new Set();
    for (const [name, value] of env) {
        if (value === NAC) {
            shadowed.add(name);
            // A NAC-shadowed name must never leak `top.consts`' own (stale, unrelated) value
            // through a plain map lookup — `tsEvalConst`'s Identifier/call-callee resolution
            // already checks `shadowed` before ever consulting `consts`, so this delete is
            // redundant for THOSE call sites, but `substituteLocalReads`'s identifier
            // substitution (and `evalCompoundAssignmentResult`/`walkUpdateExpr`'s "current value"
            // reads) deliberately consult `consts` alone, with no separate `shadowed` check of
            // their own — without deleting here, a same-named top-level const would otherwise
            // still resolve through the leftover `top.consts` entry, wrongly substituting the
            // OUTER value for a local this scope has already shadowed (the exact class of bug
            // fix A closes for `constPropagationTransformer`, one layer up).
            consts.delete(name);
        }
        else {
            consts.set(name, value);
        }
    }
    return { consts, functions: top.functions, shadowed };
}
/** Every name a (possibly nested/destructuring) binding introduces, marked NAC in `env` —
 * used whenever a declaration's value isn't a bare Identifier bound to a single bigint (no
 * initializer, or a destructuring pattern whose RHS this pass can't reason about anyway). */
function markNamesNac(name, env) {
    const names = new Set();
    collectBindingNames(name, names);
    for (const n of names)
        env.set(n, NAC);
}
// ── Bail conditions: skip a WHOLE function-like scope entirely, leaving it completely
// untouched (not even partially analyzed), when reasoning about it soundly would require
// more than this pass attempts. ──
/**
 * `SwitchStatement`/`TryStatement`/`LabeledStatement` (any labeled break/continue is always
 * paired with one)/`ForOfStatement`/`ForInStatement` ANYWHERE in `fn`'s own body — checked
 * WITHOUT crossing into a nested function-like scope's own body, since that scope is vetted
 * independently, on its own merits, when the top-level driver reaches it separately. None of
 * these 5 node kinds has a case in `processStatement`'s switch (`compiler/src/processor/
 * index.ts`/`statement.ts`) at all — every one throws "not implemented" downstream today —
 * so bailing on them here costs nothing: a source containing one fails to compile regardless
 * of whether this pass touches it.
 */
function containsDisallowedConstruct(node) {
    if (isOutOfScopeForPropagation(node) || isFunctionLikeScope(node))
        return false;
    if (ts.isSwitchStatement(node) ||
        ts.isTryStatement(node) ||
        ts.isLabeledStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isForInStatement(node)) {
        return true;
    }
    let found = false;
    ts.forEachChild(node, (child) => {
        if (!found && containsDisallowedConstruct(child))
            found = true;
    });
    return found;
}
/**
 * Every Identifier name referenced anywhere in `node`'s subtree that ISN'T bound by `node`'s
 * own scope chain (its parameters/lexical locals, or those of any function-like scope nested
 * inside it, tracked precisely via the SAME growing `bound` set the real JS/TS scoping rules
 * use) — i.e. its free variable names. Used ONLY to decide whether a nested function/arrow
 * closes over a name belonging to some OUTER function's local scope (the one bail condition
 * that genuinely needs this): a supported, real construct here — SauceScript resolves
 * `something.catch(handler)` (`resolveCatchChain`, compiler/src/processor/expression.ts) by
 * compiling the handler's body with `processBlock` against the SAME `CompilerContext` as its
 * surrounding code, so a handler that reads or writes an enclosing local is NOT a harmless
 * no-op the way an ordinary JS closure's mutation would be if this construct were unsupported
 * — it genuinely interacts with the outer scope at the bytecode level. Deliberately not fully
 * precise beyond that (e.g. a property-access member label or object-literal key that happens
 * to share a name with an outer local is counted as "free" too, even though it's not really a
 * variable reference) — a false positive here only means bailing a function that could
 * technically have been optimized; this pass never trades that safety margin for extra reach.
 */
function collectFreeIdentifierNames(node, bound, out) {
    if (isOutOfScopeForPropagation(node))
        return;
    if (ts.isIdentifier(node)) {
        if (!bound.has(node.text))
            out.add(node.text);
        return;
    }
    if (isFunctionLikeScope(node)) {
        const inner = new Set(bound);
        for (const p of node.parameters)
            collectBindingNames(p.name, inner);
        if (isPlainFunctionScope(node) && node.name)
            inner.add(node.name.text); // a named function expression can reference itself
        if (node.body && ts.isBlock(node.body))
            collectLexicalNamesInScope(node.body, inner);
        if (isMethodLikeScope(node) && ts.isComputedPropertyName(node.name)) {
            collectFreeIdentifierNames(node.name.expression, bound, out); // a computed key runs in the OUTER scope
        }
        if (node.body)
            collectFreeIdentifierNames(node.body, inner, out);
        return;
    }
    ts.forEachChild(node, (child) => collectFreeIdentifierNames(child, bound, out));
}
/**
 * Does ANY function-like scope reachable from `fn`'s body (at any nesting depth — a closure
 * can capture `fn`'s locals transitively, through an intermediate non-capturing nested
 * function) read or write a name belonging to `fn`'s OWN parameter/lexical-local scope? A
 * nested function-like scope that only touches ITS OWN locals and/or the outer TOP-LEVEL
 * scope is fine (not a local-closure concern) — only an overlap with `fn`'s specific local
 * names bails `fn`.
 */
function bailsForOuterClosure(fn) {
    if (!fn.body)
        return false;
    const localNames = new Set();
    for (const p of fn.parameters)
        collectBindingNames(p.name, localNames);
    if (ts.isBlock(fn.body))
        collectLexicalNamesInScope(fn.body, localNames);
    if (localNames.size === 0)
        return false;
    let bails = false;
    const scan = (node) => {
        if (bails)
            return;
        if (isFunctionLikeScope(node)) {
            const free = new Set();
            collectFreeIdentifierNames(node, new Set(), free);
            for (const name of free) {
                if (localNames.has(name)) {
                    bails = true;
                    return;
                }
            }
            return; // collectFreeIdentifierNames already recursed into any further-nested functions
        }
        ts.forEachChild(node, scan);
    };
    scan(fn.body);
    return bails;
}
function functionBails(fn) {
    if (!fn.body)
        return false;
    return containsDisallowedConstruct(fn.body) || bailsForOuterClosure(fn);
}
// ── Read/write-position-aware substitution, keyed to a `LocalResolution` snapshot instead of a
// static whole-file map — the local-propagation analogue of `substituteConstReads`/
// `visitAssignmentTarget` above. Reused for BOTH the sequential per-statement walk (called
// fresh per statement, each time reflecting `env`'s current, still-evolving state) and the
// "frozen" substitution over an entire non-unrolled loop's subtree (rule 3 below), where the
// resolution is fixed for the whole call because every name the loop could possibly write is
// already forced to NAC beforehand — in neither case does this substitution step itself ever
// mutate anything; env mutation is entirely the sequential walker's/loop rule's job. ──
/** Recurse into an ASSIGNMENT TARGET or update-expression OPERAND — mirrors
 * `visitAssignmentTarget`'s exact node-kind dispatch (never substituting the bound
 * identifier(s) themselves, but substituting any genuine READ nested inside: a computed
 * member-access key, a destructuring default value), just reading through this pass's
 * `LocalResolution` instead of the top-level pass's static `consts` map. */
function visitLocalAssignmentTarget(node, resolution, context) {
    const read = (n) => substituteLocalReads(n, resolution, context);
    const target = (n) => visitLocalAssignmentTarget(n, resolution, context);
    if (ts.isParenthesizedExpression(node)) {
        return ts.factory.updateParenthesizedExpression(node, target(node.expression));
    }
    if (ts.isIdentifier(node) || ts.isOmittedExpression(node))
        return node; // the write target itself, never a read
    if (ts.isPropertyAccessExpression(node)) {
        return ts.factory.updatePropertyAccessExpression(node, read(node.expression), node.name);
    }
    if (ts.isElementAccessExpression(node)) {
        return ts.factory.updateElementAccessExpression(node, read(node.expression), read(node.argumentExpression));
    }
    if (ts.isArrayLiteralExpression(node)) {
        return ts.factory.updateArrayLiteralExpression(node, node.elements.map((el) => ts.isSpreadElement(el) ? ts.factory.updateSpreadElement(el, target(el.expression)) : target(el)));
    }
    if (ts.isObjectLiteralExpression(node)) {
        return ts.factory.updateObjectLiteralExpression(node, node.properties.map((prop) => {
            if (ts.isShorthandPropertyAssignment(prop)) {
                return prop.objectAssignmentInitializer
                    ? ts.factory.updateShorthandPropertyAssignment(prop, prop.name, read(prop.objectAssignmentInitializer))
                    : prop;
            }
            if (ts.isPropertyAssignment(prop)) {
                const name = ts.isComputedPropertyName(prop.name)
                    ? ts.factory.updateComputedPropertyName(prop.name, read(prop.name.expression))
                    : prop.name;
                return ts.factory.updatePropertyAssignment(prop, name, target(prop.initializer));
            }
            if (ts.isSpreadAssignment(prop))
                return ts.factory.updateSpreadAssignment(prop, target(prop.expression));
            return prop;
        }));
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        return ts.factory.updateBinaryExpression(node, target(node.left), node.operatorToken, read(node.right));
    }
    return node;
}
function substituteLocalReads(node, resolution, context) {
    const visit = (n) => substituteLocalReads(n, resolution, context);
    if (isOutOfScopeForPropagation(node))
        return node;
    // A nested function/arrow/method/accessor is always an OPAQUE LEAF here — see this
    // section's own header comment above for why (it is independently visited elsewhere).
    if (isFunctionLikeScope(node))
        return node;
    if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATOR_TOKENS.has(node.operatorToken.kind)) {
        return ts.factory.updateBinaryExpression(node, visitLocalAssignmentTarget(node.left, resolution, context), node.operatorToken, visit(node.right));
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        const operand = visitLocalAssignmentTarget(node.operand, resolution, context);
        return ts.isPrefixUnaryExpression(node)
            ? ts.factory.updatePrefixUnaryExpression(node, operand)
            : ts.factory.updatePostfixUnaryExpression(node, operand);
    }
    if (ts.isConditionalExpression(node)) {
        // Mirrors `foldTransformer`'s own dedicated ternary-handling branch one layer up
        // (module scope) — see its `ts.isConditionalExpression` case: evaluate ONLY
        // `.condition`, through this pass's own `LocalResolution` (a local variable this
        // pass tracks, not necessarily a same-file top-level const `foldTransformer` could
        // ever have resolved), and if it resolves to a known bigint, structurally replace
        // the WHOLE ternary with whichever branch was selected — recursed through this SAME
        // substitution (`visit`), so a nested ternary in the taken branch (or any other
        // locally-known identifier) also resolves, cascading. If the condition does NOT
        // resolve (a genuine runtime unknown — a parameter — or a dependency this pass has
        // already forced NAC, e.g. a name written inside a loop), fall through to rewriting
        // `.condition`/`.whenTrue`/`.whenFalse` each independently: the ternary's own branch
        // structure is never collapsed on a genuinely runtime-conditioned ternary, but any
        // locally-known identifier still inside it is substituted, exactly matching every
        // other "can't prove it, don't guess" rule already in this pass.
        const condition = tsEvalConst(node.condition, resolution.consts, resolution.functions, resolution.shadowed);
        if (condition !== undefined)
            return visit(condition !== 0n ? node.whenTrue : node.whenFalse);
        return ts.factory.updateConditionalExpression(node, visit(node.condition), node.questionToken, visit(node.whenTrue), node.colonToken, visit(node.whenFalse));
    }
    if (ts.isIdentifier(node)) {
        // `resolution.consts` already omits every name this scope tracks WITHOUT a known value
        // (see `resolveLocalEnv`), so a plain map lookup alone is enough — no separate `shadowed`
        // check needed here, unlike `tsEvalConst`'s Identifier case (which also has to gate a
        // CALL-callee lookup through the same `shadowed` set; substitution never calls anything).
        const value = resolution.consts.get(node.text);
        return value === undefined ? node : (toLiteralNode(value) ?? node);
    }
    if (ts.isPropertyAccessExpression(node)) {
        return ts.factory.updatePropertyAccessExpression(node, visit(node.expression), node.name);
    }
    if (ts.isElementAccessExpression(node)) {
        return ts.factory.updateElementAccessExpression(node, visit(node.expression), visit(node.argumentExpression));
    }
    if (ts.isShorthandPropertyAssignment(node)) {
        if (!node.objectAssignmentInitializer) {
            const value = resolution.consts.get(node.name.text);
            const literal = value !== undefined ? toLiteralNode(value) : undefined;
            if (literal)
                return ts.factory.createPropertyAssignment(node.name, literal);
        }
        return node;
    }
    if (ts.isPropertyAssignment(node)) {
        const name = ts.isComputedPropertyName(node.name)
            ? ts.factory.updateComputedPropertyName(node.name, visit(node.name.expression))
            : node.name;
        return ts.factory.updatePropertyAssignment(node, name, visit(node.initializer));
    }
    if (ts.isVariableDeclaration(node)) {
        return ts.factory.updateVariableDeclaration(node, node.name, // a binding name is never a read
        node.exclamationToken, node.type, node.initializer ? visit(node.initializer) : undefined);
    }
    if (ts.isBindingElement(node)) {
        return ts.factory.updateBindingElement(node, node.dotDotDotToken, node.propertyName, node.name, node.initializer ? visit(node.initializer) : undefined);
    }
    if (ts.isParameter(node) || ts.isCatchClause(node))
        return node; // defensive no-op; not a shape this pass reaches in practice
    return ts.visitEachChild(node, visit, context);
}
/** Does `expr` contain any Identifier at all (not crossing into a nested function-like
 * scope, which is opaque anyway)? Used by `foldOrSubstitute` to decide whether replacing the
 * WHOLE expression with a freshly-built literal node is actually doing something (resolving
 * a genuine variable read) versus merely reconstructing an already-fully-literal expression —
 * `toLiteralNode` always emits a canonical BigInt literal for a bigint value, so blindly
 * replacing e.g. a plain `2` (a NumericLiteral — SauceScript source may still write bare
 * numbers pre-strip) with `2n` even when there was no read to fold would silently change a
 * declaration's own literal kind for no reason every time this pass touches a function body,
 * which is both gratuitous and, for a NumericLiteral specifically, an observably different
 * node (a real regression risk this pass must not introduce just by existing in the pipeline).
 */
function containsIdentifier(node) {
    if (ts.isIdentifier(node))
        return true;
    if (isOutOfScopeForPropagation(node) || isFunctionLikeScope(node))
        return false;
    let found = false;
    ts.forEachChild(node, (child) => {
        if (!found && containsIdentifier(child))
            found = true;
    });
    return found;
}
/**
 * `tsEvalConst`, bridged to also resolve a `ConditionalExpression` this pass's OWN local
 * reasoning can decide — needed because `tsEvalConst`/`tsEvalUnary`/`tsEvalBinary` have NO
 * case for `ts.isConditionalExpression` anywhere (by design; see the "TWO evaluators" note
 * near the top of this file — a ternary's mainstream path folds via `foldTransformer`'s own
 * separate, MODULE-scope visitor branch instead, which this per-function pass has no
 * equivalent of on its own). Rather than duplicating `tsEvalConst`'s entire dispatch a second
 * time just to teach it one more node kind, this is a thin bridge: try the ordinary evaluator
 * first (the common, ternary-free case — unchanged, just as cheap as before this existed),
 * and only if THAT fails, hand `expr` to `substituteLocalReads` (which structurally COLLAPSES
 * any resolvable `ConditionalExpression` it finds anywhere inside — see its own dedicated
 * case, mirroring `foldTransformer`'s) and re-attempt the ordinary evaluator on the result.
 * This is also what makes a ternary NESTED inside a larger expression resolve (`(cond ? 2n :
 * 3n) + 1n`, never itself the whole expression) — `substituteLocalReads` collapses the
 * ternary down to its selected branch first, and the arithmetic AROUND it then folds
 * normally on this second attempt, exactly as if the source had spelled the taken branch
 * directly.
 */
function evalLocalConst(expr, resolution, context) {
    const direct = tsEvalConst(expr, resolution.consts, resolution.functions, resolution.shadowed);
    if (direct !== undefined)
        return direct;
    const collapsed = substituteLocalReads(expr, resolution, context);
    return tsEvalConst(collapsed, resolution.consts, resolution.functions, resolution.shadowed);
}
/**
 * Tries to fully resolve `expr` to a single compile-time bigint (via `evalLocalConst`, so a
 * PARTIALLY-known expression like `x + f()` still correctly fails closed rather than
 * half-folding — this also means a call to an eligible same-file top-level function
 * (`tsEvalCall`) now folds here too when its arguments resolve through this scope's own
 * locals, e.g. `let y = double(x);` once `x` is a known local — a natural, sound extension of
 * reusing the SAME evaluator family, not a separate capability this pass builds itself; and,
 * via `evalLocalConst`, a `ConditionalExpression` whose condition this pass's own local
 * reasoning can resolve, cascading into a nested ternary in the taken branch); if it can't,
 * falls back to substituting whatever individual reads WITHIN it are still resolvable (`x`
 * alone, leaving the opaque `f()` call untouched, or a genuinely runtime-conditioned ternary's
 * own sub-parts) — this is rule 1's "a read of a bare identifier at any point substitutes...
 * else left untouched", applied uniformly whether or not the ENCLOSING expression as a whole
 * turns out to be foldable. An expression that resolves to a bigint WITHOUT containing any
 * Identifier at all (already a bare literal, e.g. `1n` or a plain `2 + 3` — the latter already
 * collapsed by `foldTransformer`, which runs before this pass, so in practice this is almost
 * always just a bare literal by the time it gets here) is deliberately left completely
 * untouched rather than "canonicalized" — see `containsIdentifier`'s own comment for why that
 * specific rewrite is unsafe to do unconditionally.
 */
function foldOrSubstitute(expr, resolution, context) {
    const value = evalLocalConst(expr, resolution, context);
    if (value !== undefined) {
        if (!containsIdentifier(expr))
            return { expr, value };
        const literal = toLiteralNode(value);
        if (literal)
            return { expr: literal, value };
    }
    return { expr: substituteLocalReads(expr, resolution, context), value: undefined };
}
/** The resulting value of `expr.left` after a compound assignment (`+=`, `&=`, …) — mirrors
 * `tsEvalBinary`'s operator switch one level up, since `tsEvalConst` itself has no case for
 * any assignment-family token (by design — see `ASSIGNMENT_OPERATOR_TOKENS`). `&&=`/`||=`/
 * `??=`/`>>>=` are not modeled (short-circuit-assignment semantics, and bigint has no `>>>`
 * at all) — always NAC, which is always safe. The RHS is resolved via `evalLocalConst` (the
 * SAME bridge `foldOrSubstitute` uses for a plain-assignment RHS), not a bare `tsEvalConst`
 * call — so a ternary RHS whose condition this pass's own local reasoning can resolve (e.g.
 * `x += cond ? 1n : 2n;`) also updates the TRACKED value here, matching what
 * `substituteLocalReads` already collapses in the emitted code for the same RHS one level up
 * in `walkAssignmentExpr`. Before this, the printed code and the tracked value could disagree
 * (the emitted `x += 1n;` was correct, but a subsequent read of `x` stayed NAC) — sound (never
 * a wrong VALUE), but a needlessly missed fold. */
function evalCompoundAssignmentResult(expr, resolution, context) {
    if (!ts.isIdentifier(expr.left))
        return undefined;
    const current = resolution.consts.get(expr.left.text);
    if (current === undefined)
        return undefined;
    const rhs = evalLocalConst(expr.right, resolution, context);
    if (rhs === undefined)
        return undefined;
    switch (expr.operatorToken.kind) {
        case ts.SyntaxKind.PlusEqualsToken:
            return current + rhs;
        case ts.SyntaxKind.MinusEqualsToken:
            return current - rhs;
        case ts.SyntaxKind.AsteriskEqualsToken:
            return current * rhs;
        case ts.SyntaxKind.SlashEqualsToken:
            return rhs === 0n ? undefined : current / rhs;
        case ts.SyntaxKind.PercentEqualsToken:
            return rhs === 0n ? undefined : current % rhs;
        case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
            return rhs < 0n ? undefined : current ** rhs;
        case ts.SyntaxKind.AmpersandEqualsToken:
            return current & rhs;
        case ts.SyntaxKind.BarEqualsToken:
            return current | rhs;
        case ts.SyntaxKind.CaretEqualsToken:
            return current ^ rhs;
        case ts.SyntaxKind.LessThanLessThanEqualsToken:
            return current << rhs;
        case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
            return current >> rhs;
        default:
            return undefined;
    }
}
// ── The sequential per-statement walk (rule 1) + if/else merge (rule 2) + loop rule (rule 3) ──
function walkAssignmentExpr(expr, env, resolution, context) {
    const isPlainAssign = expr.operatorToken.kind === ts.SyntaxKind.EqualsToken;
    let newRight;
    let value;
    if (isPlainAssign) {
        const folded = foldOrSubstitute(expr.right, resolution, context);
        newRight = folded.expr;
        value = folded.value;
    }
    else {
        newRight = substituteLocalReads(expr.right, resolution, context);
        value = evalCompoundAssignmentResult(expr, resolution, context);
    }
    if (ts.isIdentifier(expr.left)) {
        env.set(expr.left.text, value ?? NAC);
    }
    else {
        // A destructuring assignment target (`[x] = ...`, `({x} = ...)`) — not currently
        // reachable through the real compiler (`processAssignmentMutation` throws "not
        // implemented" for any target that isn't a bare Identifier/MemberExpression today), but
        // fail closed here regardless rather than silently keep a stale tracked value: every
        // scalar name the target writes becomes NAC, mirroring rule 3's loop-write pre-scan
        // (`collectAssignmentTargetNames` is the same helper that feeds it).
        const written = new Set();
        collectAssignmentTargetNames(expr.left, written);
        for (const name of written)
            env.set(name, NAC);
    }
    const newLeft = visitLocalAssignmentTarget(expr.left, resolution, context);
    return ts.factory.updateBinaryExpression(expr, newLeft, expr.operatorToken, newRight);
}
function walkUpdateExpr(expr, env, resolution, context) {
    if (ts.isIdentifier(expr.operand)) {
        const current = resolution.consts.get(expr.operand.text);
        const next = current === undefined ? undefined : expr.operator === ts.SyntaxKind.PlusPlusToken ? current + 1n : current - 1n;
        env.set(expr.operand.text, next ?? NAC);
    }
    const newOperand = visitLocalAssignmentTarget(expr.operand, resolution, context);
    return ts.isPrefixUnaryExpression(expr)
        ? ts.factory.updatePrefixUnaryExpression(expr, newOperand)
        : ts.factory.updatePostfixUnaryExpression(expr, newOperand);
}
function walkExpressionStatementExpr(expr, env, top, context) {
    // Unwrap a leading ParenthesizedExpression BEFORE checking for the assignment/update
    // shapes below — an object-destructuring ASSIGNMENT used as a statement (`({ x } = obj);`)
    // MUST be parenthesized in real JS (the parser would otherwise read a leading `{` as a
    // block statement), so this is not a rare edge case: without unwrapping first, `expr` here
    // is the ParenthesizedExpression, `ts.isBinaryExpression(expr)` is false, and the actual
    // assignment inside is never routed through `walkAssignmentExpr` at all — its target
    // never invalidates `env`, silently keeping a STALE tracked value alive past the
    // reassignment. Recursing (rather than a single unwrap) also correctly handles the
    // (rarer) doubly-parenthesized `((x) = 1);` shape, and rebuilds the exact same paren
    // nesting depth in the output.
    if (ts.isParenthesizedExpression(expr)) {
        return ts.factory.updateParenthesizedExpression(expr, walkExpressionStatementExpr(expr.expression, env, top, context));
    }
    const resolution = resolveLocalEnv(env, top);
    if (ts.isBinaryExpression(expr) && ASSIGNMENT_OPERATOR_TOKENS.has(expr.operatorToken.kind)) {
        return walkAssignmentExpr(expr, env, resolution, context);
    }
    if ((ts.isPrefixUnaryExpression(expr) || ts.isPostfixUnaryExpression(expr)) &&
        (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken)) {
        return walkUpdateExpr(expr, env, resolution, context);
    }
    return substituteLocalReads(expr, resolution, context);
}
function walkVariableDeclarator(decl, env, top, context) {
    const resolution = resolveLocalEnv(env, top);
    if (!decl.initializer) {
        markNamesNac(decl.name, env); // e.g. `let x;` — not actually compilable downstream either way, but fails closed regardless
        return decl;
    }
    if (!ts.isIdentifier(decl.name)) {
        // Destructuring (only an ArrayBindingPattern is meaningfully supported downstream, via
        // `const [a, b] = someCall()`) — the RHS is always a call this evaluator can't resolve to
        // a bigint anyway, so every bound name is simply marked NAC; still substitute genuine
        // reads inside the initializer itself (e.g. a computed index expression).
        markNamesNac(decl.name, env);
        return ts.factory.updateVariableDeclaration(decl, decl.name, decl.exclamationToken, decl.type, substituteLocalReads(decl.initializer, resolution, context));
    }
    const folded = foldOrSubstitute(decl.initializer, resolution, context);
    env.set(decl.name.text, folded.value ?? NAC);
    return ts.factory.updateVariableDeclaration(decl, decl.name, decl.exclamationToken, decl.type, folded.expr);
}
/** The "then"/"else" of an `if`, or a loop body when it IS a single (non-Block) statement —
 * JS allows omitting braces for a single nested statement. */
function walkNestedStatement(stmt, env, top, context) {
    if (ts.isBlock(stmt)) {
        return ts.factory.updateBlock(stmt, walkStatementList(stmt.statements, env, top, context));
    }
    return walkStatement(stmt, env, top, context);
}
/**
 * Rule 2: visit `then` from a COPY of the current env, `else` (or, if absent, an UNTOUCHED
 * second copy — the branch that never executes implicitly keeps the pre-if value, exactly
 * like a branch that executes but never reassigns a given name) from ANOTHER COPY, then merge
 * at the join point. The merge only ever considers names ALREADY tracked before the `if`
 * (iterating `env`'s own pre-if keys) — a name a branch freshly declares (block-scoped to
 * that branch alone, since `var` doesn't exist in this language) is correctly never carried
 * past the `if`, without needing any extra bookkeeping: it simply isn't one of the keys this
 * loop iterates. Nested/else-if `if`s and arbitrarily deep block nesting fall out of this
 * function's own recursion via `walkNestedStatement` → `walkStatement` → `walkIfStatement`,
 * with no separate handling needed. A condition that's ALREADY a resolved compile-time
 * constant never reaches this function in the first place — `foldTransformer` (which runs
 * strictly before this whole pass) has already pruned that `if` down to its taken branch; a
 * condition this pass's OWN local tracking could newly resolve (e.g. depending on a local
 * variable `foldTransformer` could never have seen) is deliberately NOT given the same
 * branch-pruning treatment here — both branches are still walked and merged unconditionally,
 * which is simply a MISSED optimization opportunity (never an unsound one), matching this
 * pass's overall preference for under- over over-optimizing.
 */
function walkIfStatement(stmt, env, top, context) {
    const resolution = resolveLocalEnv(env, top);
    const newCondition = foldOrSubstitute(stmt.expression, resolution, context).expr;
    const thenEnv = new Map(env);
    const newThen = walkNestedStatement(stmt.thenStatement, thenEnv, top, context);
    const elseEnv = new Map(env);
    const newElse = stmt.elseStatement ? walkNestedStatement(stmt.elseStatement, elseEnv, top, context) : undefined;
    for (const [name, preIfValue] of env) {
        const thenValue = thenEnv.get(name) ?? preIfValue;
        const elseValue = elseEnv.get(name) ?? preIfValue;
        env.set(name, thenValue !== NAC && thenValue === elseValue ? thenValue : NAC);
    }
    return ts.factory.updateIfStatement(stmt, newCondition, newThen, newElse);
}
/** Every name written ANYWHERE within `node` (any assignment/compound-assignment/update/
 * declaration), WITHOUT crossing into a nested function-like scope (a separate variable
 * scope, already vetted independently by the closure-bail check before rule 3 ever runs) —
 * the pre-scan rule 3 needs to force every such name to NAC before processing a real
 * (non-unrolled) loop. A write through a property/element-access target (`arr[i] = x`,
 * `obj.x = x`) is deliberately NOT collected here: it doesn't reassign the BINDING `arr`/
 * `obj` itself (only whatever it points at), and — since this pass only ever tracks scalar
 * bigint values — any array/heap-shaped local is already NAC from its own declaration
 * onward regardless (`new Array(n)`/an array literal never resolves via `tsEvalConst`), so
 * there is nothing this rule needs to additionally poison for that case. */
function collectWrittenNames(node, out) {
    if (isFunctionLikeScope(node))
        return;
    if (ts.isVariableDeclaration(node)) {
        collectBindingNames(node.name, out);
    }
    else if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATOR_TOKENS.has(node.operatorToken.kind)) {
        collectAssignmentTargetNames(node.left, out);
    }
    else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
        collectAssignmentTargetNames(node.operand, out);
    }
    ts.forEachChild(node, (child) => collectWrittenNames(child, out));
}
/** The scalar binding name(s) an assignment/update TARGET reassigns — mirrors
 * `visitAssignmentTarget`'s node-kind dispatch, collecting names instead of substituting. */
function collectAssignmentTargetNames(node, out) {
    if (ts.isParenthesizedExpression(node)) {
        collectAssignmentTargetNames(node.expression, out);
        return;
    }
    if (ts.isIdentifier(node)) {
        out.add(node.text);
        return;
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isOmittedExpression(node)) {
        return; // reassigns whatever the target points at, not the binding itself — see collectWrittenNames' own note
    }
    if (ts.isArrayLiteralExpression(node)) {
        for (const el of node.elements) {
            collectAssignmentTargetNames(ts.isSpreadElement(el) ? el.expression : el, out);
        }
        return;
    }
    if (ts.isObjectLiteralExpression(node)) {
        for (const prop of node.properties) {
            if (ts.isShorthandPropertyAssignment(prop))
                out.add(prop.name.text);
            else if (ts.isPropertyAssignment(prop))
                collectAssignmentTargetNames(prop.initializer, out);
            else if (ts.isSpreadAssignment(prop))
                collectAssignmentTargetNames(prop.expression, out);
        }
        return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        collectAssignmentTargetNames(node.left, out);
    }
}
function walkForInitializer(init, resolution, context) {
    if (ts.isVariableDeclarationList(init)) {
        return ts.factory.updateVariableDeclarationList(init, init.declarations.map((d) => substituteLocalReads(d, resolution, context)));
    }
    return substituteLocalReads(init, resolution, context);
}
/**
 * Rule 3: a `for`/`while`/`do-while` the existing loop-unroller did NOT fully unroll (still
 * real runtime code, `JUMP_BACK`, by the time this pass sees it) gets NO fixpoint dataflow —
 * bigint values are an unbounded lattice, and real fixpoint iteration needs a widening
 * operator plus a termination proof, far more machinery than this warrants. Instead: force
 * every name `collectWrittenNames` finds anywhere in the loop to NAC BEFORE looking at
 * anything else, then substitute reads through the ENTIRE loop subtree (init/condition/
 * incrementor/body, including any nested if/inner loop within it) using that single now-
 * frozen resolution — no further env mutation happens while inside, and nothing needs a
 * branch-merge the way `walkIfStatement` does, because every name that could possibly differ
 * across iterations or branches inside the loop is already uniformly NAC. This is why a
 * written name is NAC even at "the first reference before any write appears textually": a
 * later iteration's write could have already happened by the time control reaches any given
 * point inside the loop body, so there is no textually-first-safe point to trust the
 * pre-loop value. Untouched names simply keep flowing through unchanged — this necessarily
 * MISSES a loop-invariant-but-reassigned-to-the-same-value case (e.g. `for (...) { sum =
 * 100n; }` where `sum` was already `100n`) — an intentional, documented tradeoff, not an
 * oversight. The mutated `env` (written names now NAC) is also exactly what continues the
 * walk for whatever comes AFTER the loop, in the same statement list.
 */
function walkLoopStatement(stmt, env, top, context) {
    const written = new Set();
    collectWrittenNames(stmt, written);
    for (const name of written)
        env.set(name, NAC);
    const resolution = resolveLocalEnv(env, top);
    if (ts.isForStatement(stmt)) {
        const newInit = stmt.initializer ? walkForInitializer(stmt.initializer, resolution, context) : undefined;
        const newCondition = stmt.condition
            ? substituteLocalReads(stmt.condition, resolution, context)
            : undefined;
        const newIncrementor = stmt.incrementor
            ? substituteLocalReads(stmt.incrementor, resolution, context)
            : undefined;
        const newBody = substituteLocalReads(stmt.statement, resolution, context);
        return ts.factory.updateForStatement(stmt, newInit, newCondition, newIncrementor, newBody);
    }
    if (ts.isWhileStatement(stmt)) {
        const newCondition = substituteLocalReads(stmt.expression, resolution, context);
        const newBody = substituteLocalReads(stmt.statement, resolution, context);
        return ts.factory.updateWhileStatement(stmt, newCondition, newBody);
    }
    const newBody = substituteLocalReads(stmt.statement, resolution, context);
    const newCondition = substituteLocalReads(stmt.expression, resolution, context);
    return ts.factory.updateDoStatement(stmt, newBody, newCondition);
}
function walkStatement(stmt, env, top, context) {
    if (ts.isVariableStatement(stmt)) {
        return ts.factory.updateVariableStatement(stmt, stmt.modifiers, ts.factory.updateVariableDeclarationList(stmt.declarationList, stmt.declarationList.declarations.map((decl) => walkVariableDeclarator(decl, env, top, context))));
    }
    if (ts.isExpressionStatement(stmt)) {
        return ts.factory.updateExpressionStatement(stmt, walkExpressionStatementExpr(stmt.expression, env, top, context));
    }
    if (ts.isIfStatement(stmt))
        return walkIfStatement(stmt, env, top, context);
    if (ts.isForStatement(stmt) || ts.isWhileStatement(stmt) || ts.isDoStatement(stmt)) {
        return walkLoopStatement(stmt, env, top, context);
    }
    if (ts.isReturnStatement(stmt)) {
        if (!stmt.expression)
            return stmt;
        const resolution = resolveLocalEnv(env, top);
        return ts.factory.updateReturnStatement(stmt, foldOrSubstitute(stmt.expression, resolution, context).expr);
    }
    if (ts.isThrowStatement(stmt)) {
        const resolution = resolveLocalEnv(env, top);
        return ts.factory.updateThrowStatement(stmt, foldOrSubstitute(stmt.expression, resolution, context).expr);
    }
    // BreakStatement/ContinueStatement/EmptyStatement (nothing to substitute), or any other
    // statement shape this pass doesn't specifically model — left completely untouched rather
    // than guess, matching this file's fail-closed philosophy throughout.
    return stmt;
}
/**
 * Reserves every name this (immediate — not a further-nested block's) statement list
 * directly declares for the WHOLE list from the top, matching real `let`/`const` TDZ scoping:
 * a read of such a name textually before its own declaration line must NOT fall through to
 * an outer/top-level value of the same name (that would silently substitute the WRONG value
 * for what real JS treats as a ReferenceError) — pre-seeding NAC here and letting each
 * declaration's own statement overwrite it in place, in order, achieves exactly that without
 * a separate "shadowed names" concept: `resolveLocalEnv` already refuses to fall back past an
 * env key that's present, NAC or not.
 */
function walkStatementList(statements, env, top, context) {
    const declaredHere = new Set();
    collectDirectlyDeclaredNames(statements, declaredHere);
    for (const name of declaredHere)
        env.set(name, NAC);
    return statements.map((stmt) => walkStatement(stmt, env, top, context));
}
function updateFunctionLikeBody(node, body) {
    if (ts.isFunctionDeclaration(node)) {
        return ts.factory.updateFunctionDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
    }
    if (ts.isFunctionExpression(node)) {
        return ts.factory.updateFunctionExpression(node, node.modifiers, node.asteriskToken, node.name, node.typeParameters, node.parameters, node.type, body);
    }
    if (ts.isArrowFunction(node)) {
        return ts.factory.updateArrowFunction(node, node.modifiers, node.typeParameters, node.parameters, node.type, node.equalsGreaterThanToken, body);
    }
    if (ts.isMethodDeclaration(node)) {
        return ts.factory.updateMethodDeclaration(node, node.modifiers, node.asteriskToken, node.name, node.questionToken, node.typeParameters, node.parameters, node.type, body);
    }
    if (ts.isGetAccessorDeclaration(node)) {
        return ts.factory.updateGetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, node.type, body);
    }
    return ts.factory.updateSetAccessorDeclaration(node, node.modifiers, node.name, node.parameters, body);
}
/** ASSUMES the caller already confirmed `!functionBails(node)` — performs the actual walk,
 * fresh `env` seeded with every parameter marked NAC (runtime-supplied, never a compile-time
 * constant), and swaps in the substituted body. A concise (non-Block) arrow body has no
 * statement list of its own for this pass to walk (nothing to do — it's still eligible to be
 * independently found elsewhere in the file by the top-level driver's own recursion). */
function transformFunctionLikeScopeBody(node, top, context) {
    if (!node.body || !ts.isBlock(node.body))
        return node;
    const env = new Map();
    for (const p of node.parameters)
        markNamesNac(p.name, env);
    // Pre-seed NAC for every name lexically (`let`/`const`/nested-function) declared ANYWHERE in
    // this function's body — not just this statement list's own DIRECT declarations (which is
    // all `walkStatementList`'s own per-list pre-seed below sees) — because the real SauceScript
    // compiler shares scope across `if`/`while`/bare-block bodies (only a `for` loop pushes a
    // genuine new one; see `processor/statement.ts`'s `processIfStatement`/
    // `processWhileStatement`, neither of which calls `ctx.pushScope`, versus
    // `processForStatement`, which does). A name FIRST `let`/`const`-declared inside an
    // `if`/`while` branch therefore isn't block-scoped away once the branch ends — it's the
    // SAME persisting variable for the rest of the function — so without this pre-seed,
    // `walkIfStatement`'s merge (which only ever revisits names already keyed in `env` BEFORE
    // the `if`) would never see such a name, and a later read of it would incorrectly fall
    // through to a same-named top-level `const`'s value instead of staying an (unsubstituted)
    // real runtime read. This over-includes a name declared only inside a real (non-unrolled)
    // `for` loop's own body too (this pass doesn't need the finer distinction) — always safe:
    // it can only cost a MISSED optimization (an unsubstituted read the real compiler still
    // resolves correctly via its own `getVar`-then-`getConstant` lookup), never a wrong one.
    const lexicalNames = new Set();
    collectLexicalNamesInScope(node.body, lexicalNames);
    for (const name of lexicalNames)
        env.set(name, NAC);
    const newStatements = walkStatementList(node.body.statements, env, top, context);
    return updateFunctionLikeBody(node, ts.factory.updateBlock(node.body, newStatements));
}
/**
 * The top-level driver: recursively finds every function-like scope in the file (top-level
 * or nested — inside an object literal, another function, a `.catch()` handler, …) and
 * transforms each one INDEPENDENTLY, with its own fresh environment, unless the WHOLE scope
 * bails (in which case it — and, deliberately, anything nested inside it too, since bailing
 * means "leave this subtree completely untouched" — is left exactly as found, and this driver
 * does not descend into it looking for nested opportunities). Classes are skipped entirely
 * (`isOutOfScopeForPropagation`, matching every other pass in this file) since this language
 * surface has none ("no closures/classes/async" per the compiler's own scope).
 */
function localConstPropagationTransformer(top) {
    return (context) => {
        const visit = (node) => {
            if (isOutOfScopeForPropagation(node))
                return node;
            if (isFunctionLikeScope(node)) {
                if (functionBails(node))
                    return node;
                const transformed = transformFunctionLikeScopeBody(node, top, context);
                return ts.visitEachChild(transformed, visit, context);
            }
            return ts.visitEachChild(node, visit, context);
        };
        return (sourceFile) => {
            const statements = sourceFile.statements.map((stmt) => visit(stmt));
            return ts.factory.updateSourceFile(sourceFile, statements);
        };
    };
}
export function tsPartialEvalWithMeta(code, filePath) {
    const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const functions = collectTopLevelFunctions(sourceFile);
    const { consts, primaryNames, pairNames } = analyzeTopLevelConsts(sourceFile, functions);
    // Table candidacy + the whole-file soundness scan run on the ORIGINAL, pre-fold source: a
    // disqualifying use must count even if it sits in a branch `foldTransformer` would otherwise
    // prune away (see the "Array/object lookup-table folding" section above).
    const tables = collectTopLevelTables(sourceFile, consts, functions);
    const topLevelContext = { consts, functions };
    const wideReturnArrays = new Set();
    const result = ts.transpileModule(code, {
        fileName: filePath,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        transformers: {
            before: [
                foldTransformer(consts, functions),
                // Runs AFTER foldTransformer so an index/key that only becomes a literal once a loop
                // unrolls (e.g. `TABLE[i]` inside a `for` that unrolls `i` to a literal per iteration)
                // is still resolvable.
                tableFoldTransformer(tables, consts, functions),
                constPropagationTransformer(consts),
                deadConstEliminationTransformer(consts, primaryNames, pairNames, tables),
                // Stage 5 of 6 — see the "Local `new Array(n)` construction folding" section above for
                // why this runs AFTER every top-level-scoped pass above (a write value may read a table/
                // top-level const only THEY resolve) but strictly BEFORE the local scalar pass below (a
                // folded element read is what lets THAT pass finish an accumulator all the way to a
                // literal — the reverse order would leave it NAC). `wideReturnArrays` is populated here,
                // in place, whenever Rule 6b actually fires (see `rewriteFoldedArrayBody`).
                localArrayFoldTransformer(topLevelContext, wideReturnArrays),
                // Runs LAST, consuming everything above's output: a control-flow-sensitive, LOCAL
                // (per-function) constant propagation — see the "Local (per-function) constant
                // propagation" section above for the full design.
                localConstPropagationTransformer(topLevelContext),
            ],
        },
    });
    return { text: result.outputText, wideReturnArrays };
}
/**
 * Fold provably-constant branches/expressions/loops in a `.ts`/`.sauce.ts` module and
 * strip types, returning plain JS text ready for `acorn.parse`. Pure function of its input
 * text. A thin, signature-preserving wrapper over `tsPartialEvalWithMeta` — see there for the
 * width-forcing meta channel this drops.
 */
export function tsPartialEval(code, filePath) {
    return tsPartialEvalWithMeta(code, filePath).text;
}
