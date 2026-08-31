import type { Program, Statement, FunctionDeclaration } from 'acorn';
export interface InlineFnEntry {
    params: string[];
    /** Normalized statement list — a concise `=> expr` body becomes `[ReturnStatement(expr)]`. */
    body: Statement[];
}
/**
 * Top-level `const NAME = (params) => body` (and `export const …`) declarations in ONE
 * program/module — the arrow-function convention that marks NAME as inline. A top-level
 * `const` whose initializer is NOT an arrow function is ignored here (it's an ordinary
 * compile-time constant, handled by registerTopLevelConsts).
 */
export declare function extractInlineDeclarations(program: Program): Map<string, InlineFnEntry>;
/**
 * Fail-closed structural validation of an inline function's body: an EXPLICIT allow-list
 * of statement shapes (VariableDeclaration with a plain identifier target, IfStatement,
 * ReturnStatement, ExpressionStatement, ThrowStatement) — anything else (a loop, switch,
 * try/catch, labeled/bare-block statement, destructuring declaration, nested function)
 * is rejected with a clear compile error rather than silently mishandled.
 */
export declare function validateInlineable(name: string, stmts: Statement[]): void;
/**
 * Reject any inline function that is directly or (transitively/mutually) recursive —
 * INCLUDING a cycle that passes through one or more intervening REAL functions
 * (inline A calls real B, B calls back into A: A's own un-expanded body gets spliced
 * into every call site that reaches it, including the one inside B, so B's compiled
 * body ends up containing a call back to itself — genuine unbounded runtime
 * recursion). `realFnBodies` (every real, non-inline function declaration reachable in
 * this compile, keyed by name) is walked alongside `inlineMap` as one combined call
 * graph; a cycle that never touches an inline function (ordinary real-function mutual
 * recursion, e.g. `fact`) is left alone — that's an intentional, supported runtime
 * feature bounded only by gas, not a compile-time hazard specific to inlining.
 */
export declare function detectInlineRecursion(inlineMap: Map<string, InlineFnEntry>, realFnBodies?: ReadonlyMap<string, Statement[]>): void;
/**
 * Merge local (main-program) inline declarations with the ones collected from imported
 * modules, rejecting a name collision between the two, or between an inline function and
 * a REAL function declaration (local or imported) — inline functions never enter
 * `addFunc`'s function table, so that collision isn't otherwise caught downstream.
 */
export declare function buildInlineMap(program: Program, importedInlines: Map<string, InlineFnEntry>, declarations: FunctionDeclaration[]): Map<string, InlineFnEntry>;
/**
 * Run the inline-expansion pass over every declaration (main + every real function, local
 * or imported) BEFORE treeshake/v1/v12 dispatch — mutates each `decl.body.body` in place.
 * A no-op (fast path) when the program uses zero inline functions, so an unmodified
 * program compiles byte-identically to before this feature existed.
 */
export declare function expandInlineFunctionsInDeclarations(declarations: FunctionDeclaration[], inlineMap: Map<string, InlineFnEntry>): void;
//# sourceMappingURL=inline.d.ts.map