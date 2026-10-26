/**
 * The declaration a name read in a program resolves to, as the compiler scopes it
 * (`lexical-scope.ts`): the `const`/`let` declarator that binds it there, or the import, or none (a
 * parameter, a loop's or a `catch` clause's binding, a name the program does not declare). A pass
 * that follows a local to what it holds (`const b = a`) asks this rather than matching names, so a
 * name declared in another function or block is never taken for it.
 */
import type { AstNode } from "./ast-walk.js";
import { walkScoped, type Scope } from "./lexical-scope.js";

export interface LexicalBindings {
  /** The scope `node` is read in. */
  scopeAt(node: AstNode): Scope | undefined;
  /** The declarator (with an initializer) or import specifier `read`, an identifier, resolves to. */
  declarationOf(read: AstNode): AstNode | undefined;
}

const IMPORT_SPECIFIERS: ReadonlySet<string> = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
]);

const nameOf = (node: AstNode): string => (node as unknown as { name: string }).name;

/** The innermost scope from `scope` out that declares `name` at `position` (`shadowed`'s rule). */
function owner(scope: Scope | undefined, name: string, position: number): Scope | undefined {
  for (let s = scope; s !== undefined; s = s.parent) {
    const from = s.names.get(name);
    if (from !== undefined && from <= position) return s;
  }
  return undefined;
}

/** Every binding of `program`, by the scope that declares it. */
export function lexicalBindings(program: AstNode): LexicalBindings {
  const scopes = new Map<AstNode, Scope | undefined>();
  const declared = new Map<Scope, Map<string, AstNode>>();
  const declare = (scope: Scope | undefined, name: string, node: AstNode): void => {
    if (scope === undefined) return;
    let names = declared.get(scope);
    if (names === undefined) declared.set(scope, (names = new Map()));
    names.set(name, node);
  };
  // A module's declarations are its names everywhere in it: the module scope declares them too.
  const topLevel = new Set<AstNode>();
  for (const statement of program.body as AstNode[]) {
    const declaration =
      statement.type === "ExportNamedDeclaration" && statement.declaration
        ? (statement.declaration as AstNode)
        : statement;
    if (declaration.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations as AstNode[]) topLevel.add(declarator);
  }
  let module: Scope | undefined;
  walkScoped(program, (node, scope) => {
    scopes.set(node, scope);
    if (node.type === "Program") module = scope;
    const id = node.id as AstNode | undefined;
    if (node.type === "VariableDeclarator" && id?.type === "Identifier" && node.init) {
      declare(owner(scope, nameOf(id), node.end), nameOf(id), node);
      if (topLevel.has(node)) declare(module, nameOf(id), node);
    } else if (IMPORT_SPECIFIERS.has(node.type)) {
      declare(module, nameOf(node.local as AstNode), node);
    }
  });

  return {
    scopeAt: (node) => scopes.get(node),
    declarationOf: (read) => {
      const name = nameOf(read);
      const scope = owner(scopes.get(read), name, read.start);
      return scope === undefined ? undefined : declared.get(scope)?.get(name);
    },
  };
}
