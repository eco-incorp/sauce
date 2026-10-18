/**
 * What the balance shorthand's holder is, as far as a program's text says: `<holder>.<TOKEN>` reads
 * the holder's balance of a token (`token-rewrite.ts` on an EVM chain, `svm-token-rewrite.ts` on
 * Solana), and any address-valued holder takes it. The rewrite sees no types, so a holder is taken
 * for an address unless the program says it is not one: a record or a list, written as a literal,
 * declared with a record or list type, initialized with one, or returned as one by the program's own
 * function. On such a holder a property named like a token is refused rather than read as a field:
 * the name is reserved for the shorthand.
 *
 * Name-based and whole-program, like the rewrites' shadowing check (`ast-walk.ts`): a name bound to
 * a record anywhere is a record everywhere.
 */
import { walk, type AstNode } from "./ast-walk.js";

/** What a value is, as its declaration says: an address or number, a record, or a list of a kind. */
type Shape =
  | { readonly kind: "scalar" }
  | { readonly kind: "record" }
  | { readonly kind: "list"; readonly element: Shape | undefined };

const SCALAR: Shape = { kind: "scalar" };
const RECORD: Shape = { kind: "record" };

const nameOf = (node: AstNode): string => (node as unknown as { name: string }).name;

/** The names a program binds to a record or a list, and its functions that return one. */
export interface HolderShapes {
  /** By name: the shape of every value the name is bound to that is not a scalar. */
  readonly names: ReadonlyMap<string, Shape>;
  /** By name: the shape a program function's return annotation declares, when not a scalar. */
  readonly returns: ReadonlyMap<string, Shape>;
}

/** The program's own type declarations, by name: `interface Leg { … }`, `type Pair = […]`. */
function typeDeclarations(program: AstNode): ReadonlyMap<string, AstNode> {
  const types = new Map<string, AstNode>();
  for (const statement of (program as { body?: AstNode[] }).body ?? []) {
    const node =
      statement.type === "ExportNamedDeclaration"
        ? ((statement as { declaration?: AstNode | null }).declaration ?? undefined)
        : statement;
    const id = (node as { id?: AstNode } | undefined)?.id;
    if (id?.type !== "Identifier") continue;
    if (node!.type === "TSInterfaceDeclaration") types.set(nameOf(id), node!);
    if (node!.type === "TSTypeAliasDeclaration") {
      types.set(nameOf(id), (node as unknown as { typeAnnotation: AstNode }).typeAnnotation);
    }
  }

  return types;
}

/** The shape a type annotation declares. */
function shapeOfType(
  type: AstNode | undefined,
  types: ReadonlyMap<string, AstNode>,
  seen = new Set<string>(),
): Shape | undefined {
  if (type === undefined) return undefined;
  switch (type.type) {
    case "TSTypeLiteral":
    case "TSTupleType":
    case "TSInterfaceDeclaration":
      return RECORD;
    case "TSArrayType":
      return { kind: "list", element: shapeOfType(type.elementType as AstNode, types, seen) };
    case "TSTypeReference": {
      const name = type.typeName as AstNode | undefined;
      if (name?.type !== "Identifier") return undefined;
      const declared = types.get(nameOf(name));
      if (declared === undefined || seen.has(nameOf(name))) return SCALAR;
      return shapeOfType(declared, types, new Set([...seen, nameOf(name)]));
    }
    default:
      return SCALAR;
  }
}

/** The shape a declarator's or parameter's annotation gives. */
function annotated(id: AstNode, types: ReadonlyMap<string, AstNode>): Shape | undefined {
  const annotation = (id as { typeAnnotation?: { typeAnnotation?: AstNode } }).typeAnnotation;

  return shapeOfType(annotation?.typeAnnotation, types);
}

/** The shape a value expression has, as far as its own text says. */
function shapeOfValue(node: AstNode | null | undefined, shapes: HolderShapes): Shape | undefined {
  if (node === null || node === undefined) return undefined;
  switch (node.type) {
    case "ObjectExpression":
      return RECORD;
    case "ArrayExpression": {
      const elements = ((node as { elements?: (AstNode | null)[] }).elements ?? []).map((one) =>
        shapeOfValue(one, shapes),
      );
      const element = elements.find((one) => one !== undefined && one.kind !== "scalar");

      return { kind: "list", element: element ?? (elements.length > 0 ? SCALAR : undefined) };
    }
    case "NewExpression":
      return { kind: "list", element: undefined };
    case "Identifier":
      return shapes.names.get(nameOf(node));
    case "CallExpression": {
      const callee = node.callee as AstNode;
      if (callee.type === "Identifier") return shapes.returns.get(nameOf(callee));
      // `abi.decode(data, [...])` gives its values as a tuple.
      if (
        callee.type === "MemberExpression" &&
        (callee.object as AstNode).type === "Identifier" &&
        nameOf(callee.object as AstNode) === "abi" &&
        (callee.property as AstNode).type === "Identifier" &&
        nameOf(callee.property as AstNode) === "decode"
      ) {
        return RECORD;
      }
      return undefined;
    }
    case "MemberExpression": {
      if ((node as { computed?: boolean }).computed !== true) return undefined;
      const of = shapeOfValue(node.object as AstNode, shapes);
      return of?.kind === "list" ? of.element : undefined;
    }
    default:
      return undefined;
  }
}

/** Every name the program binds to a record or a list, and the functions that return one. */
export function holderShapes(program: AstNode): HolderShapes {
  const types = typeDeclarations(program);
  const names = new Map<string, Shape>();
  const returns = new Map<string, Shape>();
  const shapes: HolderShapes = { names, returns };
  const bind = (id: AstNode | undefined, shape: Shape | undefined): void => {
    if (id?.type !== "Identifier" || shape === undefined || shape.kind === "scalar") return;
    if (!names.has(nameOf(id))) names.set(nameOf(id), shape);
  };
  walk(program, (n) => {
    if (n.type === "FunctionDeclaration") {
      const id = n.id as AstNode | null;
      const result = shapeOfType(
        (n as { returnType?: { typeAnnotation?: AstNode } }).returnType?.typeAnnotation,
        types,
      );
      if (id?.type === "Identifier" && result !== undefined && result.kind !== "scalar") {
        returns.set(nameOf(id), result);
      }
    }
    if (
      n.type === "FunctionDeclaration" ||
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression"
    ) {
      for (const param of (n as { params?: AstNode[] }).params ?? []) {
        bind(param, annotated(param, types));
      }
    }
  });
  // Declarations after the functions, so a value a function returns is known; twice, so a name
  // bound from another declared later is too.
  for (let pass = 0; pass < 2; pass++) {
    walk(program, (n) => {
      if (n.type === "VariableDeclarator") {
        const id = n.id as AstNode;
        bind(id, annotated(id, types) ?? shapeOfValue(n.init as AstNode | null, shapes));
      }
      if (n.type === "ForOfStatement") {
        const left = n.left as AstNode;
        const declared =
          left.type === "VariableDeclaration"
            ? ((left as { declarations?: AstNode[] }).declarations?.[0]?.id as AstNode | undefined)
            : left;
        const list = shapeOfValue(n.right as AstNode, shapes);
        if (list?.kind === "list") bind(declared, list.element);
      }
    });
  }

  return shapes;
}

/** What `holder` is, when its text says it is not an address: "a record" or "a list". */
export function notAnAddress(holder: AstNode, shapes: HolderShapes): string | undefined {
  const shape = shapeOfValue(holder, shapes);
  if (shape?.kind === "record") return "a record";
  if (shape?.kind === "list") return "a list";
  if (holder.type === "Literal" && typeof (holder as { value?: unknown }).value === "string") {
    return "a string";
  }

  return undefined;
}

/** The refusal of `<holder>.<name>` on a holder that is not an address. */
export function reservedNameError(
  spelled: string,
  holder: string,
  what: string,
  name: string,
  kind: "token" | "native coin",
): Error {
  return new Error(
    `${spelled}: \`${holder}\` is ${what}, not an address, and \`${name}\` names ${kind === "token" ? "a token" : "the native coin"}: ` +
      `\`<holder>.${name}\` reads a holder's ${name} balance, so the name is reserved for that and ` +
      `cannot be a field. Name the field otherwise (\`${name.toLowerCase()}\`), or read the balance of an ` +
      `address it holds (\`${holder}.<field>.${name}\`).`,
  );
}
