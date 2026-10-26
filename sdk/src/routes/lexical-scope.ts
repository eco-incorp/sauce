/**
 * Where a name a program declares is its own, as the compiler reads it, so a rewrite that gives a
 * name a meaning of its own (the token symbols, `pot`, the chain's names) gives it exactly where the
 * program does not bind it.
 *
 * The compiler's scoping: a module's declarations are its names everywhere in it, in any order; a
 * function's parameters (and a function expression's own name) everywhere in the function; a `let`
 * or `const` of a block — a function's body, a branch, a loop's — from the end of its declarator to
 * the end of the block, with no dead zone: a read before it reads the outer name; a function or
 * class a block declares everywhere in the block; a `for (let …;;)` binding in the whole loop; a
 * `for … of`/`for … in` binding in the body only, what it iterates read outside; a `catch` clause's
 * parameter in its body. `var` is refused by the compiler, and so is `switch`.
 */
import { collectPatternBinders, isTypeDeclaration, TYPE_KEYS, type AstNode } from "./ast-walk.js";

/** A scope: each name it declares, where it starts to hide an outer one, and the identifier that
 *  declares it. */
export interface Scope {
  readonly names: ReadonlyMap<string, number>;
  readonly binders: ReadonlyMap<string, AstNode>;
  readonly parent?: Scope;
}

/** Whether `name`, read at `position`, is a name the program declares there. */
export function shadowed(scope: Scope | undefined, name: string, position: number): boolean {
  return bindingOf(scope, name, position) !== undefined;
}

/**
 * The identifier that declares the `name` read at `position`, as the compiler scopes it: a
 * parameter's, a local's, a loop's or a `catch` clause's binding, a function's own name, an
 * import's local name. `undefined` where the program declares no `name` there.
 */
export function bindingOf(
  scope: Scope | undefined,
  name: string,
  position: number,
): AstNode | undefined {
  for (let s = scope; s !== undefined; s = s.parent) {
    const from = s.names.get(name);
    if (from !== undefined && from <= position) return s.binders.get(name);
  }
  return undefined;
}

/** A scope of `bindings`, each a pattern and the position it hides its names from. */
export function scopeOf(
  bindings: readonly (readonly [AstNode | null | undefined, number])[],
  parent: Scope | undefined,
): Scope {
  const names = new Map<string, number>();
  const binders = new Map<string, AstNode>();
  for (const [pattern, from] of bindings) {
    collectPatternBinders(pattern, (binder) => {
      const name = String(binder.name);
      const earlier = names.get(name);
      if (earlier !== undefined && earlier <= from) return;
      names.set(name, from);
      binders.set(name, binder);
    });
  }
  return { names, binders, parent };
}

export const isFunction = (node: AstNode): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

/** The child nodes of `node` in source order, types left out. */
export function childrenOf(node: AstNode): AstNode[] {
  const out: AstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") {
      continue;
    }
    if (TYPE_KEYS.has(key)) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && typeof item === "object" && typeof (item as AstNode).type === "string") {
        if (!isTypeDeclaration((item as AstNode).type)) out.push(item as AstNode);
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The module's scope: everything it declares at its top level, everywhere in it. */
export function moduleScope(program: AstNode): Scope {
  const bindings: [AstNode | null | undefined, number][] = [];
  for (const statement of program.body as AstNode[]) {
    const declaration =
      (statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration") &&
      statement.declaration
        ? (statement.declaration as AstNode)
        : statement;
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations as AstNode[]) {
        bindings.push([declarator.id as AstNode, 0]);
      }
    } else if (
      declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration"
    ) {
      bindings.push([declaration.id as AstNode, 0]);
    } else if (declaration.type === "ImportDeclaration" && declaration.importKind !== "type") {
      // A type-only import (`import type { X }`, `import { type X }`) is erased by the compiler: it
      // binds no value, so it shadows nothing.
      for (const specifier of declaration.specifiers as AstNode[]) {
        if (specifier.importKind !== "type") bindings.push([specifier.local as AstNode, 0]);
      }
    }
  }
  return scopeOf(bindings, undefined);
}

/** A function's scope: its parameters, and a function expression's own name, everywhere in it. */
export function functionScope(fn: AstNode, parent: Scope | undefined): Scope {
  return scopeOf(
    [
      ...(fn.type === "FunctionExpression" ? [[fn.id as AstNode, 0] as const] : []),
      ...((fn.params as AstNode[] | undefined) ?? []).map((param) => [param, 0] as const),
    ],
    parent,
  );
}

/** A statement list's scope: each `let`/`const` from the end of its declarator, a function or class
 *  everywhere in the list. */
export function blockScope(list: readonly AstNode[], parent: Scope | undefined): Scope {
  const bindings: [AstNode | null | undefined, number][] = [];
  for (const statement of list) {
    if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations as AstNode[]) {
        bindings.push([declarator.id as AstNode, declarator.end]);
      }
    } else if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      bindings.push([statement.id as AstNode, 0]);
    }
  }
  return scopeOf(bindings, parent);
}

/** A `for (…;…;…)` loop's scope: a `let`/`const` of its head, from its declarator on, in the whole
 *  loop. */
export function forScope(loop: AstNode, parent: Scope | undefined): Scope | undefined {
  const init = loop.init as AstNode | null;
  return init?.type === "VariableDeclaration" ? blockScope([init], parent) : parent;
}

/** A `for … of`/`for … in` loop's body's scope: its binding. What it iterates is read outside it. */
export function forOfBodyScope(loop: AstNode, parent: Scope | undefined): Scope | undefined {
  const left = loop.left as AstNode;
  return left.type === "VariableDeclaration"
    ? scopeOf(
        (left.declarations as AstNode[]).map(
          (declarator) => [declarator.id as AstNode, 0] as const,
        ),
        parent,
      )
    : parent;
}

/** A `catch` clause's body's scope: its parameter. */
export function catchScope(clause: AstNode, parent: Scope | undefined): Scope {
  return scopeOf([[clause.param as AstNode | null, 0]], parent);
}

/**
 * Visits every node of `program`, types left out, with the scope it is read in: `shadowed(scope,
 * name, node.start)` says whether a name read there is the program's own.
 */
export function walkScoped(
  program: AstNode,
  visit: (node: AstNode, scope: Scope | undefined) => void,
): void {
  const descend = (node: AstNode, at: Scope | undefined): void => {
    if (isTypeDeclaration(node.type)) return;
    visit(node, at);
    let inner = at;
    let body: AstNode | undefined;
    if (isFunction(node)) {
      inner = functionScope(node, at);
    } else if (node.type === "Program" || node.type === "BlockStatement") {
      inner = blockScope(node.body as AstNode[], at);
    } else if (node.type === "ForStatement") {
      inner = forScope(node, at);
    } else if (node.type === "ForOfStatement" || node.type === "ForInStatement") {
      body = node.body as AstNode;
      inner = forOfBodyScope(node, at);
    } else if (node.type === "CatchClause") {
      body = node.body as AstNode;
      inner = catchScope(node, at);
    }
    for (const child of childrenOf(node)) {
      descend(child, body === undefined || child === body ? inner : at);
    }
  };
  descend(program, moduleScope(program));
}
