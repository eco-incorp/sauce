/**
 * Shared AST plumbing for the routes/ source-rewrite passes still left (`intent-sugar.ts`,
 * `intent-body.ts`, `available.ts`), over the tree `parse.ts` produces. Its shadow check is
 * deliberately coarse — whole-program and conservative, not real lexical scoping.
 */
export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/** The properties of a node (`parse.ts`'s TypeScript AST) that hold a TYPE rather than a value. */
export const TYPE_KEYS: ReadonlySet<string> = new Set([
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeParameters",
  "superTypeArguments",
  "implements",
]);

/** A declaration that introduces only a type — `interface Leg { ... }` — and no value. */
export function isTypeDeclaration(type: string): boolean {
  return type.startsWith("TS") && (type.endsWith("Declaration") || type === "TSDeclareFunction");
}

/** Generic recursive descent over every object/array-shaped property -- deliberately not a
 *  hand-maintained per-node-type visitor table, since SauceScript's supported grammar surface is
 *  itself the only thing that can appear here, and a generic walk needs no per-type maintenance as
 *  that surface grows.
 *
 *  Types are stepped over: an annotation (`amount: Uint256`, `): Leg`) and a type-only declaration
 *  (`interface Leg`) name types, not values, so no rewrite may claim an identifier in one, and a
 *  walk collecting reads must not see `Uint256` as one. */
export function walk(node: unknown, visit: (n: AstNode) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec.type === "string") {
    if (isTypeDeclaration(rec.type)) return;
    visit(rec as unknown as AstNode);
  }
  for (const key of Object.keys(rec)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range")
      continue;
    if (TYPE_KEYS.has(key)) continue;
    walk(rec[key], visit);
  }
}

/** Every name a binding PATTERN introduces -- an identifier, or any nesting of object/array
 *  destructuring, defaults and rest. Collecting only the `Identifier` case would miss
 *  `const { Token } = x` and `function f({ Token })`, which bind the name just as plainly. */
export function collectPatternNames(pattern: unknown, names: { add(name: string): void }): void {
  if (pattern === null || typeof pattern !== "object") return;
  const node = pattern as AstNode;
  switch (node.type) {
    case "Identifier":
      names.add((node as unknown as { name: string }).name);
      return;
    case "ObjectPattern":
      for (const property of (node as { properties?: AstNode[] }).properties ?? []) {
        // A `Property`'s VALUE is the binding (`{ a: Token }` binds `Token`, not `a`); a
        // `RestElement`'s argument is.
        collectPatternNames(
          (property as { value?: unknown }).value ?? (property as { argument?: unknown }).argument,
          names,
        );
      }
      return;
    case "ArrayPattern":
      for (const element of (node as { elements?: AstNode[] }).elements ?? []) {
        collectPatternNames(element, names);
      }
      return;
    case "AssignmentPattern":
      collectPatternNames((node as { left?: unknown }).left, names);
      return;
    case "RestElement":
      collectPatternNames((node as { argument?: unknown }).argument, names);
      return;
    default:
      return;
  }
}

/** Every name the program introduces that could shadow a rewritten global, anywhere in the tree --
 *  deliberately whole-program, not scope-sensitive (see the module doc's shadowing note).
 *
 *  Covers every form that BINDS a name, not just the common ones: `let`/`const`/`var` declarators
 *  (including destructuring), function and arrow parameters, a function's or class's own name, a
 *  `catch` parameter, and every `import` clause. The import and class cases are not hypothetical --
 *  an `import { Token } from "./mine.js"` is a user's own `Token` by any reading, and missing it
 *  meant their call was silently redirected to an ERC20 they never named. Fail closed on all of
 *  them: over-collecting only ever declines a rewrite, which is the safe direction. */
export function collectDeclaredNames(program: AstNode): ReadonlySet<string> {
  return new Set(countDeclarations(program).keys());
}

/** How many times each name is BOUND anywhere in the program, over the same binding forms
 *  `collectDeclaredNames` covers. A count of one is what lets a rewrite treat a name as a single
 *  binding: two declarations of it, in any scopes, and it is not one value any more. */
export function countDeclarations(program: AstNode): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const names = { add: (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1) };
  walk(program, (n) => {
    switch (n.type) {
      case "VariableDeclarator":
        collectPatternNames((n as { id?: unknown }).id, names);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        // The function's own name binds too (`function Token(...)`), and an arrow has none.
        collectPatternNames((n as { id?: unknown }).id, names);
        for (const param of (n as { params?: AstNode[] }).params ?? []) {
          collectPatternNames(param, names);
        }
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        collectPatternNames((n as { id?: unknown }).id, names);
        return;
      case "CatchClause":
        collectPatternNames((n as { param?: unknown }).param, names);
        return;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
        // `local` is the name brought into scope — `import { a as Token }` binds `Token`.
        collectPatternNames((n as { local?: unknown }).local, names);
        return;
      default:
        return;
    }
  });
  return counts;
}
