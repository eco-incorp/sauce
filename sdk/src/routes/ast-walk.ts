/**
 * Shared acorn-AST plumbing for the routes/ source-rewrite passes (`token-rewrite.ts`,
 * `protocol-rewrite.ts`). Extracted verbatim from `token-rewrite.ts` (U4) so the two passes' whole-
 * program shadow semantics can never drift apart — see `token-rewrite.ts`'s own module doc for the
 * shadowing rationale (SauceScript shares scope across `if`/`while`/bare-block bodies, so this is
 * deliberately a coarser, whole-program-conservative check, not real lexical scoping).
 */
export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

/** Generic recursive descent over every object/array-shaped property -- deliberately not a
 *  hand-maintained per-node-type visitor table, since SauceScript's supported grammar surface is
 *  itself the only thing that can appear here, and a generic walk needs no per-type maintenance as
 *  that surface grows. */
export function walk(node: unknown, visit: (n: AstNode) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec.type === "string") {
    visit(rec as unknown as AstNode);
  }
  for (const key of Object.keys(rec)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range")
      continue;
    walk(rec[key], visit);
  }
}

/** Every name a binding PATTERN introduces -- an identifier, or any nesting of object/array
 *  destructuring, defaults and rest. Collecting only the `Identifier` case would miss
 *  `const { Token } = x` and `function f({ Token })`, which bind the name just as plainly. */
function collectPatternNames(pattern: unknown, names: Set<string>): void {
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
  const names = new Set<string>();
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
  return names;
}
