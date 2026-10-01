/**
 * The program an intent body compiles to, and what each of its names means there.
 *
 * `Chain(() => { ... }).reward(...)` written in a file compiles a body that is not plain token
 * writes as a program of its own, for the destination (`intent-sugar.ts`). The body was written in
 * the file, so it reads the file's names, and each one is exactly one of:
 *
 *  - the body's OWN local — declared in the body, in any binding form;
 *  - a CAPTURE — a local of the function that opens the intent (in a script, of its top-level
 *    statements). Its value exists only while the enclosing program runs, so it becomes a parameter
 *    of the child's `main` and the enclosing program splices it in;
 *  - a DECLARATION OF THE FILE — a function, an import, an interface or a module-level variable.
 *    It is the same text wherever it compiles, so the child program carries it: the declarations
 *    the body reaches, and the ones those reach, and nothing else. A declaration reaches what it
 *    names freely; its own parameters and locals are not references to the file's names;
 *  - anything else — a builtin (`ctx`, `abi`), a token symbol or define, a protocol namespace, a
 *    chain to open an intent on — is the child compile's to resolve for its own chain.
 *
 * Lexical, the way the compiler reads the file: a local of the opening function shadows a file
 * declaration of the same name.
 *
 * A module-level `let` the program carries is ALSO captured: the program declares it as written and
 * its `main` first assigns it the value it has where the intent opens. That is the value the reward
 * and the delivery splice in, so the body and every function it calls see the same number the
 * intent was funded with, rather than the declaration's initial one.
 *
 * A top-level `const` of a literal (`const AMOUNT = 1000000n;`) is the opposite case: its value is
 * fixed when the file is compiled, so it is never captured. It is a declaration of the file in a
 * script too, where the other top-level statements are the entry: there is nothing for the entry to
 * compute, and the intent lowering reads its value as it reads a define's.
 */
import { collectPatternNames, isTypeDeclaration, TYPE_KEYS, type AstNode } from "./ast-walk.js";

/** A top-level declaration a child program may carry. */
interface Declaration {
  /** The declaration itself — an `export` around it unwrapped. */
  readonly node: AstNode;
  readonly kind: "function" | "type" | "variable";
  /** A module-level `let` (or `var`): scratch state whose value the program is handed. */
  readonly mutable: boolean;
  /** The names it reads freely, types included: what carrying it carries along. */
  readonly mentions: ReadonlySet<string>;
  /** The value of a top-level `const` of a literal: fixed when the file is compiled. */
  readonly literal?: bigint;
}

/** The value a literal folds to — an integer, a bigint or a boolean — or `undefined`. */
export function literalValue(node: unknown): bigint | undefined {
  if ((node as AstNode | null | undefined)?.type !== "Literal") return undefined;
  const value = (node as { value?: unknown }).value;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "boolean") return value ? 1n : 0n;
  return undefined;
}

/** The names a `const` statement binds to literals, each with its value; a declarator of any
 *  other form (a pattern, a computed value) is left out. */
function literalConsts(node: AstNode): Map<string, bigint> {
  const values = new Map<string, bigint>();
  if ((node as { kind?: string }).kind !== "const") return values;
  for (const declarator of (node as { declarations?: AstNode[] }).declarations ?? []) {
    const id = (declarator as { id?: AstNode }).id;
    const value = literalValue((declarator as { init?: unknown }).init);
    if (id?.type === "Identifier" && value !== undefined) values.set(nameOf(id), value);
  }
  return values;
}

/** One name an `import` binds. */
interface ImportBinding {
  readonly declaration: AstNode;
  readonly specifier: AstNode;
}

/** The file's top level, as a child program sees it. */
export interface ModuleScope {
  /** A file with no `main`: its top-level statements are the entry, and their names are locals. */
  readonly script: boolean;
  readonly declarations: ReadonlyMap<string, Declaration>;
  readonly imports: ReadonlyMap<string, ImportBinding>;
  /** The entry: `main`, or a script's top-level statements. */
  readonly entry: readonly AstNode[];
}

/** What `childProgram` produces for one body. */
export interface ChildProgram {
  /** A complete module: the carried declarations, then `main` with the captures as parameters. */
  readonly source: string;
  /** What the enclosing program splices in, in the order `main` takes them: the opening function's
   *  locals the body reads, then the module-level `let`s the program carries. */
  readonly captures: readonly string[];
  /** The file's functions the program carries, by name. */
  readonly carriedFunctions: ReadonlySet<string>;
}

const nameOf = (node: AstNode): string => (node as unknown as { name: string }).name;

/** A top-level statement with any `export` around it removed. */
function unwrapExport(statement: AstNode): AstNode {
  if (statement.type === "ExportNamedDeclaration") {
    const declaration = (statement as { declaration?: AstNode | null }).declaration;
    if (declaration) return declaration;
  }
  return statement;
}

/**
 * The names `nodes` read, in first-read order. Member properties (`a.b`) and object keys
 * (`{ b: 1n }`) are names but not reads; a shorthand `{ amount }` is a read of `amount`. With
 * `types`, a type reference (`leg: Leg`) counts too.
 */
function namesRead(nodes: readonly unknown[], types: boolean): string[] {
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const rec = node as Record<string, unknown> & { type?: string };
    if (typeof rec.type === "string") {
      if (!types && isTypeDeclaration(rec.type)) return;
      switch (rec.type) {
        case "Identifier":
          seen.add(nameOf(rec as unknown as AstNode));
          break;
        case "MemberExpression":
          visit(rec.object);
          if (rec.computed === true) visit(rec.property);
          return;
        case "Property":
          if (rec.computed === true) visit(rec.key);
          visit(rec.value);
          return;
        case "TSQualifiedName":
          visit(rec.left);
          return;
        case "TSPropertySignature":
          if (types) visit(rec.typeAnnotation);
          return;
        default:
          break;
      }
    }
    for (const key of Object.keys(rec)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      if (!types && TYPE_KEYS.has(key)) continue;
      visit(rec[key]);
    }
  };
  visit(nodes);
  return [...seen];
}

/**
 * The names `nodes` declare, every binding form included, without entering an arrow function: an
 * arrow is an intent body or a `.catch()` handler, and what it declares is its own.
 */
function declaredOutsideArrows(nodes: readonly unknown[]): Set<string> {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const rec = node as Record<string, unknown> & { type?: string };
    switch (rec.type) {
      case "ArrowFunctionExpression":
        return;
      case "VariableDeclarator":
        collectPatternNames(rec.id, names);
        visit(rec.init);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
        collectPatternNames(rec.id, names);
        for (const param of (rec.params as unknown[] | undefined) ?? []) {
          collectPatternNames(param, names);
        }
        visit(rec.body);
        return;
      case "CatchClause":
        collectPatternNames(rec.param, names);
        visit(rec.body);
        return;
      default:
        break;
    }
    for (const key of Object.keys(rec)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      if (TYPE_KEYS.has(key)) continue;
      visit(rec[key]);
    }
  };
  visit(nodes);
  return names;
}

/** The names `nodes` read that they do not bind themselves, types included. */
function freeNames(nodes: readonly AstNode[]): string[] {
  const bound = bodyLocals(nodes);
  return namesRead(nodes, true).filter((name) => !bound.has(name));
}

/** Every name the body binds, in every binding form and at any depth — its own, not a capture. */
function bodyLocals(body: readonly AstNode[]): Set<string> {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const rec = node as Record<string, unknown> & { type?: string };
    if (rec.type === "VariableDeclarator") collectPatternNames(rec.id, names);
    if (
      rec.type === "FunctionDeclaration" ||
      rec.type === "FunctionExpression" ||
      rec.type === "ArrowFunctionExpression"
    ) {
      collectPatternNames(rec.id, names);
      for (const param of (rec.params as unknown[] | undefined) ?? []) {
        collectPatternNames(param, names);
      }
    }
    if (rec.type === "CatchClause") collectPatternNames(rec.param, names);
    for (const key of Object.keys(rec)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
      if (TYPE_KEYS.has(key)) continue;
      visit(rec[key]);
    }
  };
  visit(body);
  return names;
}

const isMain = (node: AstNode): boolean =>
  node.type === "FunctionDeclaration" &&
  (node as { id?: AstNode | null }).id?.type === "Identifier" &&
  nameOf((node as unknown as { id: AstNode }).id) === "main";

/** Reads the file's top level: which names it declares, and what is its entry. */
export function moduleScope(program: AstNode): ModuleScope {
  const statements = topLevel(program).map(unwrapExport);
  const main = statements.find(isMain);
  const script = main === undefined;
  const declarations = new Map<string, Declaration>();
  const imports = new Map<string, ImportBinding>();
  const entry: AstNode[] = [];

  for (const node of statements) {
    if (node.type === "ImportDeclaration") {
      for (const specifier of (node as { specifiers?: AstNode[] }).specifiers ?? []) {
        const local = (specifier as { local?: AstNode }).local;
        if (local) imports.set(nameOf(local), { declaration: node, specifier });
      }
      continue;
    }
    if (node.type === "FunctionDeclaration") {
      if (node === main) continue;
      const id = (node as { id?: AstNode | null }).id;
      if (id) {
        declarations.set(nameOf(id), {
          node,
          kind: "function",
          mutable: false,
          mentions: new Set(freeNames([node])),
        });
      }
      continue;
    }
    if (isTypeDeclaration(node.type)) {
      const id = (node as { id?: AstNode | null }).id;
      if (id?.type === "Identifier") {
        declarations.set(nameOf(id), {
          node,
          kind: "type",
          mutable: false,
          mentions: new Set(freeNames([node])),
        });
      }
      continue;
    }
    // A module's own top-level variable. In a script there is none: its top-level statements are
    // the entry, so what they declare are locals of it — except a `const` binding only literals,
    // which is fixed when the file is compiled wherever it stands.
    if (node.type === "VariableDeclaration") {
      const names = new Set<string>();
      for (const declarator of (node as { declarations?: AstNode[] }).declarations ?? []) {
        collectPatternNames((declarator as { id?: unknown }).id, names);
      }
      const literals = literalConsts(node);
      if (!script || (names.size > 0 && literals.size === names.size)) {
        const mentions = new Set(freeNames([node]));
        const mutable = (node as { kind?: string }).kind !== "const";
        for (const name of names) {
          declarations.set(name, {
            node,
            kind: "variable",
            mutable,
            mentions,
            ...(literals.has(name) ? { literal: literals.get(name)! } : {}),
          });
        }
        continue;
      }
    }
    if (script) entry.push(node);
  }
  if (main !== undefined) entry.push(main);

  return { script, declarations, imports, entry };
}

/**
 * A module's top-level statements — or, for a closure entry (`() => { … }`, compiled with
 * `entryKind: "closure"`), its block's: the compiler declares the functions there module functions
 * and runs the rest as `main`, which is a script's reading of the same statements.
 */
function topLevel(program: AstNode): AstNode[] {
  const body = (program as { body?: AstNode[] }).body ?? [];
  const [only] = body;
  if (body.length === 1 && only!.type === "ExpressionStatement") {
    const closure = (only as { expression?: AstNode }).expression;
    if (closure?.type === "ArrowFunctionExpression" || closure?.type === "FunctionExpression") {
      const block = (closure as { body?: AstNode }).body;
      return block?.type === "BlockStatement" ? ((block as { body?: AstNode[] }).body ?? []) : [];
    }
  }
  return body;
}

/** The top-level function a site sits in, if it is not at a script's top level. */
function enclosingFunction(program: AstNode, at: number): AstNode | undefined {
  return ((program as { body?: AstNode[] }).body ?? [])
    .map(unwrapExport)
    .find((node) => node.type === "FunctionDeclaration" && node.start <= at && at < node.end);
}

/**
 * The locals a site's enclosing program has where the site stands: the opening function's
 * parameters and declarations, or a script's top-level ones. These are what a capture can be, and
 * what the reward and delivery may name.
 */
export function enclosingLocals(
  program: AstNode,
  scope: ModuleScope,
  at: number,
): ReadonlySet<string> {
  const fn = enclosingFunction(program, at);
  if (fn !== undefined) {
    // Its parameters and what its body declares. Not its own name: that is a file declaration.
    const names = declaredOutsideArrows([(fn as { body?: AstNode }).body]);
    for (const param of (fn as { params?: AstNode[] }).params ?? []) {
      collectPatternNames(param, names);
    }
    return names;
  }
  // A script: its top-level statements are `main`'s body.
  return declaredOutsideArrows(scope.entry);
}

/** An `import` line binding only `bindings` of the declaration they share. */
function importLine(source: string, declaration: AstNode, bindings: readonly AstNode[]): string {
  const from = (declaration as unknown as { source: AstNode }).source;
  const tail = source.slice(from.start, declaration.end).trimEnd();
  const kind = (declaration as { importKind?: string }).importKind === "type" ? "type " : "";
  const text = (specifier: AstNode) => source.slice(specifier.start, specifier.end);
  const leading = bindings
    .filter((b) => b.type !== "ImportSpecifier")
    .map(text)
    .join(", ");
  const named = bindings.filter((b) => b.type === "ImportSpecifier").map(text);
  const clause = [leading, named.length > 0 ? `{ ${named.join(", ")} }` : ""]
    .filter((part) => part !== "")
    .join(", ");
  return `import ${kind}${clause} from ${tail}${tail.endsWith(";") ? "" : ";"}`;
}

class IntentBodyError extends Error {}

/**
 * The program `body` (a site's statements, written at `[bodyStart, bodyEnd)` of `source`)
 * compiles to: its captures as `main`'s parameters, and the file's declarations it reaches.
 *
 * `compileTimeNames` are names the child compile resolves itself (its chain's defines): never a
 * capture, even where a local of the same name exists.
 */
export function childProgram(
  source: string,
  program: AstNode,
  scope: ModuleScope,
  site: { readonly start: number; readonly end: number },
  body: readonly AstNode[],
  bodyText: string,
  compileTimeNames: ReadonlySet<string>,
): ChildProgram {
  const own = bodyLocals(body);
  const locals = enclosingLocals(program, scope, site.start);
  const reads = namesRead(body, false).filter(
    (name) => !own.has(name) && !compileTimeNames.has(name),
  );

  // The file's declarations the body reaches, then the ones those reach, until nothing new does.
  const carriedDeclarations = new Set<Declaration>();
  const carriedImports = new Set<ImportBinding>();
  const pending = namesRead(body, true).filter((name) => !own.has(name) && !locals.has(name));
  const visited = new Set<string>();
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (visited.has(name)) continue;
    visited.add(name);
    const binding = scope.imports.get(name);
    if (binding !== undefined) {
      carriedImports.add(binding);
      continue;
    }
    const declaration = scope.declarations.get(name);
    if (declaration === undefined) continue;
    if (declaration.node.start <= site.start && site.end <= declaration.node.end) {
      throw new IntentBodyError(
        `intent sugar: an intent body calls \`${name}\`, the function that opens it. Its program ` +
          `would have to contain the intent it is the body of. Move the body's logic into a ` +
          `function of its own and call that instead.`,
      );
    }
    carriedDeclarations.add(declaration);
    pending.push(...declaration.mentions);
  }

  // The module-level `let`s the program carries, each handed the value it has at the site. One
  // the opening function shadows cannot be read there, so it cannot be handed over.
  const lets = new Set<string>();
  for (const [name, declaration] of scope.declarations) {
    if (!declaration.mutable || !carriedDeclarations.has(declaration)) continue;
    if (locals.has(name)) {
      throw new IntentBodyError(
        `intent sugar: the intent body uses the module variable \`${name}\`, which a local of the ` +
          `function opening the intent shadows, so its value there cannot be handed to the body's ` +
          `program. Rename the local or the module variable.`,
      );
    }
    lets.add(name);
  }
  const captures = [
    ...reads.filter((name) => locals.has(name) || lets.has(name)),
    ...[...lets].filter((name) => !reads.includes(name)),
  ];
  const parameters = captures.map((name) => (lets.has(name) ? `__sauce_let_${name}` : name));
  const prologue = captures
    .filter((name) => lets.has(name))
    .map((name) => `${name} = __sauce_let_${name};\n`)
    .join("");

  const imports: string[] = [];
  const byDeclaration = new Map<AstNode, AstNode[]>();
  for (const { declaration, specifier } of carriedImports) {
    const list = byDeclaration.get(declaration) ?? [];
    list.push(specifier);
    byDeclaration.set(declaration, list);
  }
  for (const [declaration, specifiers] of [...byDeclaration].sort(
    ([a], [b]) => a.start - b.start,
  )) {
    imports.push(
      importLine(
        source,
        declaration,
        specifiers.sort((a, b) => a.start - b.start),
      ),
    );
  }
  const declarations = [...new Set([...carriedDeclarations].map((d) => d.node))]
    .sort((a, b) => a.start - b.start)
    .map((node) => source.slice(node.start, node.end));

  const prelude = [...imports, ...(imports.length > 0 ? [""] : []), ...declarations]
    .map((text) => `${text}\n`)
    .join("");
  const carriedFunctions = new Set(
    [...carriedDeclarations]
      .filter((d) => d.kind === "function")
      .map((d) => nameOf((d.node as unknown as { id: AstNode }).id)),
  );

  return {
    source: `${prelude}${prelude === "" ? "" : "\n"}function main(${parameters.join(", ")}) {\n${prologue}${bodyText}\n}`,
    captures,
    carriedFunctions,
  };
}

/**
 * The file's functions nothing the enclosing program still runs reaches — after its intent bodies
 * have been lowered away — among `candidates`. Those moved into a child program, and only there are
 * they compiled for the chain they run on.
 */
export function unreachedFunctions(
  scope: ModuleScope,
  candidates: ReadonlySet<string>,
): ReadonlySet<string> {
  // What the entry reads, and what every declaration that stays reads: the compiler checks every
  // function in the file, called or not, so a function that stays keeps whatever it calls.
  const reached = new Set<string>();
  const pending = freeNames(scope.entry);
  for (const [name, declaration] of scope.declarations) {
    if (!candidates.has(name)) pending.push(...declaration.mentions);
  }
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (reached.has(name)) continue;
    reached.add(name);
    const declaration = scope.declarations.get(name);
    if (declaration !== undefined) pending.push(...declaration.mentions);
  }
  return new Set([...candidates].filter((name) => !reached.has(name)));
}
