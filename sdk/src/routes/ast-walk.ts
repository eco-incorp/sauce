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
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
    walk(rec[key], visit);
  }
}

/** Every name introduced by a `let`/`const`/`var` declarator or a function parameter, anywhere in
 *  the tree -- deliberately whole-program, not scope-sensitive (see the module doc's shadowing note). */
export function collectDeclaredNames(program: AstNode): ReadonlySet<string> {
  const names = new Set<string>();
  walk(program, (n) => {
    if (n.type === "VariableDeclarator" && (n as { id?: AstNode }).id?.type === "Identifier") {
      const id = (n as { id?: AstNode }).id as unknown as { name: string };
      names.add(id.name);
    }
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
      const params = (n as { params?: AstNode[] }).params ?? [];
      for (const p of params) {
        if (p.type === "Identifier") names.add((p as unknown as { name: string }).name);
      }
    }
  });
  return names;
}
