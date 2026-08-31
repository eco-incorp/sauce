import type {
  Node,
  Program,
  Statement,
  Expression,
  FunctionDeclaration,
  VariableDeclaration,
  VariableDeclarator,
  ArrowFunctionExpression,
  BlockStatement,
  IfStatement,
  ReturnStatement,
  ThrowStatement,
  ExpressionStatement,
  ForStatement,
  WhileStatement,
  CallExpression,
  MemberExpression,
  NewExpression,
  ArrayExpression,
  ObjectExpression,
  Property,
  UnaryExpression,
  BinaryExpression,
  LogicalExpression,
  ConditionalExpression,
  TaggedTemplateExpression,
  Identifier,
  Literal,
  AssignmentExpression,
  UpdateExpression,
} from 'acorn';
import { RESERVED_NAMES } from '../globals.js';
import { resolveCatchChain } from './expression.js';
import { eachChild } from './index.js';

// ── Inline (arrow-const) function expansion ──
//
// Convention: a top-level `const NAME = (params) => body;` declares NAME as an INLINE
// function — every call to it (same file, or cross-file via the existing source-import
// mechanism) is spliced into the call site's statement list at compile time, instead of
// emitting a real CALL_FUNCTION. This is a pure acorn-AST-to-acorn-AST rewrite that runs
// ONCE, before the v1/v12 fork (processor/index.ts's processProgram) — both targets then
// compile the (already-expanded) plain SauceScript completely unaware inlining happened.
//
// See CLAUDE.md ("Inline (arrow-const) functions") for the algorithm's rationale and the
// bail conditions. Loop-free guard-clause functions only (mirrors the real-world need:
// small arithmetic helpers with nested `if (cond) { return X; } ... return Y;` shapes).

export interface InlineFnEntry {
  params: string[];
  /** Normalized statement list — a concise `=> expr` body becomes `[ReturnStatement(expr)]`. */
  body: Statement[];
}

// ── extraction (shared between the main program and each imported module) ──

function isVariableDeclaration(stmt: Node): VariableDeclaration | undefined {
  if (stmt.type === 'VariableDeclaration') return stmt as VariableDeclaration;

  if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') {
    const decl = (stmt as { declaration?: Node }).declaration;

    if (decl?.type === 'VariableDeclaration') return decl as VariableDeclaration;
  }

  return undefined;
}

/**
 * Top-level `const NAME = (params) => body` (and `export const …`) declarations in ONE
 * program/module — the arrow-function convention that marks NAME as inline. A top-level
 * `const` whose initializer is NOT an arrow function is ignored here (it's an ordinary
 * compile-time constant, handled by registerTopLevelConsts).
 */
export function extractInlineDeclarations(program: Program): Map<string, InlineFnEntry> {
  const out = new Map<string, InlineFnEntry>();

  for (const stmt of program.body) {
    const decl = isVariableDeclaration(stmt);

    if (!decl || decl.kind !== 'const') continue;

    for (const d of decl.declarations) {
      if (d.id.type !== 'Identifier' || !d.init || d.init.type !== 'ArrowFunctionExpression') continue;

      const name = (d.id as Identifier).name;
      const arrow = d.init as ArrowFunctionExpression;

      if (RESERVED_NAMES.has(name)) throw new Error(`'${name}' is a reserved name`);

      if (out.has(name)) throw new Error(`duplicate inline function "${name}"`);

      const params = arrow.params.map((p) => {
        if (p.type !== 'Identifier') {
          throw new Error(
            `inline function "${name}": unsupported parameter pattern (only plain identifiers are supported)`,
          );
        }

        return (p as Identifier).name;
      });

      const body =
        arrow.body.type === 'BlockStatement'
          ? (arrow.body as BlockStatement).body
          : [makeReturn(arrow.body as Expression)];

      out.set(name, { params, body });
    }
  }

  return out;
}

// ── validation (bail conditions) ──

const ALLOWED_INLINE_STATEMENTS = new Set([
  'VariableDeclaration',
  'IfStatement',
  'ReturnStatement',
  'ExpressionStatement',
  'ThrowStatement',
]);

function bail(name: string, what: string): Error {
  return new Error(
    `cannot inline function "${name}": body contains ${what}, not supported for inlining — use a real \`function\` declaration instead`,
  );
}

/** Deep-scan an expression for a nested function/arrow — banned anywhere in an inline body. */
function assertNoNestedFunction(name: string, node: Node | null | undefined): void {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

  if (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionExpression' ||
    node.type === 'FunctionDeclaration'
  ) {
    throw bail(name, 'a nested function/arrow expression');
  }

  eachChild(node, (child) => assertNoNestedFunction(name, child));
}

/**
 * Fail-closed structural validation of an inline function's body: an EXPLICIT allow-list
 * of statement shapes (VariableDeclaration with a plain identifier target, IfStatement,
 * ReturnStatement, ExpressionStatement, ThrowStatement) — anything else (a loop, switch,
 * try/catch, labeled/bare-block statement, destructuring declaration, nested function)
 * is rejected with a clear compile error rather than silently mishandled.
 */
export function validateInlineable(name: string, stmts: Statement[]): void {
  for (const stmt of stmts) {
    if (!ALLOWED_INLINE_STATEMENTS.has(stmt.type)) throw bail(name, `a '${stmt.type}'`);

    switch (stmt.type) {
      case 'VariableDeclaration': {
        for (const d of (stmt as VariableDeclaration).declarations) {
          if (d.id.type !== 'Identifier') throw bail(name, 'a destructuring declaration');

          if (d.init) assertNoNestedFunction(name, d.init);
        }

        break;
      }
      case 'IfStatement': {
        const ifStmt = stmt as IfStatement;

        assertNoNestedFunction(name, ifStmt.test);
        validateInlineable(name, blockToStatements(ifStmt.consequent));

        if (ifStmt.alternate) validateInlineable(name, blockToStatements(ifStmt.alternate));

        break;
      }
      case 'ReturnStatement':
        assertNoNestedFunction(name, (stmt as ReturnStatement).argument);
        break;
      case 'ExpressionStatement':
        assertNoNestedFunction(name, (stmt as ExpressionStatement).expression);
        break;
      case 'ThrowStatement':
        assertNoNestedFunction(name, (stmt as ThrowStatement).argument);
        break;
    }
  }
}

// ── recursion detection (direct + mutual, INCLUDING through an intervening real function) ──

/**
 * Collect the names of every call in `body` whose callee is a bare Identifier present in
 * `knownFns` — used to walk the call graph for cycle detection. `knownFns` covers BOTH
 * inline functions and real (`function`) declarations, so a cycle that routes through a
 * real function and back into an inline function (inline A -> real B -> inline A) is
 * just as traversable as a direct inline-to-inline edge — a check limited to
 * inline-only edges would miss that shape entirely (see detectInlineRecursion).
 */
function collectKnownCallees(body: Statement[], knownFns: ReadonlyMap<string, Statement[]>): Set<string> {
  const out = new Set<string>();

  const visit = (node: Node | null | undefined): void => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

    if (node.type === 'CallExpression') {
      const callee = (node as CallExpression).callee;

      if (callee.type === 'Identifier' && knownFns.has((callee as Identifier).name)) {
        out.add((callee as Identifier).name);
      }
    }

    eachChild(node, visit);
  };

  for (const stmt of body) visit(stmt);

  return out;
}

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
export function detectInlineRecursion(
  inlineMap: Map<string, InlineFnEntry>,
  realFnBodies: ReadonlyMap<string, Statement[]> = new Map(),
): void {
  const allBodies = new Map<string, Statement[]>(realFnBodies);

  for (const [name, entry] of inlineMap) allBodies.set(name, entry.body);

  const color = new Map<string, 1 | 2>(); // 1 = in-progress (gray), 2 = done (black)
  const path: string[] = [];

  const visit = (name: string): void => {
    const c = color.get(name);

    if (c === 2) return;

    if (c === 1) {
      const idx = path.indexOf(name);
      const cycle = [...path.slice(idx), name];

      // Only a cycle that touches at least one INLINE function is a hazard (see the
      // doc comment above) — a purely-real cycle is ordinary supported recursion.
      if (cycle.some((n) => inlineMap.has(n))) {
        throw new Error(
          `recursive inline function(s): ${cycle.join(' -> ')} — inline functions cannot be directly or ` +
            'mutually recursive (including through an intervening real function); use a real `function` ' +
            'declaration instead',
        );
      }

      return;
    }

    color.set(name, 1);
    path.push(name);

    const body = allBodies.get(name);

    if (body) for (const callee of collectKnownCallees(body, allBodies)) visit(callee);

    path.pop();
    color.set(name, 2);
  };

  for (const name of inlineMap.keys()) visit(name);
}

// ── generic detection: does an expression contain an inline call anywhere? ──
// Used to gate positions that are CONDITIONALLY evaluated (a ternary branch, the
// right-hand side of `&&`/`||`, a for/while header) where unconditional hoisting
// would be unsound (or, for loop headers, structurally impossible).

function containsInlineCall(node: Node | null | undefined, inlineMap: Map<string, InlineFnEntry>): boolean {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return false;

  if (node.type === 'CallExpression') {
    const callee = (node as CallExpression).callee;

    if (callee.type === 'Identifier' && inlineMap.has((callee as Identifier).name)) return true;
  }

  let found = false;

  eachChild(node, (child) => {
    if (!found && containsInlineCall(child, inlineMap)) found = true;
  });

  return found;
}

function containsReturn(node: Node | null | undefined): boolean {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return false;

  if (node.type === 'ReturnStatement') return true;

  let found = false;

  eachChild(node, (child) => {
    if (!found && containsReturn(child)) found = true;
  });

  return found;
}

/** Does every path through this statement list terminate (return or throw)? Conservative. */
function alwaysTerminates(stmts: Statement[]): boolean {
  for (const stmt of stmts) {
    if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement') return true;

    if (stmt.type === 'IfStatement') {
      const ifStmt = stmt as IfStatement;

      if (ifStmt.alternate) {
        const consequentTerm = alwaysTerminates(blockToStatements(ifStmt.consequent));
        const alternateTerm = alwaysTerminates(blockToStatements(ifStmt.alternate));

        if (consequentTerm && alternateTerm) return true;
      }
    }
  }

  return false;
}

// ── AST node builders (synthetic nodes; start/end are unused by the processor) ──

function makeIdentifier(name: string): Identifier {
  return { type: 'Identifier', name, start: 0, end: 0 } as unknown as Identifier;
}

function makeLiteral(value: bigint): Literal {
  return { type: 'Literal', value, raw: `${value}n`, start: 0, end: 0 } as unknown as Literal;
}

// A dynamic-KIND placeholder literal — an empty string, which `inferKind`
// (processor/inference.ts) already classifies 'dynamic' for any ordinary string literal.
// Used ONLY to seed `#inline_result_N`'s FIRST declaration when `couldReturnBeDynamic`
// (below) determines the callee might return a dynamic value — see `expandInlineCall`'s own
// doc comment for why. The specific SHAPE of a dynamic value doesn't matter for this: v1's
// WRITE_HEAP/READ_HEAP (`saucer/memory.ts`'s encodeHeapStore/encodeHeapRead) just moves
// whatever heap descriptor the current value produced — an empty string here, an array/tuple
// descriptor once the real return value is assigned — so seeding 'dynamic' storage with a
// throwaway empty string is completely generic and safe regardless of what the callee
// actually returns.
function makeDynamicPlaceholder(): Literal {
  return { type: 'Literal', value: '', raw: '""', start: 0, end: 0 } as unknown as Literal;
}

function makeReturn(expr: Expression): ReturnStatement {
  return { type: 'ReturnStatement', argument: expr, start: 0, end: 0 } as unknown as ReturnStatement;
}

function makeConstDecl(name: string, init: Expression): VariableDeclaration {
  const declarator = {
    type: 'VariableDeclarator',
    id: makeIdentifier(name),
    init,
    start: 0,
    end: 0,
  } as unknown as VariableDeclarator;

  return {
    type: 'VariableDeclaration',
    kind: 'const',
    declarations: [declarator],
    start: 0,
    end: 0,
  } as unknown as VariableDeclaration;
}

function makeLetDecl(name: string, init: Expression): VariableDeclaration {
  const declarator = {
    type: 'VariableDeclarator',
    id: makeIdentifier(name),
    init,
    start: 0,
    end: 0,
  } as unknown as VariableDeclarator;

  return {
    type: 'VariableDeclaration',
    kind: 'let',
    declarations: [declarator],
    start: 0,
    end: 0,
  } as unknown as VariableDeclaration;
}

function makeAssignStmt(name: string, expr: Expression): ExpressionStatement {
  const assignment = {
    type: 'AssignmentExpression',
    operator: '=',
    left: makeIdentifier(name),
    right: expr,
    start: 0,
    end: 0,
  } as unknown as AssignmentExpression;

  return { type: 'ExpressionStatement', expression: assignment, start: 0, end: 0 } as unknown as ExpressionStatement;
}

function makeDoneGuard(doneVar: string, stmts: Statement[]): IfStatement {
  const test = {
    type: 'BinaryExpression',
    operator: '===',
    left: makeIdentifier(doneVar),
    right: makeLiteral(0n),
    start: 0,
    end: 0,
  } as unknown as BinaryExpression;

  return {
    type: 'IfStatement',
    test,
    consequent: asBlock(stmts),
    alternate: null,
    start: 0,
    end: 0,
  } as unknown as IfStatement;
}

function blockToStatements(node: Statement): Statement[] {
  return node.type === 'BlockStatement' ? (node as BlockStatement).body : [node];
}

function asBlock(stmts: Statement[]): BlockStatement {
  return { type: 'BlockStatement', body: stmts, start: 0, end: 0 } as unknown as BlockStatement;
}

// ── alpha-renaming (splicing a callee's body requires globally-fresh local names) ──

function collectLocalDeclNames(stmts: Statement[], out: Set<string> = new Set()): Set<string> {
  for (const stmt of stmts) {
    if (stmt.type === 'VariableDeclaration') {
      for (const d of (stmt as VariableDeclaration).declarations) {
        if (d.id.type === 'Identifier') out.add((d.id as Identifier).name);
      }
    } else if (stmt.type === 'IfStatement') {
      const ifStmt = stmt as IfStatement;

      collectLocalDeclNames(blockToStatements(ifStmt.consequent), out);

      if (ifStmt.alternate) collectLocalDeclNames(blockToStatements(ifStmt.alternate), out);
    }
  }

  return out;
}

function renameExpr(expr: Expression, renameMap: Map<string, string>): Expression {
  switch (expr.type) {
    case 'Literal':
      return expr;
    case 'Identifier': {
      const mapped = renameMap.get((expr as Identifier).name);

      return mapped ? ({ ...expr, name: mapped } as Identifier) : expr;
    }
    case 'UnaryExpression': {
      const u = expr as UnaryExpression;

      return { ...u, argument: renameExpr(u.argument as Expression, renameMap) };
    }
    case 'BinaryExpression': {
      const b = expr as BinaryExpression;

      return {
        ...b,
        left: renameExpr(b.left as Expression, renameMap),
        right: renameExpr(b.right as Expression, renameMap),
      };
    }
    case 'LogicalExpression': {
      const l = expr as LogicalExpression;

      return { ...l, left: renameExpr(l.left, renameMap), right: renameExpr(l.right, renameMap) };
    }
    case 'ConditionalExpression': {
      const c = expr as ConditionalExpression;

      return {
        ...c,
        test: renameExpr(c.test, renameMap),
        consequent: renameExpr(c.consequent, renameMap),
        alternate: renameExpr(c.alternate, renameMap),
      };
    }
    case 'MemberExpression': {
      const m = expr as MemberExpression;

      return {
        ...m,
        object: renameExpr(m.object as Expression, renameMap),
        property: m.computed ? renameExpr(m.property as Expression, renameMap) : m.property,
      };
    }
    case 'CallExpression': {
      const c = expr as CallExpression;
      // A bare-Identifier callee names a FUNCTION (inline or real) — never a local
      // variable — so it must never be renamed; other callee shapes (member/chain) recurse.
      const callee = c.callee.type === 'Identifier' ? c.callee : renameExpr(c.callee as Expression, renameMap);
      const args = c.arguments.map((a) => renameExpr(a as Expression, renameMap));

      return { ...c, callee, arguments: args };
    }
    case 'AssignmentExpression': {
      const a = expr as AssignmentExpression;

      // `left` is an Identifier or MemberExpression (never a destructuring pattern in
      // this compiler) — both are handled by the cases above; acorn types `left` as the
      // broader `Pattern`, so the (structurally still Identifier/MemberExpression) result
      // needs a cast back.
      return {
        ...a,
        left: renameExpr(a.left as Expression, renameMap) as unknown as typeof a.left,
        right: renameExpr(a.right as Expression, renameMap),
      };
    }
    case 'UpdateExpression': {
      const u = expr as UpdateExpression;

      // The compiler requires a bare Identifier operand (processUpdateMutation) — no
      // deeper structure to recurse into, just rename it if it's one of our locals.
      return { ...u, argument: renameExpr(u.argument as Expression, renameMap) };
    }
    case 'NewExpression': {
      const n = expr as NewExpression;

      return { ...n, arguments: n.arguments.map((a) => renameExpr(a as Expression, renameMap)) };
    }
    case 'ArrayExpression': {
      const a = expr as ArrayExpression;

      return { ...a, elements: a.elements.map((el) => (el ? renameExpr(el as Expression, renameMap) : el)) };
    }
    case 'ObjectExpression': {
      const o = expr as ObjectExpression;

      return {
        ...o,
        properties: o.properties.map((prop) => {
          if (prop.type !== 'Property') return prop;

          const p = prop as Property;
          const renamedValue = renameExpr(p.value as Expression, renameMap);

          // Shorthand `{foo}` reads its variable from `key` (see inference.ts
          // extractSortedProperties), so a renamed value must switch to explicit
          // form or the ORIGINAL name would silently be re-read from the key.
          if (p.shorthand && renamedValue !== p.value) return { ...p, value: renamedValue, shorthand: false };

          return { ...p, value: renamedValue };
        }),
      };
    }
    case 'TaggedTemplateExpression': {
      const t = expr as TaggedTemplateExpression;

      return {
        ...t,
        quasi: { ...t.quasi, expressions: t.quasi.expressions.map((e) => renameExpr(e as Expression, renameMap)) },
      };
    }
    default:
      throw new Error(`inline expansion: cannot alpha-rename expression type ${expr.type}`);
  }
}

function renameStatement(stmt: Statement, renameMap: Map<string, string>): Statement {
  switch (stmt.type) {
    case 'VariableDeclaration': {
      const v = stmt as VariableDeclaration;

      return {
        ...v,
        declarations: v.declarations.map((d) => {
          const id = d.id as Identifier;
          const mapped = renameMap.get(id.name);

          return {
            ...d,
            id: mapped ? { ...id, name: mapped } : id,
            init: d.init ? renameExpr(d.init as Expression, renameMap) : d.init,
          };
        }),
      };
    }
    case 'IfStatement': {
      const i = stmt as IfStatement;

      return {
        ...i,
        test: renameExpr(i.test as Expression, renameMap),
        consequent: renameBlock(i.consequent, renameMap),
        alternate: i.alternate ? renameBlock(i.alternate, renameMap) : i.alternate,
      };
    }
    case 'ReturnStatement': {
      const r = stmt as ReturnStatement;

      return { ...r, argument: r.argument ? renameExpr(r.argument as Expression, renameMap) : r.argument };
    }
    case 'ExpressionStatement': {
      const e = stmt as ExpressionStatement;

      return { ...e, expression: renameExpr(e.expression as Expression, renameMap) };
    }
    case 'ThrowStatement': {
      const t = stmt as ThrowStatement;

      return { ...t, argument: renameExpr(t.argument as Expression, renameMap) };
    }
    default:
      throw new Error(`inline expansion: cannot alpha-rename statement type ${stmt.type}`);
  }
}

function renameBlock(node: Statement, renameMap: Map<string, string>): Statement {
  if (node.type === 'BlockStatement')
    return { ...node, body: (node as BlockStatement).body.map((s) => renameStatement(s, renameMap)) };

  return renameStatement(node, renameMap);
}

// ── the expansion engine ──

/**
 * Hard cap on the total number of inline call-site expansions performed by a single
 * compile — mirrors MAX_UNROLL_ITERATIONS's role for loop unrolling (src/ts-frontend.ts).
 * A DAG of inline functions where each level calls a shared lower-level helper MORE THAN
 * ONCE (a "diamond" composition — e.g. `l1 = (x) => l0(x) + l0(x)`, `l2 = (x) => l1(x) +
 * l1(x)`, …) is not a cycle (detectInlineRecursion correctly allows it), but produces an
 * exponential (2^N) blowup in total spliced statements. Left unchecked this can take
 * minutes to compile, or throw an unrelated-looking `RangeError: Maximum call stack size
 * exceeded` (a V8 argument-count limit — `arr.push(...hugeArray)` throws this once the
 * array crosses roughly 100k elements — rather than an actual stack overflow) instead of
 * a clear, actionable compile error. This cap fails closed well before either of those: a
 * legitimate recipe file with a few hundred inline call sites is nowhere near this limit.
 */
const MAX_INLINE_EXPANSIONS = 4096;

class ExpandState {
  constructor(public inlineMap: Map<string, InlineFnEntry>) {}

  private counter = 0;

  nextId(): number {
    return this.counter++;
  }
}

interface HoistResult {
  pre: Statement[];
  expr: Expression;
}

/**
 * Hoist every inline call within `expr` (a value-producing position) into preceding
 * statements, replacing each call with a reference to its `#inline_result_N` identifier.
 * Left-to-right / innermost-first, matching normal JS argument-evaluation order. Bails on
 * a ternary branch or the right side of `&&`/`||` (conditionally evaluated — unconditional
 * hoisting there would be unsound) and on a for/while HEADER clause (handled by the caller).
 */
function hoistExpr(expr: Expression, state: ExpandState): HoistResult {
  switch (expr.type) {
    case 'Literal':
    case 'Identifier':
      return { pre: [], expr };

    case 'UnaryExpression': {
      const u = expr as UnaryExpression;
      const arg = hoistExpr(u.argument as Expression, state);

      return { pre: arg.pre, expr: { ...u, argument: arg.expr } };
    }

    case 'BinaryExpression': {
      const b = expr as BinaryExpression;
      const left = hoistExpr(b.left as Expression, state);
      const right = hoistExpr(b.right as Expression, state);

      return { pre: [...left.pre, ...right.pre], expr: { ...b, left: left.expr, right: right.expr } };
    }

    case 'LogicalExpression': {
      const l = expr as LogicalExpression;
      const left = hoistExpr(l.left, state);

      if (containsInlineCall(l.right, state.inlineMap)) {
        throw new Error(
          `cannot inline a call on the right-hand side of "${l.operator}": it is conditionally evaluated (short-circuit) — rewrite using an if statement instead`,
        );
      }

      return { pre: left.pre, expr: { ...l, left: left.expr } };
    }

    case 'ConditionalExpression': {
      const c = expr as ConditionalExpression;
      const test = hoistExpr(c.test, state);

      if (containsInlineCall(c.consequent, state.inlineMap) || containsInlineCall(c.alternate, state.inlineMap)) {
        throw new Error(
          'cannot inline a call inside a ternary branch: it is conditionally evaluated — rewrite using an if/else statement instead',
        );
      }

      return { pre: test.pre, expr: { ...c, test: test.expr } };
    }

    case 'MemberExpression': {
      const m = expr as MemberExpression;
      const obj = hoistExpr(m.object as Expression, state);

      if (!m.computed) return { pre: obj.pre, expr: { ...m, object: obj.expr } };

      const prop = hoistExpr(m.property as Expression, state);

      return { pre: [...obj.pre, ...prop.pre], expr: { ...m, object: obj.expr, property: prop.expr } };
    }

    case 'NewExpression': {
      const n = expr as NewExpression;
      const pre: Statement[] = [];
      const args = n.arguments.map((a) => {
        const r = hoistExpr(a as Expression, state);

        pre.push(...r.pre);

        return r.expr;
      });

      return { pre, expr: { ...n, arguments: args } };
    }

    case 'ArrayExpression': {
      const a = expr as ArrayExpression;
      const pre: Statement[] = [];
      const elements = a.elements.map((el) => {
        if (!el) return el;

        const r = hoistExpr(el as Expression, state);

        pre.push(...r.pre);

        return r.expr;
      });

      return { pre, expr: { ...a, elements } };
    }

    case 'ObjectExpression': {
      const o = expr as ObjectExpression;
      const pre: Statement[] = [];
      const properties = o.properties.map((prop) => {
        if (prop.type !== 'Property') return prop;

        const p = prop as Property;
        const r = hoistExpr(p.value as Expression, state);

        pre.push(...r.pre);

        return { ...p, value: r.expr };
      });

      return { pre, expr: { ...o, properties } };
    }

    case 'TaggedTemplateExpression': {
      const t = expr as TaggedTemplateExpression;
      const pre: Statement[] = [];
      const expressions = t.quasi.expressions.map((e) => {
        const r = hoistExpr(e as Expression, state);

        pre.push(...r.pre);

        return r.expr;
      });

      return { pre, expr: { ...t, quasi: { ...t.quasi, expressions } } };
    }

    case 'CallExpression': {
      const c = expr as CallExpression;

      if (c.callee.type === 'Identifier' && state.inlineMap.has((c.callee as Identifier).name)) {
        const name = (c.callee as Identifier).name;
        const pre: Statement[] = [];
        const args = c.arguments.map((a) => {
          const r = hoistExpr(a as Expression, state);

          pre.push(...r.pre);

          return r.expr;
        });

        const call = expandInlineCall(name, args, true, state);

        return { pre: [...pre, ...call.stmts], expr: call.resultExpr };
      }

      // `.catch(handler)` — the handler is a nested arrow whose BODY is a statement
      // list, not an expression to hoist; expand it with the statement-list engine.
      const catchInfo = resolveCatchChain(c);
      const calleeResult = hoistExpr(c.callee as Expression, state);

      if (catchInfo) {
        const handlerArrow = c.arguments[0] as ArrowFunctionExpression;
        const expandedBody = asBlock(expandStatementList(blockToStatements(catchInfo.handlerBody), state));
        const newHandler = { ...handlerArrow, body: expandedBody };

        return { pre: calleeResult.pre, expr: { ...c, callee: calleeResult.expr, arguments: [newHandler] } };
      }

      const pre: Statement[] = [...calleeResult.pre];
      const args = c.arguments.map((a) => {
        const r = hoistExpr(a as Expression, state);

        pre.push(...r.pre);

        return r.expr;
      });

      return { pre, expr: { ...c, callee: calleeResult.expr, arguments: args } };
    }

    // Only ever legal as a bare ExpressionStatement's expression, or (UpdateExpression
    // only) a VariableDeclarator init in this compiler — hoistStatementOwnExprs routes
    // both through here uniformly. `left`/`argument` hoist trivially for a plain
    // Identifier target; a computed member target (`arr[i] = x`) hoists `i` too.
    case 'AssignmentExpression': {
      const a = expr as AssignmentExpression;
      const left = hoistExpr(a.left as Expression, state);
      const right = hoistExpr(a.right as Expression, state);

      return {
        pre: [...left.pre, ...right.pre],
        expr: { ...a, left: left.expr as unknown as typeof a.left, right: right.expr },
      };
    }

    case 'UpdateExpression':
      // Argument is always a bare Identifier (processUpdateMutation) — nothing to hoist.
      return { pre: [], expr };

    default:
      throw new Error(`inline expansion: not implemented for expression type ${expr.type}`);
  }
}

// ── conservative "could the call's result be dynamic?" analysis ──
//
// `expandInlineCall` (below) shares ONE variable (`#inline_result_N`) across every reachable
// `return` in the callee body — a guard-clause function may set it from more than one branch
// (see `eliminateReturns`'s own doc comment) — so its FIRST declaration needs an initializer
// literal up front, before any real return value is known. Before this fix that initializer
// was ALWAYS the scalar literal `0n` — fine for the overwhelmingly common scalar-arithmetic
// guard-clause shape this feature was built for, but WRONG whenever the callee could actually
// return a dynamic value (an array/object literal, a `new Array(n)` TUPLE, a `.concat()`/
// `.slice()` string, …): `rejectV1ScalarToDynamicReassignment` (processor/statement.ts) then
// correctly refuses to let a LATER assignment re-class `#inline_result_N` from scalar to
// dynamic — a hard, unconditional compile error for every dynamic-returning inline function
// (confirmed: BEFORE that guard existed, the identical source compiled cleanly and then
// silently dropped the descriptor at runtime, reverting `SauceInvalidOperationArgs(0x97)` on
// real EVM execution — so the guard is doing its job; the SENTINEL's own kind was simply
// never being classified as dynamic in the first place).
//
// This is a pure ACORN-AST, ctx-FREE scan (inline expansion runs before `CompilerContext`
// compiles any body — see this file's own top-of-file doc comment), so it CANNOT be as
// precise as the real, ctx-aware `inferKindWithContext` that eventually compiles each actual
// return assignment. It doesn't need to be: it only decides `#inline_result_N`'s INITIAL
// kind, and `rejectV1ScalarToDynamicReassignment` remains the real soundness backstop — if
// this scan ever UNDER-estimates (misses a genuinely-dynamic return), the result is a
// (still-safe) compile-time rejection of a rare/unusual shape, never a silent runtime
// descriptor drop. So this scan is deliberately biased toward "unsure → assume dynamic"
// for anything it doesn't specifically recognize as scalar, while still recognizing the
// common, purely-arithmetic guard-clause shape (this feature's own motivating case) as
// scalar so EXISTING scalar-only inline functions keep their current (WRITE_VALUE) bytecode
// shape, byte-for-byte.
function couldReturnBeDynamic(entry: InlineFnEntry, argExprs: Expression[]): boolean {
  const locals = new Map<string, boolean>();

  // A parameter that's simply returned unchanged is only as "scalar" as whatever the
  // CALLER actually passed — resolved with the SAME conservative scan, applied to the
  // real argument expression at this call site.
  entry.params.forEach((p, i) => locals.set(p, exprCouldBeDynamic(argExprs[i], locals)));

  return bodyCouldReturnDynamic(entry.body, locals);
}

// Mirrors return-kind.ts's own OR-across-every-reachable-return rule (a mixed scalar/dynamic
// guard-clause function is classified dynamic) and its flat, non-block-scoped local tracking
// (validateInlineable already restricts an inline body to VariableDeclaration/IfStatement/
// ReturnStatement/ExpressionStatement/ThrowStatement — no loops/switch/try/nested functions —
// so this only ever needs to walk those five shapes).
function bodyCouldReturnDynamic(stmts: Statement[], locals: Map<string, boolean>): boolean {
  let dynamic = false;

  for (const stmt of stmts) {
    switch (stmt.type) {
      case 'VariableDeclaration':
        for (const d of (stmt as VariableDeclaration).declarations) {
          if (d.id.type === 'Identifier' && d.init) {
            locals.set((d.id as Identifier).name, exprCouldBeDynamic(d.init as Expression, locals));
          }
        }

        break;

      case 'ExpressionStatement': {
        const expr = (stmt as ExpressionStatement).expression;

        if (expr.type === 'AssignmentExpression') {
          const assign = expr as AssignmentExpression;

          if (assign.operator === '=' && assign.left.type === 'Identifier') {
            // Promote-only, same sound direction as every other pass in this bug family.
            if (exprCouldBeDynamic(assign.right as Expression, locals)) {
              locals.set((assign.left as Identifier).name, true);
            }
          }
        }

        break;
      }

      case 'IfStatement': {
        const ifStmt = stmt as IfStatement;

        if (bodyCouldReturnDynamic(blockToStatements(ifStmt.consequent), locals)) dynamic = true;

        if (ifStmt.alternate && bodyCouldReturnDynamic(blockToStatements(ifStmt.alternate), locals)) dynamic = true;

        break;
      }

      case 'ReturnStatement': {
        const ret = stmt as ReturnStatement;

        if (ret.argument && exprCouldBeDynamic(ret.argument as Expression, locals)) dynamic = true;

        break;
      }

      default:
        break;
    }
  }

  return dynamic;
}

// "Could `expr` be dynamic?" — deliberately biased toward TRUE (see the doc comment above):
// only a shape provably built from scalars is `false`; anything unrecognized (a call, a
// property/index access base whose OWN kind is unknown, …) defaults to `true`. An indexed/
// property access (`arr[i]`, `arr.length`) is `false` regardless of the base's own kind —
// reading an ELEMENT or a COUNT off a container always yields a scalar in this language,
// never the container's own dynamic descriptor.
function exprCouldBeDynamic(expr: Expression, locals: Map<string, boolean>): boolean {
  switch (expr.type) {
    case 'Literal':
      return typeof (expr as Literal).value === 'string';

    case 'Identifier':
      return locals.get((expr as Identifier).name) ?? false;

    case 'ArrayExpression':
    case 'ObjectExpression':
    case 'NewExpression':
    case 'TaggedTemplateExpression':
      return true;

    case 'UnaryExpression':
      return exprCouldBeDynamic((expr as UnaryExpression).argument as Expression, locals);

    case 'BinaryExpression':
      return (
        exprCouldBeDynamic((expr as BinaryExpression).left as Expression, locals) ||
        exprCouldBeDynamic((expr as BinaryExpression).right as Expression, locals)
      );

    case 'LogicalExpression':
      return (
        exprCouldBeDynamic((expr as LogicalExpression).left as Expression, locals) ||
        exprCouldBeDynamic((expr as LogicalExpression).right as Expression, locals)
      );

    case 'ConditionalExpression': {
      const c = expr as ConditionalExpression;

      return (
        exprCouldBeDynamic(c.consequent as Expression, locals) || exprCouldBeDynamic(c.alternate as Expression, locals)
      );
    }

    case 'MemberExpression':
      return false;

    default:
      // Anything else (a CallExpression — same-file function, contract call, global/builtin,
      // …) is unknown from a pure ctx-free AST scan — conservatively assume dynamic. Costs at
      // most an extra heap slot on a scalar-returning call; NEVER a dropped descriptor.
      return true;
  }
}

/**
 * Splice ONE call to inline function `name` at its use site: bind each (already-expanded)
 * argument to a fresh param const, alpha-rename the callee's body, run return-elimination,
 * and return the resulting statements plus an identifier referencing the result.
 * `resultUsed=false` (a bare discarded call statement) skips the "every path returns" check
 * — the value is never read, so a validate/revert-only helper is fine there.
 */
function expandInlineCall(
  name: string,
  argExprs: Expression[],
  resultUsed: boolean,
  state: ExpandState,
): { stmts: Statement[]; resultExpr: Identifier } {
  const entry = state.inlineMap.get(name);

  if (!entry) throw new Error(`Function ${name} is undefined.`);

  if (argExprs.length !== entry.params.length) {
    throw new Error(`inline function "${name}" expects ${entry.params.length} argument(s), got ${argExprs.length}`);
  }

  if (resultUsed && !alwaysTerminates(entry.body)) {
    throw new Error(
      `cannot inline function "${name}": not every code path returns a value — add a fallthrough return, or call it as a discarded statement instead`,
    );
  }

  const id = state.nextId();

  if (id >= MAX_INLINE_EXPANSIONS) {
    throw new Error(
      `cannot inline function "${name}": exceeded the maximum of ${MAX_INLINE_EXPANSIONS} total inline ` +
        'call-site expansions for a single compile (likely an exponential fan-out — a "diamond" composition ' +
        'of inline functions where each level calls a shared lower-level helper more than once) — break the ' +
        'chain by making at least one level a real `function` declaration instead',
    );
  }

  // `#`-prefixed: never a legal SauceScript identifier (acorn rejects a bare `#name`
  // outside a class body as a syntax error), so these synthetic names can NEVER collide
  // with a user-authored variable/parameter — the same collision-proof convention
  // CompilerContext.freshTemp() already uses (`#tmp<N>`) for exactly this reason. An
  // earlier `$inline_...` convention was a PLAIN, user-typable identifier — a user local
  // literally named `$inline_result_0` would silently alias onto (and be clobbered by)
  // the compiler's own synthesized temp, since Saucer.store() treats redeclaring an
  // existing name as a silent get-or-create, not an error.
  const resultVar = `#inline_result_${id}`;
  const doneVar = `#inline_done_${id}`;

  const renameMap = new Map<string, string>();

  for (const p of entry.params) renameMap.set(p, `#inline_p_${id}_${p}`);

  for (const localName of collectLocalDeclNames(entry.body)) {
    if (!renameMap.has(localName)) renameMap.set(localName, `#inline_l_${id}_${localName}`);
  }

  const stmts: Statement[] = [];

  entry.params.forEach((p, i) => stmts.push(makeConstDecl(renameMap.get(p)!, argExprs[i])));

  // Seed `#inline_result_N`'s FIRST declaration with a DYNAMIC-kind placeholder whenever the
  // callee might return a dynamic value — see `couldReturnBeDynamic`'s own doc comment for
  // why (a scalar-first declaration would make `rejectV1ScalarToDynamicReassignment` reject
  // the later real-value assignment outright, a hard, unconditional compile error for every
  // dynamic-returning inline function). Computed against the ORIGINAL (pre-rename) callee
  // body/params — alpha-renaming doesn't change any node's TYPE, only identifier text, so it
  // makes no difference to this scan either way.
  const resultInit = couldReturnBeDynamic(entry, argExprs) ? makeDynamicPlaceholder() : makeLiteral(0n);

  stmts.push(makeLetDecl(resultVar, resultInit));
  stmts.push(makeLetDecl(doneVar, makeLiteral(0n)));

  const renamedBody = entry.body.map((s) => renameStatement(s, renameMap));

  stmts.push(...eliminateReturns(renamedBody, doneVar, resultVar, state));

  return { stmts, resultExpr: makeIdentifier(resultVar) };
}

/**
 * Return-elimination with a shared done-flag (the core splicing mechanism — see
 * CLAUDE.md for the full algorithm). Walks a statement list IN ORDER: a `return` sets
 * the result + done flag and drops the (unreachable) rest of the list; an `if`/`if-else`
 * whose branch(es) contain a return recurses into each branch, then wraps everything
 * AFTER it in `if (done === 0) { … }` (the branch may already have produced the result);
 * anything else is hoisted for its own inline calls and kept as-is.
 */
function eliminateReturns(stmts: Statement[], doneVar: string, resultVar: string, state: ExpandState): Statement[] {
  const out: Statement[] = [];

  for (let i = 0; i < stmts.length; i++) {
    const stmt = stmts[i];

    if (stmt.type === 'ReturnStatement') {
      const ret = stmt as ReturnStatement;

      if (ret.argument) {
        const { pre, expr } = hoistExpr(ret.argument as Expression, state);

        out.push(...pre, makeAssignStmt(resultVar, expr));
      }

      out.push(makeAssignStmt(doneVar, makeLiteral(1n)));

      return out; // everything after an unconditional return in this list is unreachable
    }

    if (stmt.type === 'IfStatement') {
      const ifStmt = stmt as IfStatement;
      const hasReturn = containsReturn(ifStmt.consequent) || (!!ifStmt.alternate && containsReturn(ifStmt.alternate));

      if (!hasReturn) {
        const { pre, expr: test } = hoistExpr(ifStmt.test as Expression, state);
        const consequent = asBlock(expandStatementList(blockToStatements(ifStmt.consequent), state));
        const alternate = ifStmt.alternate
          ? asBlock(expandStatementList(blockToStatements(ifStmt.alternate), state))
          : undefined;

        out.push(...pre, { ...ifStmt, test, consequent, alternate } as IfStatement);
        continue;
      }

      const { pre: testPre, expr: test } = hoistExpr(ifStmt.test as Expression, state);
      const consequent = asBlock(eliminateReturns(blockToStatements(ifStmt.consequent), doneVar, resultVar, state));
      const alternate = ifStmt.alternate
        ? asBlock(eliminateReturns(blockToStatements(ifStmt.alternate), doneVar, resultVar, state))
        : undefined;

      out.push(...testPre, { type: 'IfStatement', test, consequent, alternate } as unknown as IfStatement);

      const remainder = eliminateReturns(stmts.slice(i + 1), doneVar, resultVar, state);

      if (remainder.length > 0) out.push(makeDoneGuard(doneVar, remainder));

      return out;
    }

    const { pre, stmt: newStmt } = hoistStatementOwnExprs(stmt, state);

    out.push(...pre);

    if (newStmt) out.push(newStmt);
  }

  return out;
}

interface StatementHoistResult {
  pre: Statement[];
  /** undefined = the original statement fully collapsed into `pre` (a discarded inline call). */
  stmt?: Statement;
}

/**
 * Hoist a single statement's OWN expression(s) — not its nested statement-list bodies
 * (an if/for/while's body is the caller's job to recurse into). A bare discarded-value
 * call statement (`f(x);` where f is inline) collapses entirely into `pre` — the
 * compiler has no way to emit a bare-identifier expression statement, and the value is
 * unused anyway. A for/while header containing an inline call is a bail (structurally
 * can't host a multi-statement splice).
 */
function hoistStatementOwnExprs(stmt: Statement, state: ExpandState): StatementHoistResult {
  switch (stmt.type) {
    case 'VariableDeclaration': {
      const v = stmt as VariableDeclaration;
      const pre: Statement[] = [];
      const declarations = v.declarations.map((d) => {
        if (!d.init) return d;

        const r = hoistExpr(d.init as Expression, state);

        pre.push(...r.pre);

        return { ...d, init: r.expr };
      });

      return { pre, stmt: { ...v, declarations } };
    }

    case 'ExpressionStatement': {
      const e = stmt as ExpressionStatement;
      const inner = e.expression as Expression;

      if (inner.type === 'CallExpression' && (inner as CallExpression).callee.type === 'Identifier') {
        const name = ((inner as CallExpression).callee as Identifier).name;

        if (state.inlineMap.has(name)) {
          const call = inner as CallExpression;
          const pre: Statement[] = [];
          const args = call.arguments.map((a) => {
            const r = hoistExpr(a as Expression, state);

            pre.push(...r.pre);

            return r.expr;
          });

          const { stmts } = expandInlineCall(name, args, false, state);

          return { pre: [...pre, ...stmts], stmt: undefined };
        }
      }

      const { pre, expr } = hoistExpr(inner, state);

      return { pre, stmt: { ...e, expression: expr } };
    }

    case 'IfStatement': {
      const i = stmt as IfStatement;
      const { pre, expr } = hoistExpr(i.test as Expression, state);

      return { pre, stmt: { ...i, test: expr } };
    }

    case 'ReturnStatement': {
      const r = stmt as ReturnStatement;

      if (!r.argument) return { pre: [], stmt: r };

      const { pre, expr } = hoistExpr(r.argument as Expression, state);

      return { pre, stmt: { ...r, argument: expr } };
    }

    case 'ThrowStatement': {
      const t = stmt as ThrowStatement;
      const { pre, expr } = hoistExpr(t.argument as Expression, state);

      return { pre, stmt: { ...t, argument: expr } };
    }

    case 'ForStatement': {
      const f = stmt as ForStatement;
      const headerHasInline =
        (!!f.init && containsInlineCall(f.init, state.inlineMap)) ||
        (!!f.test && containsInlineCall(f.test, state.inlineMap)) ||
        (!!f.update && containsInlineCall(f.update, state.inlineMap));

      if (headerHasInline) {
        throw new Error(
          'cannot inline a call inside a for-loop header (init/test/update) — call it as a plain statement inside the loop body instead',
        );
      }

      return { pre: [], stmt: f };
    }

    case 'WhileStatement': {
      const w = stmt as WhileStatement;

      if (containsInlineCall(w.test, state.inlineMap)) {
        throw new Error(
          'cannot inline a call inside a while-loop condition — call it as a plain statement inside the loop body instead',
        );
      }

      return { pre: [], stmt: w };
    }

    case 'BreakStatement':
    case 'ContinueStatement':
      return { pre: [], stmt };

    default:
      throw new Error(`inline expansion: not implemented for statement type ${stmt.type}`);
  }
}

/**
 * Caller-mode statement-list expansion: hoist inline calls out of every statement, and
 * recurse into nested control-flow bodies (if/for/while) with itself. Used for main()'s
 * and every real function's body — the top-level entry points into the expansion pass.
 */
function expandStatementList(stmts: Statement[], state: ExpandState): Statement[] {
  const out: Statement[] = [];

  for (const stmt of stmts) {
    const { pre, stmt: newStmt } = hoistStatementOwnExprs(stmt, state);

    out.push(...pre);

    if (!newStmt) continue;

    if (newStmt.type === 'IfStatement') {
      const ifStmt = newStmt as IfStatement;
      const consequent = asBlock(expandStatementList(blockToStatements(ifStmt.consequent), state));
      const alternate = ifStmt.alternate
        ? asBlock(expandStatementList(blockToStatements(ifStmt.alternate), state))
        : undefined;

      out.push({ ...ifStmt, consequent, alternate });
      continue;
    }

    if (newStmt.type === 'ForStatement') {
      const f = newStmt as ForStatement;
      const body = asBlock(expandStatementList(blockToStatements(f.body), state));

      out.push({ ...f, body });
      continue;
    }

    if (newStmt.type === 'WhileStatement') {
      const w = newStmt as WhileStatement;
      const body = asBlock(expandStatementList(blockToStatements(w.body), state));

      out.push({ ...w, body });
      continue;
    }

    out.push(newStmt);
  }

  return out;
}

// ── public entry points (wired from processor/index.ts) ──

/**
 * Merge local (main-program) inline declarations with the ones collected from imported
 * modules, rejecting a name collision between the two, or between an inline function and
 * a REAL function declaration (local or imported) — inline functions never enter
 * `addFunc`'s function table, so that collision isn't otherwise caught downstream.
 */
export function buildInlineMap(
  program: Program,
  importedInlines: Map<string, InlineFnEntry>,
  declarations: FunctionDeclaration[],
): Map<string, InlineFnEntry> {
  const merged = new Map(importedInlines);
  const localInlines = extractInlineDeclarations(program);

  for (const [name, decl] of localInlines) {
    if (merged.has(name)) throw new Error(`duplicate inline function "${name}" (defined locally and imported)`);

    merged.set(name, decl);
  }

  for (const fn of declarations) {
    const name = fn.id?.name;

    if (name && merged.has(name)) {
      throw new Error(`"${name}" is declared both as a function and as an inline const function`);
    }
  }

  return merged;
}

/**
 * Run the inline-expansion pass over every declaration (main + every real function, local
 * or imported) BEFORE treeshake/v1/v12 dispatch — mutates each `decl.body.body` in place.
 * A no-op (fast path) when the program uses zero inline functions, so an unmodified
 * program compiles byte-identically to before this feature existed.
 */
export function expandInlineFunctionsInDeclarations(
  declarations: FunctionDeclaration[],
  inlineMap: Map<string, InlineFnEntry>,
): void {
  if (inlineMap.size === 0) return;

  for (const [name, entry] of inlineMap) validateInlineable(name, entry.body);

  // Real (non-inline) function bodies, keyed by name — threaded into detectInlineRecursion
  // so a cycle routing through one or more real functions (inline A -> real B -> inline A)
  // is caught too, not just a direct inline-to-inline edge (see its doc comment).
  const realFnBodies = new Map<string, Statement[]>();

  for (const decl of declarations) {
    const name = decl.id?.name;

    if (name) realFnBodies.set(name, decl.body.body);
  }

  detectInlineRecursion(inlineMap, realFnBodies);

  const state = new ExpandState(inlineMap);

  for (const decl of declarations) {
    const expanded = expandStatementList(decl.body.body, state);

    decl.body.body.length = 0;
    decl.body.body.push(...expanded);
  }
}
