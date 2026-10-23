/**
 * Where a program may use a name its chain lacks.
 *
 * Every name of the registry is declared on every chain (`chain-module.ts`), and a name the chain
 * lacks is zero there. The compiler decides a test of a zero while it compiles — `if (X)`, `!X`,
 * `X != 0`, `X == 0`, `?:`, `&&`, `||` — and does not compile the branch it rules out, so one program
 * can use a venue only on the chains that have it:
 *
 *   if (UniswapV3.Factory) { pool = UniswapV3.Factory.getPool(USDC, WETH, 500); }
 *
 * The compiler takes a zero anywhere a value goes, though, and this compiler has no value that
 * compares equal to zero, as `X == 0` needs, and is refused at run time. So without this check a use
 * of a name the chain lacks outside a branch its test rules out would compile to a call to, or a
 * transfer to, address zero. This check reads the program before anything rewrites it and refuses
 * such a use, at the use, naming the chain. It rewrites nothing: the compiler folds every test.
 *
 * A use is allowed where it is a test — the condition of an `if`, `?:` or loop, the operand of `!`,
 * a side of a comparison with `0`, either side of `&&` and `||` in a condition — and anywhere in a
 * branch a test of names rules out: an `if` or `?:` arm, the right side of `&&` or `||`, and the
 * rest of a statement list after a decided `if` that always returns. A decision is made only from
 * the registry's names, `true`, `false`, `!`, `&&`, `||` and comparisons with `0`; a branch behind
 * any other value is live, and a name the chain lacks in it is refused. So a helper only a ruled-out
 * branch calls is checked as if it ran: it names the venue under its own test, or is refused.
 *
 * The same read refuses what no chain can have: a contract a namespace does not have, an interface
 * used as a deployment, a family alias's contract more than one member has, a protocol used as a
 * contract, and `available(X)`, which is removed. A name the program declares is its own where the
 * compiler reads it so, and nowhere else (`Scope`): a block's `const` hides a registry name only in
 * that block and from its declaration on, so a use of the name after the block is the registry's.
 */
import type { CanonicalChain, ChainRef } from "../chains/canonical.js";
import type { AccessorTarget } from "./protocol-rewrite.js";

import { CANONICAL_CHAINS, requireChain } from "../chains/canonical.js";
import { collectPatternNames, isTypeDeclaration, TYPE_KEYS, type AstNode } from "./ast-walk.js";
import {
  CHAIN_MODULE,
  CHAIN_MODULE_ROOT,
  chainNamespaces,
  chainOfKey,
  type ChainNames,
  type NameEntry,
  type NamespaceEntry,
} from "./chain-module.js";
import { pascalOfSlug } from "./builder.js";
import { parseSauce } from "./parse.js";
import { resolveTokenMap } from "./token-registry.js";
import { BALANCE_MEMBER, POT_NAME } from "./pot-sugar.js";
import { SVM_VENUE_NAMESPACES } from "./svm-venue-methods.js";
import { locatedError, nearMatches } from "./unknown-global.js";

export interface NameCheckOptions {
  /** The chains a program may name (`Base.UniswapV3.Factory`). Default: every canonical chain. */
  readonly chainScope?: readonly ChainRef[];
  /** Told each deployed contract the program uses — a call or a value, not a test — as written. */
  readonly onContract?: (reference: string, target: AccessorTarget) => void;
}

export interface NameCheck {
  /** The chains the program names by key, whose modules the compile is handed. */
  readonly chainKeys: readonly CanonicalChain[];
}

/** The function `available(X)` was. */
const AVAILABLE = "available";

type Mode = "test" | "value";
/** What the node is to its parent: the callee of a call, the object of a member, the object of a
 *  `.at(…)` binding call, or the object a member is read from (`.getPool`), or anything else. */
type Role = "value" | "callee" | "at" | `.${string}`;

type Node = AstNode & Record<string, unknown>;
const prop = <T = Node>(node: AstNode, key: string): T => (node as Node)[key] as T;
const nameOf = (node: AstNode): string => prop<string>(node, "name");

/**
 * A scope, and where each name it declares starts to hide a registry name. The module's names and a
 * function's parameters hide one everywhere in it: the compiler reads a module's declarations in any
 * order. A `let` or `const` of a block (a function's body, a branch, a loop's) hides one from the end
 * of its declarator to the end of the block, and a loop's or a `catch` clause's binding only in the
 * loop or the clause: the compiler scopes each to its block and reads a name before its local
 * declaration as the outer one (and refuses `var`).
 */
interface Scope {
  readonly names: ReadonlyMap<string, number>;
  readonly parent?: Scope;
}

/** Whether `name`, read at `position`, is a name the program declares there. */
const shadowed = (scope: Scope | undefined, name: string, position: number): boolean => {
  for (let s = scope; s !== undefined; s = s.parent) {
    const from = s.names.get(name);
    if (from !== undefined && from <= position) return true;
  }
  return false;
};

/** A scope of `bindings`, each a pattern and the position it hides its names from. */
function scopeOf(
  bindings: readonly (readonly [AstNode | null | undefined, number])[],
  parent: Scope | undefined,
): Scope {
  const names = new Map<string, number>();
  for (const [pattern, from] of bindings) {
    const bound = new Set<string>();
    collectPatternNames(pattern, bound);
    for (const name of bound) names.set(name, Math.min(from, names.get(name) ?? from));
  }
  return { names, parent };
}

const isFunction = (node: AstNode): boolean =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

/** The child nodes of `node` in source order, types left out. */
function childrenOf(node: AstNode): AstNode[] {
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
function moduleScope(program: AstNode): Scope {
  const bindings: [AstNode | null | undefined, number][] = [];
  for (const statement of prop<AstNode[]>(program, "body")) {
    const declaration =
      (statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration") &&
      prop<AstNode | null>(statement, "declaration")
        ? prop<AstNode>(statement, "declaration")
        : statement;
    if (declaration.type === "VariableDeclaration") {
      for (const declarator of prop<AstNode[]>(declaration, "declarations")) {
        bindings.push([prop(declarator, "id"), 0]);
      }
    } else if (
      declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration"
    ) {
      bindings.push([prop(declaration, "id"), 0]);
    } else if (declaration.type === "ImportDeclaration") {
      for (const specifier of prop<AstNode[]>(declaration, "specifiers")) {
        bindings.push([prop(specifier, "local"), 0]);
      }
    }
  }
  return scopeOf(bindings, undefined);
}

/** A function's scope: its parameters, and a function expression's own name, everywhere in it. */
function functionScope(fn: AstNode, parent: Scope | undefined): Scope {
  return scopeOf(
    [
      ...(fn.type === "FunctionExpression" ? [[prop<AstNode>(fn, "id"), 0] as const] : []),
      ...(prop<AstNode[]>(fn, "params") ?? []).map((param) => [param, 0] as const),
    ],
    parent,
  );
}

/** A statement list's scope: each `let`/`const` from the end of its declarator, a function or class
 *  everywhere in the list. */
function blockScope(list: readonly AstNode[], parent: Scope | undefined): Scope {
  const bindings: [AstNode | null | undefined, number][] = [];
  for (const statement of list) {
    if (statement.type === "VariableDeclaration") {
      for (const declarator of prop<AstNode[]>(statement, "declarations")) {
        bindings.push([prop(declarator, "id"), declarator.end]);
      }
    } else if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      bindings.push([prop(statement, "id"), 0]);
    }
  }
  return scopeOf(bindings, parent);
}

/** `0` or `0n`, as written. */
function isZero(node: AstNode): boolean {
  if (node.type !== "Literal") return false;
  const value = prop<unknown>(node, "value");
  return value === 0 || value === 0n || prop<unknown>(node, "bigint") === "0";
}

/** `X` itself, through `X!` and `X as T`, which are types. */
function unwrap(node: AstNode): AstNode {
  let at = node;
  while (
    at.type === "TSNonNullExpression" ||
    at.type === "TSAsExpression" ||
    at.type === "TSSatisfiesExpression"
  ) {
    at = prop(at, "expression");
  }
  return at;
}

/** A list of chains for a message: every one, or the first few and how many more. */
function listed(slugs: readonly string[]): string {
  return slugs.length <= 8
    ? slugs.join(", ")
    : `${slugs.slice(0, 8).join(", ")} and ${slugs.length - 8} more`;
}

/** ` Did you mean `A` or `B`?` for the `candidates` nearest `name`, or nothing. */
function meant(name: string, candidates: Iterable<string>): string {
  const near = nearMatches(name, candidates);
  return near.length === 0 ? "" : ` Did you mean ${near.map((n) => `\`${n}\``).join(" or ")}?`;
}

/** A registry name a node reads, resolved on the chain it names. */
type Reference =
  | {
      readonly kind: "contract";
      readonly node: AstNode;
      /** As written: `UniswapV3.Factory`, `Base.UniswapV3.Factory`, `Lido` for `Lido.submit`. */
      readonly shown: string;
      readonly chain: CanonicalChain;
      readonly namespace: NamespaceEntry;
      readonly contract: string;
      readonly entry: NameEntry;
      /** `Lido.submit(…)`: the protocol's default contract, called through the namespace. */
      readonly viaDefault?: string;
    }
  | {
      readonly kind: "token";
      readonly node: AstNode;
      readonly symbol: string;
      readonly present: boolean | undefined;
    };

/**
 * Refuses every use of a name `names.chain` lacks that a test of it does not rule out, and every
 * registry name no chain can have, before the compiler reads `source`. Returns the chains the
 * program names by key.
 */
export function checkNames(
  source: string,
  names: ChainNames,
  options: NameCheckOptions & {
    /** The caller's defines: a define of a name is its value, and decides nothing here. */
    readonly defined?: ReadonlySet<string>;
    /** The module's path, as an error locates it: the entry is `main.js`, as the compiler names it. */
    readonly file?: string;
  } = {},
): NameCheck {
  const program = parseSauce(source);
  const chain = names.chain;
  const defined = options.defined ?? new Set<string>();
  const scope = options.chainScope?.map((ref) => requireChain(ref).id);
  const chainKeys = new Map<number, CanonicalChain>();

  const fail = (node: AstNode, message: string): never => {
    throw locatedError(source, options.file ?? "main.js", node, `compileSauceRoute: ${message}`);
  };

  const contractsOf = (namespace: NamespaceEntry): string =>
    [...namespace.members]
      .filter(([, entry]) => entry.kind !== "interface" && entry.kind !== "ambiguous")
      .map(([name]) => name)
      .join(", ");

  /** The namespace `node`, an identifier, names in `at`, when it is a registry namespace there. */
  const namespaceOf = (node: AstNode, at: Scope | undefined): NamespaceEntry | undefined => {
    const key = nameOf(node);
    return shadowed(at, key, node.start) || defined.has(key)
      ? undefined
      : names.namespaces.get(key);
  };

  /** The chain `node`, an identifier, names in `at`, when it is a chain key there. On a Solana
   *  chain, its own name (`Solana.pda(…)`) is the Solana lowering's. */
  const chainKeyOf = (node: AstNode, at: Scope | undefined): CanonicalChain | undefined => {
    const key = nameOf(node);
    if (shadowed(at, key, node.start) || defined.has(key)) return undefined;
    const on = chainOfKey(key);
    return on !== undefined && chain.kind === "svm" && on.kind === "svm" ? undefined : on;
  };

  /** Whether `node` is the Pot, `pot` or `ctx.self()`, where the program does not declare either. */
  const isThePot = (node: AstNode, at: Scope | undefined): boolean => {
    const target = unwrap(node);
    if (target.type === "Identifier") {
      return (
        nameOf(target) === POT_NAME &&
        !shadowed(at, POT_NAME, target.start) &&
        !defined.has(POT_NAME)
      );
    }
    if (target.type !== "CallExpression" || prop<AstNode[]>(target, "arguments").length > 0) {
      return false;
    }
    const callee = unwrap(prop(target, "callee"));
    if (callee.type !== "MemberExpression" || prop<boolean>(callee, "computed")) return false;
    const object = unwrap(prop(callee, "object"));
    const method = prop<AstNode>(callee, "property");
    return (
      object.type === "Identifier" &&
      nameOf(object) === "ctx" &&
      !shadowed(at, "ctx", object.start) &&
      method.type === "Identifier" &&
      nameOf(method) === "self"
    );
  };

  /** The member `<namespace>.<member>` of `on`'s namespace, as `node` reads it with `role`. */
  const member = (
    node: AstNode,
    shown: string,
    on: CanonicalChain,
    namespace: NamespaceEntry,
    name: string,
    role: Role,
  ): Reference => {
    const entry = namespace.members.get(name);
    if (entry === undefined) {
      const fallback =
        namespace.defaultContract === undefined
          ? undefined
          : namespace.members.get(namespace.defaultContract);
      const methods =
        fallback !== undefined && fallback.kind !== "ambiguous"
          ? new Set(fallback.descriptor.methods.map((method) => method.name))
          : new Set<string>();
      if (role === "callee" && methods.has(name)) {
        return {
          kind: "contract",
          node,
          shown: shown.slice(0, shown.lastIndexOf(".")),
          chain: on,
          namespace,
          contract: namespace.defaultContract!,
          entry: fallback!,
          viaDefault: name,
        };
      }
      return fail(
        node,
        `\`${shown}\` is not a contract of ${namespace.key}: it has ${contractsOf(namespace)}` +
          (namespace.defaultContract === undefined
            ? ""
            : `, and \`${namespace.key}.<method>(…)\` calls ${namespace.key}.${namespace.defaultContract}`) +
          "." +
          meant(name, [...namespace.members.keys(), ...methods]),
      );
    }
    switch (entry.kind) {
      case "ambiguous":
        fail(
          node,
          `\`${shown}\` is ambiguous under ${namespace.key} (${entry.owners.join(", ")}): write ` +
            entry.owners
              .map((slug) => `\`${shown.replace(namespace.key, pascalOfSlug(slug))}\``)
              .join(" or "),
        );
        break;
      case "interface":
        // Read as an object, an interface is the holder of a balance (`UniswapV3.Pool.WETH`), whose
        // refusal is the balance shorthand's, or a contract called with no address.
        if (role.startsWith(".")) {
          if (role === `.${BALANCE_MEMBER}` || names.tokens.has(role.slice(1))) break;
          fail(
            node,
            `\`${shown}${role}\`: \`${shown}\` is an interface, with no address of its own: give ` +
              `it the address, \`${shown}(<address>)${role}\`.`,
          );
        }
        if (role !== "callee" && role !== "at") {
          fail(
            node,
            `\`${shown}\` is an interface, with no address of its own: give it the address, ` +
              `\`${shown}(<address>)\`.`,
          );
        }
        break;
      case "refused":
        fail(node, entry.reason);
        break;
      case "address":
        if (role.startsWith(".") || role === "at") {
          fail(
            node,
            `${entry.descriptor.protocol}.${entry.descriptor.contract} has an address but no ABI ` +
              `vendored for this role (kind: "address-only"): its address is \`${shown}\`.`,
          );
        }
        break;
      default:
        break;
    }
    if (role === "callee" && entry.kind !== "interface") {
      fail(
        node,
        `\`${shown}(…)\` calls a deployed contract's name: call one of its methods, ` +
          `\`${shown}.<method>(…)\`, or bind its ABI to another address with ` +
          `\`${shown}.at(<address>).<method>(…)\`. Only an interface is called with an address.`,
      );
    }

    return { kind: "contract", node, shown, chain: on, namespace, contract: name, entry };
  };

  /**
   * The registry name `node` reads in `at`, with `role`: a contract (`UniswapV3.Factory`,
   * `Base.UniswapV3.Factory`, `Lido` of `Lido.submit`), a token (`USDT`), or undefined. A protocol or
   * chain read whole, and `available(...)`, are refused here.
   */
  const referenceOf = (node: AstNode, at: Scope | undefined, role: Role): Reference | undefined => {
    const target = unwrap(node);
    if (target.type === "Identifier") {
      const name = nameOf(target);
      if (shadowed(at, name, target.start) || defined.has(name)) return undefined;
      if (names.namespaces.has(name) && !role.startsWith(".")) {
        const namespace = names.namespaces.get(name)!;
        fail(
          target,
          `\`${name}\` is a protocol, not a contract: name one of its contracts, ` +
            `\`${name}.<Contract>\` (it has ${contractsOf(namespace)}).`,
        );
      }
      if (chainKeyOf(target, at) !== undefined && !role.startsWith(".")) {
        fail(
          target,
          `\`${name}\` is a chain: name a contract on it, \`${name}.<Protocol>.<Contract>\`.`,
        );
      }
      if (names.absentTokens.has(name)) {
        return { kind: "token", node: target, symbol: name, present: false };
      }
      const value = names.tokens.get(name);
      if (value !== undefined) {
        return { kind: "token", node: target, symbol: name, present: value !== 0n };
      }
      return undefined;
    }
    if (target.type !== "MemberExpression" || prop<boolean>(target, "computed")) return undefined;
    const object = unwrap(prop(target, "object"));
    const property = prop<AstNode>(target, "property");
    if (property.type !== "Identifier") return undefined;
    const name = nameOf(property);
    if (object.type === "Identifier") {
      // A Solana venue (`Orca.Whirlpool`, `Pancakeswap.CLMM`) is the Solana lowering's name.
      if (chain.kind === "svm" && `${nameOf(object)}.${name}` in SVM_VENUE_NAMESPACES) {
        return undefined;
      }
      const namespace = namespaceOf(object, at);
      if (namespace !== undefined) {
        return member(
          target,
          `${namespace.key}.${name}`,
          chain,
          namespace,
          name,
          role,
        );
      }
      const on = chainKeyOf(object, at);
      if (on !== undefined) {
        named(on, object);
        if (!role.startsWith(".")) {
          const namespace = chainNamespaces(on).get(name);
          fail(
            target,
            namespace === undefined
              ? `\`${nameOf(object)}.${name}\` is not a protocol on ${on.slug}.`
              : `\`${nameOf(object)}.${name}\` is a protocol, not a contract: name one of its ` +
                  `contracts, \`${nameOf(object)}.${name}.<Contract>\`.`,
          );
        }
      }
      return undefined;
    }
    if (object.type === "MemberExpression" && !prop<boolean>(object, "computed")) {
      const head = unwrap(prop(object, "object"));
      const middle = prop<AstNode>(object, "property");
      if (head.type !== "Identifier" || middle.type !== "Identifier") return undefined;
      const on = chainKeyOf(head, at);
      if (on === undefined) return undefined;
      named(on, head);
      const namespace = chainNamespaces(on).get(nameOf(middle));
      if (namespace === undefined) {
        fail(object, `\`${nameOf(head)}.${nameOf(middle)}\` is not a protocol on ${on.slug}.`);
      }
      return member(target, `${nameOf(head)}.${namespace!.key}.${name}`, on, namespace!, name, role);
    }

    return undefined;
  };

  /** A chain the program names by key: refused outside the scope, and on a Solana chain. */
  const named = (on: CanonicalChain, node: AstNode): void => {
    if (chain.kind !== "evm") {
      fail(
        node,
        `\`${nameOf(node)}\`: a chain's contracts by name are EVM addresses, which a program for ` +
          `${chain.slug} cannot use.`,
      );
    }
    if (scope !== undefined && !scope.includes(on.id)) {
      fail(
        node,
        `chain '${on.slug}' (referenced as '${nameOf(node)}....') is outside the allowed chainScope`,
      );
    }
    chainKeys.set(on.id, on);
  };

  /** Whether `reference` is a name its chain has (true), lacks (false), or neither is known. */
  const presence = (reference: Reference): boolean | undefined => {
    if (reference.kind === "token") return reference.present;
    switch (reference.entry.kind) {
      case "deployed":
      case "address":
        return true;
      case "absent":
        return false;
      default:
        return undefined;
    }
  };

  /** The first name in `node` its chain lacks, for a message. */
  const absentIn = (node: AstNode, at: Scope | undefined): Reference | undefined => {
    const target = unwrap(node);
    if (target.type === "Identifier" || target.type === "MemberExpression") {
      const reference = quietReference(target, at);
      if (reference !== undefined) return presence(reference) === false ? reference : undefined;
    }
    for (const child of childrenOf(target)) {
      const found = absentIn(child, at);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  /** The value of a test made only of registry names, booleans, `!`, `&&`, `||` and `== 0`. */
  const valueOf = (node: AstNode, at: Scope | undefined): boolean | undefined => {
    const target = unwrap(node);
    if (target.type === "Literal" && typeof prop(target, "value") === "boolean") {
      return prop<boolean>(target, "value");
    }
    if (target.type === "UnaryExpression" && prop<string>(target, "operator") === "!") {
      const inner = valueOf(prop(target, "argument"), at);
      return inner === undefined ? undefined : !inner;
    }
    if (target.type === "LogicalExpression") {
      const operator = prop<string>(target, "operator");
      const left = valueOf(prop(target, "left"), at);
      if (operator === "&&") {
        return left === false ? false : left === true ? valueOf(prop(target, "right"), at) : undefined;
      }
      if (operator === "||") {
        return left === true ? true : left === false ? valueOf(prop(target, "right"), at) : undefined;
      }
      return undefined;
    }
    if (target.type === "BinaryExpression") {
      const operator = prop<string>(target, "operator");
      const negate = operator === "==" || operator === "===";
      if (!negate && operator !== "!=" && operator !== "!==") return undefined;
      const other = zeroComparison(target);
      if (other === undefined) return undefined;
      const inner = valueOf(other, at);
      return inner === undefined ? undefined : negate ? !inner : inner;
    }
    if (target.type === "Identifier" || target.type === "MemberExpression") {
      const reference = quietReference(target, at);
      return reference === undefined ? undefined : presence(reference);
    }
    return undefined;
  };

  /** `referenceOf` for a decision: a name that is no registry name decides nothing, and an error
   *  is the visit's to raise, where it is reached. */
  const quietReference = (node: AstNode, at: Scope | undefined): Reference | undefined => {
    try {
      return referenceOf(node, at, "value");
    } catch {
      return undefined;
    }
  };

  /** The side of `left == right` that is not a literal zero, when one side is. */
  const zeroComparison = (node: AstNode): AstNode | undefined => {
    const left = prop<AstNode>(node, "left");
    const right = prop<AstNode>(node, "right");
    return isZero(right) ? left : isZero(left) ? right : undefined;
  };

  /** Whether control never continues past `node` once the tests in it are decided. */
  const exits = (node: AstNode | null | undefined, at: Scope | undefined): boolean => {
    if (node === null || node === undefined) return false;
    if (node.type === "ReturnStatement" || node.type === "ThrowStatement") return true;
    if (node.type === "BlockStatement") {
      const list = prop<AstNode[]>(node, "body");
      const inner = blockScope(list, at);
      return list.some((statement) => exits(statement, inner));
    }
    if (node.type === "IfStatement") {
      const taken = valueOf(prop(node, "test"), at);
      if (taken === true) return exits(prop(node, "consequent"), at);
      if (taken === false) return exits(prop(node, "alternate"), at);
      return exits(prop(node, "consequent"), at) && exits(prop(node, "alternate"), at);
    }
    return false;
  };

  /** A use of `reference` in `mode`, as `role`: refused where the chain lacks the name. */
  const use = (reference: Reference, mode: Mode, role: Role): void => {
    const asTest = mode === "test" && role === "value";
    if (reference.kind === "token") {
      if (reference.present === false && !asTest) {
        const elsewhere = CANONICAL_CHAINS.filter((on) =>
          resolveTokenMap(on).has(reference.symbol),
        ).map((on) => on.slug);
        fail(
          reference.node,
          `\`${reference.symbol}\` is not a token on ${chain.slug}.` +
            meant(reference.symbol, names.tokens.keys()) +
            " A token the chain lacks is zero there, and only a test of it may use it: " +
            `\`if (${reference.symbol}) { … }\` compiles the branch only where the chain has it.` +
            (elsewhere.length === 0 ? "" : ` It is a token on ${listed(elsewhere)}.`) +
            " A token the registry does not carry is `Token(<address>)`, its address a parameter " +
            "of main.",
        );
      }
      return;
    }
    const { entry } = reference;
    if (entry.kind === "absent" && !asTest && role !== "at") {
      const where = entry.descriptor.chains;
      const contract = `${reference.namespace.key}.${reference.contract}`;
      const deployed = [...reference.namespace.members]
        .filter(([, other]) => other.kind === "deployed" || other.kind === "address")
        .map(([name]) => name);
      fail(
        reference.node,
        (reference.viaDefault === undefined
          ? `\`${reference.shown}\` is not deployed on ${reference.chain.slug}.` +
            meant(reference.contract, deployed)
          : `\`${reference.shown}.${reference.viaDefault}(…)\` calls ${contract}, which is not ` +
            `deployed on ${reference.chain.slug}.`) +
          " A contract the chain lacks is zero there, and only a test of it may use it: " +
          `\`if (${reference.viaDefault === undefined ? reference.shown : contract}) { … }\` ` +
          "compiles the branch only where the chain has it." +
          (where.length === 0 ? "" : ` It is deployed on ${listed(where)}.`),
      );
    }
    if ((entry.kind === "deployed" || entry.kind === "address") && !asTest && role !== "at") {
      options.onContract?.(reference.shown, {
        chain: reference.chain,
        protocol: entry.descriptor.protocol,
        contract: entry.descriptor.contract,
        descriptor: entry.descriptor,
        address: entry.address,
      });
    }
  };

  /** Visits the statements of a list in its own scope, skipping the rest after a decided `if` that
   *  always exits. */
  const statements = (list: readonly AstNode[], outer: Scope | undefined): void => {
    const at = blockScope(list, outer);
    let dead = false;
    for (const statement of list) {
      if (dead) {
        // A function declared in a dead tail is still declared: it may be called from before.
        if (statement.type === "FunctionDeclaration") visit(statement, "value", "value", at);
        continue;
      }
      visit(statement, "value", "value", at);
      if (statement.type === "ReturnStatement" || statement.type === "ThrowStatement") dead = true;
      if (
        statement.type === "IfStatement" &&
        valueOf(prop(statement, "test"), at) !== undefined &&
        exits(statement, at)
      ) {
        dead = true;
      }
    }
  };

  const visit = (node: AstNode, mode: Mode, role: Role, at: Scope | undefined): void => {
    if (isTypeDeclaration(node.type)) return;

    if (isFunction(node)) {
      const inner = functionScope(node, at);
      for (const param of prop<AstNode[]>(node, "params") ?? []) defaults(param, inner);
      const body = prop<AstNode>(node, "body");
      if (body.type === "BlockStatement") statements(prop(body, "body"), inner);
      else visit(body, "value", "value", inner);
      return;
    }

    switch (node.type) {
      case "Program":
        statements(prop(node, "body"), at);
        return;
      case "BlockStatement":
        statements(prop(node, "body"), at);
        return;
      case "ImportDeclaration": {
        // The chain's names are read with no import. Imported under a name of the program's own,
        // a name the chain lacks would be the program's, and no check would see its uses.
        const specifier = String(prop<Node>(node, "source")["value"] ?? "");
        if (
          specifier === CHAIN_MODULE ||
          specifier.startsWith(`${CHAIN_MODULE}-`) ||
          specifier.includes(CHAIN_MODULE_ROOT.slice(1))
        ) {
          fail(
            node,
            `\`${specifier}\` is the chain's names, which a program reads with no import: write ` +
              "`UniswapV3.Factory`, `USDC`, `Base.UniswapV3.Factory` as they are.",
          );
        }
        return;
      }
      case "TSImportEqualsDeclaration":
        return;
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration": {
        const declaration = prop<AstNode | null>(node, "declaration");
        if (declaration !== null && declaration !== undefined) visit(declaration, mode, role, at);
        return;
      }
      case "VariableDeclarator":
        defaults(prop(node, "id"), at);
        if (prop<AstNode | null>(node, "init")) visit(prop(node, "init"), "value", "value", at);
        return;
      case "LabeledStatement":
        visit(prop(node, "body"), mode, role, at);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
      case "IfStatement": {
        visit(prop(node, "test"), "test", "value", at);
        const taken = valueOf(prop(node, "test"), at);
        const alternate = prop<AstNode | null>(node, "alternate");
        if (taken !== false) visit(prop(node, "consequent"), "value", "value", at);
        if (taken !== true && alternate) visit(alternate, "value", "value", at);
        return;
      }
      case "ConditionalExpression": {
        visit(prop(node, "test"), "test", "value", at);
        const taken = valueOf(prop(node, "test"), at);
        if (taken !== false) visit(prop(node, "consequent"), mode, "value", at);
        if (taken !== true) visit(prop(node, "alternate"), mode, "value", at);
        return;
      }
      case "WhileStatement":
      case "DoWhileStatement":
        visit(prop(node, "test"), "test", "value", at);
        visit(prop(node, "body"), "value", "value", at);
        return;
      case "ForStatement": {
        // A `let`/`const` of the loop's head is the loop's, from its declarator on.
        const init = prop<AstNode | null>(node, "init");
        const loop = init?.type === "VariableDeclaration" ? blockScope([init], at) : at;
        for (const key of ["init", "update"]) {
          const part = prop<AstNode | null>(node, key);
          if (part) visit(part, "value", "value", loop);
        }
        if (prop<AstNode | null>(node, "test")) visit(prop(node, "test"), "test", "value", loop);
        visit(prop(node, "body"), "value", "value", loop);
        return;
      }
      case "ForOfStatement":
      case "ForInStatement": {
        // Its binding is the body's: what it iterates is read outside it.
        const left = prop<AstNode>(node, "left");
        const loop =
          left.type === "VariableDeclaration"
            ? scopeOf(
                prop<AstNode[]>(left, "declarations").map(
                  (declarator) => [prop<AstNode>(declarator, "id"), 0] as const,
                ),
                at,
              )
            : at;
        visit(left, "value", "value", at);
        visit(prop(node, "right"), "value", "value", at);
        visit(prop(node, "body"), "value", "value", loop);
        return;
      }
      case "CatchClause": {
        const param = prop<AstNode | null>(node, "param");
        defaults(param, at);
        visit(prop(node, "body"), "value", "value", scopeOf([[param, 0]], at));
        return;
      }
      case "UnaryExpression":
        visit(
          prop(node, "argument"),
          prop<string>(node, "operator") === "!" ? "test" : "value",
          "value",
          at,
        );
        return;
      case "LogicalExpression": {
        const operator = prop<string>(node, "operator");
        const left = prop<AstNode>(node, "left");
        const right = prop<AstNode>(node, "right");
        if (operator !== "&&" && operator !== "||") {
          visit(left, "value", "value", at);
          visit(right, "value", "value", at);
          return;
        }
        // Where the left side decides the whole, the right side is not compiled, and the whole is
        // the left side (`X || y` with `X` present is `X`; `X && y` with `X` lacking is `X`): a test
        // only tests it, while a value is it, which a name the chain lacks must not be. Where it
        // does not, the left side is only tested, and the whole is the right side.
        const decided = valueOf(left, at);
        if (decided === undefined) {
          visit(left, mode, "value", at);
          visit(right, mode, "value", at);
          return;
        }
        const shortCircuits = decided === (operator === "||");
        visit(left, shortCircuits ? mode : "test", "value", at);
        if (!shortCircuits) visit(right, mode, "value", at);
        return;
      }
      case "BinaryExpression": {
        const operator = prop<string>(node, "operator");
        const other =
          operator === "==" || operator === "!=" || operator === "===" || operator === "!=="
            ? zeroComparison(node)
            : undefined;
        if (other !== undefined) {
          visit(other, "test", "value", at);
          return;
        }
        break;
      }
      case "CallExpression": {
        const callee = prop<AstNode>(node, "callee");
        const target = unwrap(callee);
        if (
          target.type === "Identifier" &&
          nameOf(target) === AVAILABLE &&
          !shadowed(at, AVAILABLE, target.start) &&
          !defined.has(AVAILABLE)
        ) {
          fail(node, "`available(X)` is removed: test the name itself, `if (X)`.");
        }
        // `require(X != 0)` on a chain without `X` fails whatever the program does: refused here.
        const [condition] = prop<AstNode[]>(node, "arguments");
        const absent =
          target.type === "Identifier" &&
          nameOf(target) === "require" &&
          !shadowed(at, "require", target.start) &&
          condition !== undefined &&
          valueOf(condition, at) === false
            ? absentIn(condition, at)
            : undefined;
        if (absent !== undefined) {
          const [name, what, on] =
            absent.kind === "token"
              ? [absent.symbol, "a token", chain.slug]
              : [absent.shown, "deployed", absent.chain.slug];
          fail(
            node,
            `\`${source.slice(node.start, node.end)}\` fails on ${chain.slug} whatever the program ` +
              `does: \`${name}\` is not ${what} on ${on}.`,
          );
        }
        // `<Contract>.at(<address>)`: the contract's ABI at the program's address.
        if (
          target.type === "MemberExpression" &&
          !prop<boolean>(target, "computed") &&
          prop<AstNode>(target, "property").type === "Identifier" &&
          nameOf(prop(target, "property")) === "at"
        ) {
          visit(prop(target, "object"), mode, "at", at);
        } else {
          visit(callee, mode, "callee", at);
        }
        for (const argument of prop<AstNode[]>(node, "arguments")) {
          visit(argument, "value", "value", at);
        }
        return;
      }
      case "Identifier":
      case "MemberExpression": {
        const reference = referenceOf(node, at, role);
        if (reference !== undefined) {
          use(reference, mode, role);
          return;
        }
        if (node.type === "MemberExpression") {
          const property = prop<AstNode>(node, "property");
          const read =
            !prop<boolean>(node, "computed") && property.type === "Identifier"
              ? nameOf(property)
              : "[…]";
          // The Pot's balance of a token the chain lacks (`pot.WETH`, `ctx.self().WETH`) is a use of
          // the token, refused where a test of it does not rule the read out. The Pot is never a
          // record, so no field of that name can be meant; another holder's may be one, which the
          // compile reads or refuses.
          if (
            names.absentTokens.has(read) &&
            !defined.has(read) &&
            !shadowed(at, read, node.start) &&
            isThePot(prop(node, "object"), at)
          ) {
            use({ kind: "token", node: property, symbol: read, present: false }, "value", "value");
          }
          visit(prop(node, "object"), mode, `.${read}`, at);
          if (prop<boolean>(node, "computed")) visit(prop(node, "property"), "value", "value", at);
        }
        return;
      }
      case "Property":
        if (prop<boolean>(node, "computed")) visit(prop(node, "key"), "value", "value", at);
        visit(prop(node, "value"), "value", "value", at);
        return;
      case "TSNonNullExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
        visit(prop(node, "expression"), mode, role, at);
        return;
      default:
        break;
    }
    for (const child of childrenOf(node)) visit(child, "value", "value", at);
  };

  /** The default values of a binding pattern, which are read where it binds. */
  const defaults = (pattern: AstNode | null | undefined, at: Scope | undefined): void => {
    if (pattern === null || pattern === undefined) return;
    switch (pattern.type) {
      case "AssignmentPattern":
        defaults(prop(pattern, "left"), at);
        visit(prop(pattern, "right"), "value", "value", at);
        return;
      case "ObjectPattern":
        for (const property of prop<AstNode[]>(pattern, "properties")) {
          if (property.type === "RestElement") defaults(prop(property, "argument"), at);
          else {
            if (prop<boolean>(property, "computed")) {
              visit(prop(property, "key"), "value", "value", at);
            }
            defaults(prop(property, "value"), at);
          }
        }
        return;
      case "ArrayPattern":
        for (const element of prop<(AstNode | null)[]>(pattern, "elements")) {
          defaults(element, at);
        }
        return;
      case "RestElement":
        defaults(prop(pattern, "argument"), at);
        return;
      default:
        return;
    }
  };

  const module = moduleScope(program);
  visit(program, "value", "value", module);

  return { chainKeys: [...chainKeys.values()] };
}
