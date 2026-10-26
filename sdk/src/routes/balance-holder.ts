/**
 * What the balance shorthand's holder is, as far as a program's text says: `<holder>.<TOKEN>` reads
 * the holder's balance of a token and `<holder>.balance` its native coin (`token-rewrite.ts` on an
 * EVM chain, `svm-token-rewrite.ts` on Solana), and any address-valued holder takes them. The
 * rewrite sees no types, so a holder is taken for an address unless the program says it is not one:
 * a record or a list, written as a literal, declared with a record or list type, initialized with
 * one, or returned as one by the program's own function. On such a holder a property named like a
 * token is refused rather than read as a field: the name is reserved for the shorthand. `balance`
 * is not reserved: on a record, a list, or a value whose type the text does not show (a contract
 * call's result, which may be a struct with a `balance` field, or a name imported from a module) it
 * stays the field it always was (`readsField`).
 *
 * Lexical, as the compiler scopes (`lexical-scope.ts`): a shape belongs to the binding that
 * declares it, and a name is read as the binding in scope where it stands, so a record bound in one
 * function says nothing of a parameter of the same name in another, nor a loop's record of the
 * parameter it hides.
 */
import { collectPatternBinders, walk, type AstNode } from "./ast-walk.js";
import { bindingOf, walkScoped } from "./lexical-scope.js";

/**
 * What a value is, as its declaration says: an address or number, a record, a list of a kind, or
 * one whose type only the compiler knows (a contract call's result).
 */
type Shape =
  | { readonly kind: "scalar" }
  /** A record, and where its declaration says, each field's shape (undefined: a scalar). */
  | { readonly kind: "record"; readonly fields?: ReadonlyMap<string, Shape | undefined> }
  | { readonly kind: "unknown" }
  | { readonly kind: "list"; readonly element: Shape | undefined };

const SCALAR: Shape = { kind: "scalar" };
const RECORD: Shape = { kind: "record" };
const UNKNOWN: Shape = { kind: "unknown" };

/** The language's namespaces, whose calls return a number, bytes or a decoded tuple, never a struct
 *  a contract defines. */
const BUILTIN_ROOTS: ReadonlySet<string> = new Set(["ctx", "crypto", "Math", "abi", "evm", "svm"]);

const nameOf = (node: AstNode): string => (node as unknown as { name: string }).name;

/** The shapes of a program's bindings that are not scalars, and of its functions' results. */
export interface HolderShapes {
  /** By the identifier that declares it: the shape of each binding that is not a scalar. */
  readonly bindings: ReadonlyMap<AstNode, Shape>;
  /** By the identifier that names it: the shape a program function's return annotation declares,
   *  when not a scalar. */
  readonly returns: ReadonlyMap<AstNode, Shape>;
  /** The identifiers an import declares. */
  readonly imports: ReadonlySet<AstNode>;
  /** By each identifier the program reads: the identifier that declares the binding it reads. */
  readonly binders: ReadonlyMap<AstNode, AstNode>;
  /** Whether a call binds a contract to an address (`Pool.at(market)`): its value is that address. */
  readonly bindsContract: (call: AstNode) => boolean;
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
    case "TSInterfaceDeclaration": {
      const members =
        type.type === "TSTypeLiteral"
          ? (type as { members?: AstNode[] }).members
          : (type as { body?: { body?: AstNode[] } }).body?.body;
      const fields = new Map<string, Shape | undefined>();
      for (const member of members ?? []) {
        const key = member.key as AstNode | undefined;
        if (member.type !== "TSPropertySignature" || key?.type !== "Identifier") continue;
        const annotation = (member as { typeAnnotation?: { typeAnnotation?: AstNode } })
          .typeAnnotation?.typeAnnotation;
        fields.set(nameOf(key), shapeOfType(annotation, types, seen));
      }
      return { kind: "record", fields };
    }
    case "TSTupleType":
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

/** The shape of one `abi.decode` field, as its string spells it: `"Address"`, `"Uint256[]"`,
 *  `"{Uint256, bool}"` (a record with unnamed fields). */
function shapeOfDecoded(spelled: string): Shape {
  const type = spelled.trim();
  if (type.endsWith("]")) {
    return { kind: "list", element: shapeOfDecoded(type.slice(0, type.lastIndexOf("["))) };
  }

  return type.startsWith("{") ? RECORD : SCALAR;
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
    case "ObjectExpression": {
      const fields = new Map<string, Shape | undefined>();
      for (const property of (node as { properties?: AstNode[] }).properties ?? []) {
        const key = property.key as AstNode | undefined;
        if (property.type !== "Property" || property.computed || key?.type !== "Identifier") {
          continue;
        }
        fields.set(nameOf(key), shapeOfValue(property.value as AstNode, shapes) ?? SCALAR);
      }
      return { kind: "record", fields };
    }
    case "ArrayExpression": {
      const elements = ((node as { elements?: (AstNode | null)[] }).elements ?? []).map((one) =>
        shapeOfValue(one, shapes),
      );
      const element = elements.find((one) => one !== undefined && one.kind !== "scalar");

      return { kind: "list", element: element ?? (elements.length > 0 ? SCALAR : undefined) };
    }
    case "NewExpression":
      return { kind: "list", element: undefined };
    case "Identifier": {
      const binder = shapes.binders.get(node);
      return binder === undefined ? undefined : shapes.bindings.get(binder);
    }
    case "CallExpression": {
      const callee = node.callee as AstNode;
      if (callee.type === "Identifier") {
        const binder = shapes.binders.get(callee);
        if (binder === undefined) return undefined;
        // A function imported from a module returns what its module says, which this text does not.
        return shapes.returns.get(binder) ?? (shapes.imports.has(binder) ? UNKNOWN : undefined);
      }
      if (callee.type !== "MemberExpression") return UNKNOWN;
      // A contract bound to an address is that address.
      if (shapes.bindsContract(node)) return SCALAR;
      const object = callee.object as AstNode;
      const property = callee.property as AstNode;
      if (
        object.type === "Identifier" &&
        BUILTIN_ROOTS.has(nameOf(object)) &&
        !shapes.binders.has(object)
      ) {
        if (
          nameOf(object) !== "abi" ||
          property.type !== "Identifier" ||
          nameOf(property) !== "decode"
        ) {
          return undefined;
        }
        // `abi.decode(data, ["Address", "{Uint256, bool}"])` gives a record of those fields, by
        // position; the other builtins a number or bytes.
        const spelled = ((node.arguments as AstNode[] | undefined) ?? [])[1];
        const fields = new Map<string, Shape | undefined>();
        for (const element of spelled?.type === "ArrayExpression"
          ? (spelled.elements as (AstNode | null)[])
          : []) {
          fields.set(
            String(fields.size),
            element?.type === "Literal" && typeof element.value === "string"
              ? shapeOfDecoded(element.value)
              : UNKNOWN,
          );
        }
        return { kind: "record", fields };
      }
      // A contract's method (`market.userCollateral(a, b)`): its result may be a struct.
      return UNKNOWN;
    }
    case "MemberExpression": {
      const of = shapeOfValue(node.object as AstNode, shapes);
      if ((node as { computed?: boolean }).computed === true) {
        if (of?.kind === "list") return of.element;
        // A record's field selected by its constant position: that field's shape. Any other index
        // of a record, or of a value whose type the text does not show, is a value of unknown type.
        if (of?.kind !== "record" && of?.kind !== "unknown") return undefined;
        const index = node.property as AstNode;
        const position =
          index.type === "Literal" &&
          (typeof index.value === "number" || typeof index.value === "bigint")
            ? Number(index.value)
            : undefined;
        const fields = of.kind === "record" ? [...(of.fields?.values() ?? [])] : [];
        return position !== undefined && position < fields.length
          ? (fields[position] ?? SCALAR)
          : UNKNOWN;
      }
      // A field: of a record whose declaration types it, that type; of a value whose type the text
      // does not show, or a record whose fields it does not name, a value of unknown type too.
      if (of?.kind === "unknown") return UNKNOWN;
      if (of?.kind !== "record") return undefined;
      const property = node.property as AstNode;
      const field = property.type === "Identifier" ? nameOf(property) : undefined;
      return field !== undefined && of.fields?.has(field) === true
        ? (of.fields.get(field) ?? SCALAR)
        : UNKNOWN;
    }
    default:
      return undefined;
  }
}

/**
 * The shape of every binding the program makes to a record, a list or a value of a type it does
 * not show, and of each of its functions that returns a record or a list, with the binding each
 * name read is of. `bindsContract` says which calls bind a contract to an address, which only the
 * caller knows (the registry's contracts, the ABIs a program imports); by default none.
 */
export function holderShapes(
  program: AstNode,
  bindsContract: (call: AstNode, binders: ReadonlyMap<AstNode, AstNode>) => boolean = () => false,
): HolderShapes {
  const types = typeDeclarations(program);
  const bindings = new Map<AstNode, Shape>();
  const returns = new Map<AstNode, Shape>();
  const imports = new Set<AstNode>();
  const binders = new Map<AstNode, AstNode>();
  walkScoped(program, (n, scope) => {
    if (n.type !== "Identifier") return;
    const binder = bindingOf(scope, nameOf(n), n.start);
    if (binder !== undefined) binders.set(n, binder);
  });
  walk(program, (n) => {
    if (n.type !== "ImportDeclaration") return;
    for (const specifier of (n as { specifiers?: AstNode[] }).specifiers ?? []) {
      collectPatternBinders(specifier.local, (local) => imports.add(local));
    }
  });
  const shapes: HolderShapes = {
    bindings,
    returns,
    imports,
    binders,
    bindsContract: (call) => bindsContract(call, binders),
  };
  const bind = (id: AstNode | undefined, shape: Shape | undefined): void => {
    if (id?.type !== "Identifier" || shape === undefined || shape.kind === "scalar") return;
    if (!bindings.has(id)) bindings.set(id, shape);
  };
  /** `pattern` bound to a value of `shape`: an array pattern's element is the field at its
   *  position; any part of a value whose fields the text does not show is of unknown type. */
  const bindPattern = (pattern: AstNode | null | undefined, shape: Shape | undefined): void => {
    if (pattern === null || pattern === undefined) return;
    if (pattern.type === "Identifier") {
      bind(pattern, shape);
      return;
    }
    if (pattern.type === "ArrayPattern" && shape?.kind === "record" && shape.fields !== undefined) {
      const fields = [...shape.fields.values()];
      (pattern.elements as (AstNode | null)[]).forEach((element, position) =>
        bindPattern(element, position < fields.length ? fields[position] : UNKNOWN),
      );
      return;
    }
    // `const [a, b] = market.positions(x)`: each part of a value of unknown type is one too.
    if (shape?.kind !== "unknown" && shape?.kind !== "record") return;
    collectPatternBinders(pattern, (binder) => bind(binder, UNKNOWN));
  };
  // An import's binding has the type its module gives it, which this text does not show.
  for (const local of imports) bindings.set(local, UNKNOWN);
  walk(program, (n) => {
    if (n.type === "FunctionDeclaration") {
      const id = n.id as AstNode | null;
      const result = shapeOfType(
        (n as { returnType?: { typeAnnotation?: AstNode } }).returnType?.typeAnnotation,
        types,
      );
      if (id?.type === "Identifier" && result !== undefined && result.kind !== "scalar") {
        returns.set(id, result);
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
  // Declarations after the functions, so a value a function returns is known; twice, so a binding
  // made from another declared later is too.
  for (let pass = 0; pass < 2; pass++) {
    walk(program, (n) => {
      if (n.type === "VariableDeclarator") {
        const id = n.id as AstNode;
        bindPattern(id, annotated(id, types) ?? shapeOfValue(n.init as AstNode | null, shapes));
      }
      if (n.type === "ForOfStatement") {
        const left = n.left as AstNode;
        // A loop's own binding, or the binding it assigns each element to.
        const declared =
          left.type === "VariableDeclaration"
            ? ((left as { declarations?: AstNode[] }).declarations?.[0]?.id as AstNode | undefined)
            : binders.get(left);
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

/**
 * Whether `<holder>.balance` is the holder's own field rather than its native-coin balance: a
 * record, a list or a string, or a value whose type the text does not show — a contract call's
 * result, which may be a struct with a `balance` field (Compound's `userCollateral`), or a name
 * imported from a module. The compiler then reads the field, as it always did.
 */
export function readsField(holder: AstNode, shapes: HolderShapes): boolean {
  return (
    notAnAddress(holder, shapes) !== undefined || shapeOfValue(holder, shapes)?.kind === "unknown"
  );
}

/** The refusal of `<holder>.<TOKEN>` on a holder that is not an address. */
export function reservedNameError(
  spelled: string,
  holder: string,
  what: string,
  name: string,
): Error {
  return new Error(
    `${spelled}: \`${holder}\` is ${what}, not an address, and \`${name}\` names a token: ` +
      `\`<holder>.${name}\` reads a holder's ${name} balance, so the name is reserved for that and ` +
      `cannot be a field. Name the field otherwise (\`${name.toLowerCase()}\`), or read the balance of an ` +
      `address it holds (\`${holder}.<field>.${name}\`).`,
  );
}
