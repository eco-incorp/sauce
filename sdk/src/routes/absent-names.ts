/**
 * Where a program may use a name its chain lacks.
 *
 * Every name of the registry is a name on every chain (`chain-module.ts`), and a name the chain
 * lacks is zero there: a contract in its namespace's module, a token where the check writes a test
 * of it `0` (`zeros`), so no module declares ~1,800 tokens. The compiler decides a test of a zero
 * while it compiles — `if (X)`, `!X`, `X != 0`, `X == 0`, `?:`, `&&`, `||` — and does not compile
 * the branch it rules out, so one program can use a venue only on the chains that have it:
 *
 *   if (UniswapV3.Factory) { pool = UniswapV3.Factory.getPool(USDC, WETH, 500); }
 *
 * The compiler takes a zero anywhere a value goes, though, and this compiler has no value that
 * compares equal to zero, as `X == 0` needs, and is refused at run time. So without this check a use
 * of a name the chain lacks outside a branch its test rules out would compile to a call to, or a
 * transfer to, address zero. This check reads the program before anything rewrites it and refuses
 * such a use, at the use, naming the chain. The compiler folds every test; the check reports the
 * code a test rules out (`dead`), which the route compiler blanks (`withoutDead`) before its own
 * rewrites, so a ruled-out token write, balance read, venue call or binding adds no account, check
 * or binding the program would not have.
 *
 * A use is allowed where it is a test — the condition of an `if`, `?:` or loop, the operand of `!`,
 * a side of a comparison with `0`, either side of `&&` and `||` in a condition — and anywhere in a
 * branch a test of names rules out: an `if` or `?:` arm, the right side of `&&` or `||`, and the
 * rest of a statement list after a decided `if` that always returns. A decision is made only from
 * the registry's names, `true`, `false`, `!`, `&&`, `||` and comparisons with `0`; a branch behind
 * any other value is live, and a name the chain lacks in it is refused. So a helper only a ruled-out
 * branch calls is checked as if it ran: it names the venue under its own test, or is refused.
 *
 * The same read refuses what no chain can have: a contract a namespace does not have, a method its
 * ABI does not have, an interface used as a deployment, a family alias's contract more than one
 * member has, a protocol used as a contract, and `available(X)`, which is removed. It refuses them
 * in code a test rules out too, read as on a chain that takes the branch, where only a name this
 * chain lacks is let be; and there it reports each name nothing it knows gives meaning to (`unknown`)
 * and refuses a balance read of an address the text declares by a name no chain registers as a
 * token, which the compiler and the balance shorthand would refuse where the branch is compiled. A
 * name the program declares is its own where the compiler reads it so, and nowhere else
 * (`lexical-scope.ts`): a block's `const` hides a registry name only in that block and from its
 * declaration on, so a use of the name after the block is the registry's. A name the caller binds
 * (`defined`) is the caller's everywhere.
 */
import type { CanonicalChain, ChainRef } from "../chains/canonical.js";
import type { AccessorTarget } from "./protocol-rewrite.js";

import { CANONICAL_CHAINS, requireChain } from "../chains/canonical.js";
import { nativeCoinSymbol } from "../chains/index.js";
import { collectDeclaredNames, isTypeDeclaration, type AstNode } from "./ast-walk.js";
import { BUILTIN_GLOBALS } from "./builtins.generated.js";
import { CHAIN_KEY_SET, NAMESPACE_KEYS } from "./accessor-index.js";
import {
  CHAIN_MODULE,
  inChainModuleRoot,
  namesRefusal,
  chainNamespaces,
  chainOfKey,
  everySymbol,
  type ChainNames,
  type NameEntry,
  type NamespaceEntry,
} from "./chain-module.js";
import { pascalOfSlug } from "./builder.js";
import {
  bindingOf,
  blockScope,
  catchScope,
  childrenOf,
  forOfBodyScope,
  forScope,
  functionScope,
  isFunction,
  moduleScope,
  shadowed,
  type Scope,
} from "./lexical-scope.js";
import { lexicalBindings } from "./lexical-bindings.js";
import { parseSauce } from "./parse.js";
import { SCALAR_METHODS } from "./protocol-rewrite.js";
import { resolveTokenMap } from "./token-registry.js";
import {
  BALANCE_MEMBER,
  OWNER_NAME,
  POT_NAME,
  RETIRED_POT_NAME,
  selfRefusal,
} from "./pot-sugar.js";
import {
  ACCOUNT_FACTORY,
  ACCOUNT_MEMBERS,
  evmAccountRefusal,
  RETIRED_ACCOUNT_ROOT,
  retiredAccountRefusal,
} from "./svm-account-expressions.js";
import { SVM_VENUE_NAMESPACES } from "./svm-venue-methods.js";
import { TOKEN_FACTORY_NAME } from "./token-rewrite.js";
import { locatedError, meant, notAToken, notTokenOrProtocol } from "./unknown-global.js";

export interface NameCheckOptions {
  /** The chains a program may name (`Base.UniswapV3.Factory`). Default: every canonical chain. */
  readonly chainScope?: readonly ChainRef[];
  /** Told each deployed contract the program uses — a call or a value, not a test — as written. */
  readonly onContract?: (reference: string, target: AccessorTarget) => void;
}

export interface NameCheck {
  /** The chains the program names by key, whose modules the compile is handed. */
  readonly chainKeys: readonly CanonicalChain[];
  /** What a test of names rules out, in source order, none inside another (`withoutDead`). */
  readonly dead: readonly DeadCode[];
  /** Each side of a `&&`/`||` whose whole is a value that is, or may be, a contract binding, in
   *  source order: `withoutDead` makes it `!!(…)`, so the whole is the bool the language says. */
  readonly bindingSides: readonly { readonly start: number; readonly end: number }[];
  /** Each read of a token symbol the chain lacks, every one a test (any other use is refused), in
   *  source order: `withoutDead` writes it `0`, its value here, so no module declares it. */
  readonly zeros: readonly { readonly start: number; readonly end: number }[];
  /** Each name code a test rules out reads that nothing the check knows gives meaning to, in source
   *  order: what the caller binds that the check cannot see — another chain's define, an ambient
   *  module's export — or else refused (`unknownNameError`), as the compile refuses it where the
   *  branch is compiled. */
  readonly unknown: readonly UnknownName[];
}

/** A name read in code a test rules out that nothing the check knows gives meaning to. */
export interface UnknownName {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** As the program reads it: the root of a member (`X.y`), called (`X(…)`), or a value. */
  readonly form: "member" | "call" | "value";
}

/**
 * The refusal of `unknown`, a name of `source` (the module `file`) compiled for `chain`, whose
 * tokens are `tokens`, at the name: worded as the compile words it where the branch is compiled, a
 * member's root as a token or protocol nothing names, with the nearest names of any chain.
 */
export function unknownNameError(
  source: string,
  file: string,
  chain: CanonicalChain,
  tokens: ReadonlyMap<string, bigint>,
  unknown: UnknownName,
): Error {
  const { name, form } = unknown;
  const registry = [...tokens.keys(), ...everySymbol(), ...NAMESPACE_KEYS];
  const message =
    form === "member"
      ? notTokenOrProtocol(name, chain, registry)
      : `compileSauceRoute: \`${name}\` ${form === "call" ? "is called but never declared" : "is not a declared variable"}.` +
        meant(name, [...registry, ...collectDeclaredNames(parseSauce(source)), ...LANGUAGE_NAMES]);
  const node: AstNode = { type: "Identifier", start: unknown.start, end: unknown.end };

  return locatedError(source, file, node, message);
}

/**
 * The names the language gives meaning to with no declaration: each builtin's root, generated from
 * the SauceScript reference's `builtins.json` (`BUILTIN_GLOBALS`); `undefined`, which the reference
 * gives a missing static member (`{ a: 1, b: undefined }`) and no builtin is; the SDK's Pot and
 * `Token(addr)`; and Solana's accounts, `Account(…)` and the Pot's owner, `owner`.
 */
export const LANGUAGE_NAMES: ReadonlySet<string> = new Set([
  ...BUILTIN_GLOBALS,
  "undefined",
  POT_NAME,
  TOKEN_FACTORY_NAME,
  ACCOUNT_FACTORY,
  OWNER_NAME,
]);

/** Solana's accounts, which a program compiled for an EVM chain cannot name. */
const SOLANA_ACCOUNTS: ReadonlySet<string> = new Set([ACCOUNT_FACTORY, OWNER_NAME]);

/** The protocols a Solana venue is written under (`Orca` of `Orca.Whirlpool`): the Solana lowering's. */
const SVM_VENUE_ROOTS: ReadonlySet<string> = new Set(
  Object.keys(SVM_VENUE_NAMESPACES).map((namespace) => namespace.split(".")[0]!),
);

/** The language's types whose value has no field (`skills/sauce-script`'s reference): a number, a
 *  bool, bytes, an account. A type named otherwise may be a record. */
const SCALAR_TYPES: ReadonlySet<string> = new Set([
  "Address",
  "Uint256",
  "Int256",
  "bool",
  "bytes",
  "Account",
  "TSNumberKeyword",
  "TSBigIntKeyword",
  "TSBooleanKeyword",
  "TSStringKeyword",
]);

/** What a member of a value of a scalar type may be beside a balance: `.length` of bytes, and an
 *  account's fields and roles. */
const VALUE_MEMBERS: ReadonlySet<string> = new Set(["length", ...ACCOUNT_MEMBERS]);

/**
 * Code a test of names rules out: an `if` arm (`statement`), a `?:` arm or the right side of a
 * decided `&&`/`||` (`expression`), or a statement of a list after a decided `if` that always
 * exits (`tail`).
 */
export interface DeadCode {
  readonly start: number;
  readonly end: number;
  readonly kind: "statement" | "expression" | "tail";
}

/**
 * `source` with the code `dead` names blanked, every other character where it was: a statement of
 * a dead tail becomes spaces, an `if` arm `{ }` and an expression `0`, each padded with spaces, its
 * newlines kept. The compiler folds a decided test whichever way it reads, so the program compiles
 * as it did; the SDK's rewrites, which run after the check, then see only code that compiles. Each
 * of `bindingSides` becomes `!!(…)`: 2.6.0 gives a contract binding under `&&`/`||` back as the
 * whole, where the language gives true or false, and `!!` is that bool (a constant folds to the
 * same bytes). Each of `zeros`, a token the chain lacks, becomes `0`, padded with spaces. These are
 * the only characters that move.
 */
export function withoutDead(
  source: string,
  dead: readonly DeadCode[],
  bindingSides: readonly { readonly start: number; readonly end: number }[] = [],
  zeros: readonly { readonly start: number; readonly end: number }[] = [],
): string {
  if (dead.length === 0 && bindingSides.length === 0 && zeros.length === 0) return source;
  const blank = (text: string): string => text.replace(/[^\n]/g, " ");
  const edits = [
    ...dead.map(({ start, end, kind }) => {
      const text = source.slice(start, end);
      return {
        start,
        end,
        text:
          kind === "tail"
            ? blank(text)
            : kind === "expression"
              ? `0${blank(text.slice(1))}`
              : text.length < 2
                ? text
                : `{${blank(text.slice(1, -1))}}`,
      };
    }),
    ...bindingSides.flatMap(({ start, end }) => [
      { start, end: start, text: "!!(" },
      { start: end, end, text: ")" },
    ]),
    ...zeros.map(({ start, end }) => ({ start, end, text: `0${" ".repeat(end - start - 1)}` })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: string[] = [];
  let cursor = 0;
  for (const { start, end, text } of edits) {
    out.push(source.slice(cursor, start), text);
    cursor = end;
  }
  out.push(source.slice(cursor));

  return out.join("");
}

/** The methods that bind an ABI to an address, each a contract binding to compiler 2.6.0
 *  (`BindMethod`: `at`, `view`, `lib`). */
const BINDING_CONSTRUCTORS: ReadonlySet<string> = new Set(["at", "view", "lib"]);

/** The function `available(X)` was. */
const AVAILABLE = "available";

/**
 * Every name the check reads as the registry's that a caller may bind instead, by a define, a
 * contract binding or an ambient module's export: each namespace, chain key and token symbol some
 * chain registers and `tokens` does not (one it has is a define, which no export replaces), and
 * `available`. A name the caller binds is the caller's, never the registry's (`defined`).
 */
export function bindableNames(tokens: ReadonlyMap<string, bigint>): string[] {
  return [
    ...NAMESPACE_KEYS,
    ...CHAIN_KEY_SET,
    ...[...everySymbol()].filter((symbol) => !tokens.has(symbol)),
    AVAILABLE,
  ];
}

type Mode = "test" | "value";
/** What the node is to its parent: the callee of a call, the object of a member, the object of a
 *  `.at(…)` binding call, or the object a member is read from (`.getPool`), or anything else. */
type Role = "value" | "callee" | "at" | `.${string}`;

type Node = AstNode & Record<string, unknown>;
const prop = <T = Node>(node: AstNode, key: string): T => (node as Node)[key] as T;
const nameOf = (node: AstNode): string => prop<string>(node, "name");

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

/** Every chain's native coin's symbol. */
let natives: ReadonlySet<string> | undefined;
function nativeSymbols(): ReadonlySet<string> {
  natives ??= new Set(
    CANONICAL_CHAINS.map((on) => nativeCoinSymbol(on)).filter(
      (symbol): symbol is string => symbol !== undefined,
    ),
  );
  return natives;
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
 * program names by key, and the code a test rules out.
 */
export function checkNames(
  source: string,
  names: ChainNames,
  options: NameCheckOptions & {
    /** The names the caller binds beside the source, each its own value and never the registry's:
     *  its defines and contract bindings, and what its ambient modules export (`bindableNames`). */
    readonly defined?: ReadonlySet<string>;
    /** The compile's defines, the chain's and the caller's, by name: each a word, never a contract
     *  binding. */
    readonly scalars?: Readonly<Record<string, unknown>>;
    /** The module's path, as an error locates it: the entry is `main.js`, as the compiler names it. */
    readonly file?: string;
  } = {},
): NameCheck {
  const program = parseSauce(source);
  const chain = names.chain;
  const defined = options.defined ?? new Set<string>();
  const scope = options.chainScope?.map((ref) => requireChain(ref).id);
  const chainKeys = new Map<number, CanonicalChain>();
  const dead: DeadCode[] = [];
  const bindingSides: { start: number; end: number }[] = [];
  const zeros = new Map<number, { start: number; end: number }>();
  const unknown = new Map<number, UnknownName>();
  /** Whether the visit is in code a test of names rules out (`ruledOut`): there nothing is reported
   *  and a name this chain lacks is let be, and what no chain can have is refused as anywhere. */
  let validating = false;

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
   *  chain, and in code a test rules out, a Solana chain's own name (`Solana.self`) is the Solana
   *  lowering's. */
  const chainKeyOf = (node: AstNode, at: Scope | undefined): CanonicalChain | undefined => {
    const key = nameOf(node);
    if (shadowed(at, key, node.start) || defined.has(key)) return undefined;
    const on = chainOfKey(key);
    return on?.kind === "svm" && (chain.kind === "svm" || validating) ? undefined : on;
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

  /**
   * Whether `node` is an address by the program's text, which has a balance and no field: the Pot,
   * a number written out, or a name declared with a scalar type (`user: Address`). A name declared
   * with no type, or another, may be a record, whose fields the compile reads or refuses.
   */
  const isAddress = (node: AstNode, at: Scope | undefined): boolean => {
    const target = unwrap(node);
    if (isThePot(target, at)) return true;
    if (target.type === "Literal") {
      return ["bigint", "number"].includes(typeof prop<unknown>(target, "value"));
    }
    if (target.type !== "Identifier") return false;
    const binder = bindingOf(at, nameOf(target), target.start);
    const annotation =
      binder === undefined ? undefined : prop<AstNode | undefined>(binder, "typeAnnotation");
    const type =
      annotation === undefined
        ? undefined
        : prop<AstNode | undefined>(annotation, "typeAnnotation");
    if (type === undefined) return false;
    if (type.type !== "TSTypeReference") return SCALAR_TYPES.has(type.type);
    const named = prop<AstNode>(type, "typeName");
    return named.type === "Identifier" && SCALAR_TYPES.has(nameOf(named));
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
   * The refusal of `node`, a member, where it spells an account the way `Account` and `owner`
   * replaced (`Solana.pda`, `Solana.owner`) and the program declares no `Solana` there.
   */
  const retiredAccount = (node: AstNode, at: Scope | undefined): string | undefined => {
    if (node.type !== "MemberExpression" || prop<boolean>(node, "computed")) return undefined;
    const object = unwrap(prop(node, "object"));
    const property = prop<AstNode>(node, "property");
    if (
      object.type !== "Identifier" ||
      property.type !== "Identifier" ||
      nameOf(object) !== RETIRED_ACCOUNT_ROOT ||
      shadowed(at, RETIRED_ACCOUNT_ROOT, object.start) ||
      defined.has(RETIRED_ACCOUNT_ROOT)
    ) {
      return undefined;
    }
    return retiredAccountRefusal(nameOf(property));
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
    // An account spelled on Solana's name, whether the program runs it or a test rules it out, on
    // every chain: refused before a chain's name claims the member (`Solana.owner.dataLen`).
    for (const member of [target, unwrap(prop(target, "object"))]) {
      const refusal = retiredAccount(member, at);
      if (refusal !== undefined) fail(member, refusal);
    }
    const object = unwrap(prop(target, "object"));
    const property = prop<AstNode>(target, "property");
    if (property.type !== "Identifier") return undefined;
    const name = nameOf(property);
    if (object.type === "Identifier") {
      // A Solana venue (`Orca.Whirlpool`, `Pancakeswap.CLMM`) is the Solana lowering's name: on a
      // Solana chain, and in code a test rules out, which a Solana chain may take.
      if (
        (chain.kind === "svm" || validating) &&
        `${nameOf(object)}.${name}` in SVM_VENUE_NAMESPACES
      ) {
        return undefined;
      }
      const namespace = namespaceOf(object, at);
      if (namespace !== undefined) {
        return member(target, `${namespace.key}.${name}`, chain, namespace, name, role);
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
      return member(
        target,
        `${nameOf(head)}.${namespace!.key}.${name}`,
        on,
        namespace!,
        name,
        role,
      );
    }

    return undefined;
  };

  /** A chain the program names by key: refused outside the scope, and on a Solana chain where it
   *  runs. Code a test rules out compiles nowhere it names. */
  const named = (on: CanonicalChain, node: AstNode): void => {
    if (chain.kind !== "evm" && !validating) {
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
    if (!validating) chainKeys.set(on.id, on);
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
        return left === false
          ? false
          : left === true
            ? valueOf(prop(target, "right"), at)
            : undefined;
      }
      if (operator === "||") {
        return left === true
          ? true
          : left === false
            ? valueOf(prop(target, "right"), at)
            : undefined;
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

  const bindings = lexicalBindings(program);

  /**
   * Whether `name`, which the program does not declare, is a word: a define of the compile, a
   * token of the registry or the Pot. Any other name the program does not declare is a module's it
   * is handed (an ambient module's export), which this pass does not read: it may be a binding.
   */
  const isWord = (name: string): boolean =>
    (options.scalars !== undefined && Object.hasOwn(options.scalars, name)) ||
    names.tokens.has(name) ||
    names.absentTokens.has(name) ||
    (name === POT_NAME && !defined.has(POT_NAME));

  /**
   * Whether `node`, a side of `&&`/`||`, is a contract binding the compiler hands back as the whole
   * (`binding`), may be one (`unsure`: an import or a module's export, or a field of one, whose
   * module this pass does not read), or is not (`scalar`). Measured on 2.6.0: a contract the names
   * module binds (or a record field holding `<Abi>.at(…)`), an inline `<Abi>.at(…)`, and a
   * `const`/`let` alias of either, through any chain of aliases, are bindings; a local initialized
   * to `<Abi>.at(…)`, a `?:`, a call's result, a parameter and any scalar give a bool.
   */
  const bindingKind = (
    node: AstNode,
    at: Scope | undefined,
    seen: Set<AstNode> = new Set(),
  ): "binding" | "unsure" | "scalar" => {
    const target = unwrap(node);
    if (target.type === "CallExpression") {
      // `<Abi>.at(x)`, `.view(x)` and `.lib(x)`: each is the compiler's contract binding.
      const callee = unwrap(prop(target, "callee"));
      return callee.type === "MemberExpression" &&
        !prop<boolean>(callee, "computed") &&
        prop<AstNode>(callee, "property").type === "Identifier" &&
        BINDING_CONSTRUCTORS.has(nameOf(prop(callee, "property")))
        ? "binding"
        : "scalar";
    }
    if (target.type === "ConditionalExpression") {
      // A test the compiler folds keeps the binding its arm holds: either arm may be the whole.
      const kinds = [prop<AstNode>(target, "consequent"), prop<AstNode>(target, "alternate")].map(
        (arm) => bindingKind(arm, at, seen),
      );
      return kinds.includes("binding") ? "binding" : kinds.includes("unsure") ? "unsure" : "scalar";
    }
    if (target.type !== "Identifier" && target.type !== "MemberExpression") return "scalar";
    if (quietReference(target, at)?.kind === "contract") return "binding";
    if (target.type === "MemberExpression") {
      // A field or element of a record or list the program declares, nested or not: what the
      // member reads, at each level (`ns[1][0]`), or every value a computed key may read.
      const holders = holdersOf(unwrap(prop(target, "object")), seen);
      if (holders === "unsure") return "unsure";
      const kinds = holders.flatMap((holder) =>
        read(holder.node, target).map((value) =>
          bindingKind(value, bindings.scopeAt(value), holder.seen),
        ),
      );
      return kinds.includes("binding") ? "binding" : kinds.includes("unsure") ? "unsure" : "scalar";
    }
    if (shadowed(at, nameOf(target), target.start) === false) {
      return isWord(nameOf(target)) ? "scalar" : "unsure";
    }
    const declaration = bindings.declarationOf(target);
    if (declaration === undefined || seen.has(declaration)) return "scalar";
    if (declaration.type !== "VariableDeclarator") return "unsure";
    // An alias holds what its initializer is (a `?:` either arm), but a local initialized to
    // `<Abi>.at(…)` itself is an address to the compiler.
    const init = unwrap(prop(declaration, "init"));
    if (
      init.type !== "Identifier" &&
      init.type !== "MemberExpression" &&
      init.type !== "ConditionalExpression"
    ) {
      return "scalar";
    }
    return bindingKind(init, bindings.scopeAt(init), new Set([...seen, declaration]));
  };

  /** The values `member` reads from `literal`, a record or a list: the element at a constant
   *  index, the field named, or for any other key every element or field. */
  const read = (literal: AstNode, member: AstNode): AstNode[] => {
    const property = prop<AstNode>(member, "property");
    const computed = prop<boolean>(member, "computed");
    const index =
      computed && property.type === "Literal" ? prop<unknown>(property, "value") : undefined;
    const values =
      literal.type === "ArrayExpression"
        ? typeof index === "number" || typeof index === "bigint"
          ? [prop<(AstNode | null)[]>(literal, "elements")[Number(index)] ?? null]
          : prop<(AstNode | null)[]>(literal, "elements")
        : prop<AstNode[]>(literal, "properties")
            .filter(
              (p) =>
                p.type === "Property" &&
                (computed ||
                  (!prop<boolean>(p, "computed") &&
                    property.type === "Identifier" &&
                    (prop<AstNode>(p, "key") as Node)["name"] === nameOf(property))),
            )
            .map((p) => prop<AstNode>(p, "value"));
    return values.filter(
      (value): value is AstNode => value !== null && value.type !== "SpreadElement",
    );
  };

  /**
   * The literals `node` may hold, records or lists, followed through the local it names and the
   * member it reads at each level (`ns[1]`), with the declarations passed; `unsure` for an import
   * or a module's export, whose module this pass does not read.
   */
  const holdersOf = (
    node: AstNode,
    seen: Set<AstNode>,
  ): { readonly node: AstNode; readonly seen: Set<AstNode> }[] | "unsure" => {
    if (node.type === "ObjectExpression" || node.type === "ArrayExpression") {
      return [{ node, seen }];
    }
    if (node.type === "Identifier") {
      const declaration = bindings.declarationOf(node);
      if (declaration === undefined) {
        // A parameter, or a name the program does not declare: a module's export may hold one.
        const name = nameOf(node);
        return shadowed(bindings.scopeAt(node), name, node.start) || isWord(name) ? [] : "unsure";
      }
      if (seen.has(declaration)) return [];
      if (declaration.type !== "VariableDeclarator") return "unsure";
      return holdersOf(unwrap(prop(declaration, "init")), new Set([...seen, declaration]));
    }
    if (node.type === "ConditionalExpression") {
      const arms = [prop<AstNode>(node, "consequent"), prop<AstNode>(node, "alternate")].map(
        (arm) => holdersOf(unwrap(arm), seen),
      );
      return arms.includes("unsure")
        ? "unsure"
        : arms.flatMap((arm) => arm as Exclude<typeof arm, "unsure">);
    }
    if (node.type !== "MemberExpression") return [];
    const outer = holdersOf(unwrap(prop(node, "object")), seen);
    if (outer === "unsure") return outer;
    const inner: { readonly node: AstNode; readonly seen: Set<AstNode> }[] = [];
    for (const holder of outer) {
      for (const value of read(holder.node, node)) {
        const found = holdersOf(unwrap(value), holder.seen);
        if (found === "unsure") return found;
        inner.push(...found);
      }
    }
    return inner;
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
      if (reference.present === false && !asTest && !validating) {
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
      // A test of a token the chain lacks reads its zero, written where it stands: the names
      // module declares no token, so a read of one no check saw is the compiler's to refuse.
      if (reference.present === false && asTest && !validating) {
        zeros.set(reference.node.start, { start: reference.node.start, end: reference.node.end });
      }
      return;
    }
    const { entry } = reference;
    if (entry.kind === "absent" && !asTest && role !== "at" && !validating) {
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
    if (
      (entry.kind === "deployed" || entry.kind === "address") &&
      !asTest &&
      role !== "at" &&
      !validating
    ) {
      options.onContract?.(reference.shown, {
        chain: reference.chain,
        protocol: entry.descriptor.protocol,
        contract: entry.descriptor.contract,
        descriptor: entry.descriptor,
        address: entry.address,
      });
    }
  };

  /**
   * The value a test of names has here: none while code a test rules out is checked
   * (`validating`), where every branch is read as on a chain that may take it.
   */
  const decide = (test: AstNode, at: Scope | undefined): boolean | undefined =>
    validating ? undefined : valueOf(test, at);

  /**
   * Code a test rules out: reported for the compile to blank, and checked as on any chain, so a
   * program that passes here does not break on a chain where the branch is taken. Only a name this
   * chain lacks is let be there: a name no chain can have is refused as anywhere else, and a name
   * nothing the check knows gives meaning to is reported (`unknown`), for the compile to find among
   * what the caller binds or refuse.
   */
  const ruledOut = (
    node: AstNode,
    kind: DeadCode["kind"],
    at: Scope | undefined,
    mode: Mode,
  ): void => {
    if (validating) {
      visit(node, mode, "value", at);
      return;
    }
    dead.push({ start: node.start, end: node.end, kind });
    validating = true;
    try {
      visit(node, mode, "value", at);
    } finally {
      validating = false;
    }
  };

  /** Whether `node` is a read of `self`, the Pot's retired name, where neither the program nor the
   *  compile binds it. */
  const isRetiredPot = (node: AstNode, at: Scope | undefined): boolean =>
    node.type === "Identifier" &&
    nameOf(node) === RETIRED_POT_NAME &&
    !shadowed(at, RETIRED_POT_NAME, node.start) &&
    !defined.has(RETIRED_POT_NAME);

  /**
   * `<contract>.<read>` of a registry contract, `node`, as `role`: called, a method its ABI has;
   * read, its balance of a token or of the native coin. Refused, naming the contract, otherwise.
   */
  const contractMember = (node: AstNode, read: string, role: Role, at: Scope | undefined): void => {
    let owner: Reference | undefined;
    try {
      owner = referenceOf(prop(node, "object"), at, `.${read}`);
    } catch {
      return;
    }
    if (owner?.kind !== "contract" || owner.viaDefault !== undefined) return;
    const { entry } = owner;
    if (entry.kind !== "deployed" && entry.kind !== "absent") return;
    const { protocol, contract } = entry.descriptor;
    const methods = [...new Set(entry.descriptor.methods.map((method) => method.name))];
    const known = `${protocol}.${contract}'s vendored ABI (known methods: ${methods.join(", ")})`;
    const property = prop<AstNode>(node, "property");
    if (role === "callee") {
      // A scalar method reads the contract's address (`protocol-rewrite.ts`, shape G).
      if (methods.includes(read) || SCALAR_METHODS.has(read)) return;
      fail(
        property,
        `\`${owner.shown}.${read}(…)\`: \`${read}\` is not in ${known}.` + meant(read, methods),
      );
    }
    // Read, the binding's address, or a balance: of the native coin, or of a token the chain has.
    // Another chain's token, and a native coin's symbol, are the balance shorthand's to refuse, as
    // they are on any holder.
    if (read === BALANCE_MEMBER || read === "address" || names.tokens.has(read)) return;
    if (defined.has(read)) return;
    if (nativeSymbols().has(read)) return;
    if (names.absentTokens.has(read)) {
      use({ kind: "token", node: property, symbol: read, present: false }, "value", "value");
      return;
    }
    if (methods.includes(read)) {
      fail(
        property,
        `\`${owner.shown}.${read}\` is a method of ${protocol}.${contract}: call it, ` +
          `\`${owner.shown}.${read}(…)\`.`,
      );
    }
    fail(
      property,
      `\`${owner.shown}.${read}\`: \`${read}\` is neither a method of ${known} nor a token ` +
        `${validating ? "any chain" : chain.slug} registers.` +
        meant(read, [...methods, ...names.tokens.keys(), BALANCE_MEMBER]) +
        ` \`<holder>.<TOKEN>\` reads the holder's balance of a token, and ` +
        `\`<holder>.${BALANCE_MEMBER}\` its native coin.`,
    );
  };

  /** Visits the statements of a list in its own scope; the rest after a decided `if` that always
   *  exits is ruled out. */
  const statements = (list: readonly AstNode[], outer: Scope | undefined): void => {
    const at = blockScope(list, outer);
    let unreachable = false;
    let guarded = false;
    for (const statement of list) {
      if (unreachable) {
        // A function declared in a dead tail is still declared: it may be called from before. An
        // export is the module's too, and another module may use it. Each is checked as if it ran.
        // A type and an import are kept as they are.
        if (statement.type === "FunctionDeclaration" || statement.type.startsWith("Export")) {
          visit(statement, "value", "value", at);
        } else if (
          guarded &&
          !isTypeDeclaration(statement.type) &&
          statement.type !== "ImportDeclaration"
        ) {
          ruledOut(statement, "tail", at, "value");
        }
        continue;
      }
      visit(statement, "value", "value", at);
      if (statement.type === "ReturnStatement" || statement.type === "ThrowStatement") {
        unreachable = true;
      }
      if (
        statement.type === "IfStatement" &&
        decide(prop(statement, "test"), at) !== undefined &&
        exits(statement, at)
      ) {
        unreachable = true;
        guarded = true;
      }
    }
  };

  /**
   * Visits `node` in `mode` (whether a name the chain lacks may appear: only in a `test`), as
   * `role`. `wrap` says the node's whole is a side of a `&&`/`||` whose whole is a value: through
   * a `?:` arm or another `&&`/`||`, a `&&`/`||` there makes a contract binding on its side a bool.
   */
  const visit = (
    node: AstNode,
    mode: Mode,
    role: Role,
    at: Scope | undefined,
    wrap = false,
  ): void => {
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
        // a name the chain lacks would be the program's, and no check would see its uses. The
        // compile never serves them to an import (`rs-compile.ts`); this names the import, as the
        // compiler would read it: a package with a trailing slash, a path with `.`, `..`, `//`.
        const specifier = String(prop<Node>(node, "source")["value"] ?? "");
        const bare = /^[./]/.test(specifier) ? specifier : specifier.replace(/\/$/, "");
        if (
          bare === CHAIN_MODULE ||
          bare.startsWith(`${CHAIN_MODULE}-`) ||
          inChainModuleRoot(specifier)
        ) {
          fail(node, namesRefusal(`\`${specifier}\` is`));
        }
        return;
      }
      case "TSImportEqualsDeclaration":
        return;
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration": {
        const declaration = prop<AstNode | null>(node, "declaration");
        if (declaration !== null && declaration !== undefined) {
          visit(declaration, mode, role, at, wrap);
        }
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
        const taken = decide(prop(node, "test"), at);
        const consequent = prop<AstNode>(node, "consequent");
        const alternate = prop<AstNode | null>(node, "alternate");
        if (taken !== false) visit(consequent, "value", "value", at);
        else ruledOut(consequent, "statement", at, "value");
        if (!alternate) return;
        if (taken !== true) visit(alternate, "value", "value", at);
        else ruledOut(alternate, "statement", at, "value");
        return;
      }
      case "ConditionalExpression": {
        visit(prop(node, "test"), "test", "value", at);
        const taken = decide(prop(node, "test"), at);
        for (const [arm, live] of [
          [prop<AstNode>(node, "consequent"), taken !== false],
          [prop<AstNode>(node, "alternate"), taken !== true],
        ] as const) {
          if (live) visit(arm, mode, "value", at, wrap);
          else ruledOut(arm, "expression", at, mode);
        }
        return;
      }
      case "WhileStatement":
      case "DoWhileStatement":
        visit(prop(node, "test"), "test", "value", at);
        visit(prop(node, "body"), "value", "value", at);
        return;
      case "ForStatement": {
        const loop = forScope(node, at);
        for (const key of ["init", "update"]) {
          const part = prop<AstNode | null>(node, key);
          if (part) visit(part, "value", "value", loop);
        }
        if (prop<AstNode | null>(node, "test")) visit(prop(node, "test"), "test", "value", loop);
        visit(prop(node, "body"), "value", "value", loop);
        return;
      }
      case "ForOfStatement":
      case "ForInStatement":
        visit(prop(node, "left"), "value", "value", at);
        visit(prop(node, "right"), "value", "value", at);
        visit(prop(node, "body"), "value", "value", forOfBodyScope(node, at));
        return;
      case "CatchClause":
        defaults(prop<AstNode | null>(node, "param"), at);
        visit(prop(node, "body"), "value", "value", catchScope(node, at));
        return;
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
        // `&&` and `||` give true or false, never one of their sides, so each side is a test. But
        // 2.6.0 gives a contract binding back as the whole (`0 || UniswapV3.Factory` is its
        // address): where the whole is a value, or a side of one (`wrap`), a side that is, or may
        // be, one (`bindingKind`) is made a bool with `!!` (`withoutDead`), as the language has it.
        // A scalar side is left. A side is a side of a value too, through a `?:` arm or another
        // `&&`/`||` in it, which is how a `&&`/`||` nested anywhere in a side gives the bool. Where
        // the left side decides the whole, the right side is not compiled.
        const sides = !validating && (mode === "value" || wrap);
        const normalize = (side: AstNode): void => {
          if (sides && bindingKind(side, at) !== "scalar") {
            bindingSides.push({ start: side.start, end: side.end });
          }
        };
        const decided = decide(left, at);
        normalize(left);
        visit(left, "test", "value", at, sides);
        if (decided === undefined || decided !== (operator === "||")) {
          normalize(right);
          visit(right, "test", "value", at, sides);
        } else ruledOut(right, "expression", at, "test");
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
        // `require(c)` tests `c`. On a chain without `X`, `require(X != 0)` fails whatever the
        // program does: refused here.
        const [condition] = prop<AstNode[]>(node, "arguments");
        const required =
          target.type === "Identifier" &&
          nameOf(target) === "require" &&
          !shadowed(at, "require", target.start);
        const absent =
          required && condition !== undefined && decide(condition, at) === false
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
          visit(argument, required && argument === condition ? "test" : "value", "value", at);
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
        if (node.type === "Identifier") {
          if (validating && isRetiredPot(node, at)) {
            fail(node, selfRefusal(RETIRED_POT_NAME, POT_NAME).message);
          }
          const name = nameOf(node);
          // Where a program for an EVM chain runs it, an account is Solana's (`Account(…)`,
          // `owner`): code a test rules out may name one, which a Solana chain compiles.
          if (
            !validating &&
            chain.kind === "evm" &&
            SOLANA_ACCOUNTS.has(name) &&
            !shadowed(at, name, node.start) &&
            !defined.has(name) &&
            !Object.hasOwn(options.scalars ?? {}, name)
          ) {
            const spelled =
              name !== ACCOUNT_FACTORY
                ? name
                : role === "callee"
                  ? `${name}(…)`
                  : role.startsWith(".")
                    ? `${name}${role}${role === ".pda" ? "(…)" : ""}`
                    : name;
            fail(node, evmAccountRefusal(spelled, chain.slug));
          }
          // In code a test rules out, which the compile here never reads, a name is what the
          // program, the caller, a chain's registry or the language makes it, or reported.
          if (
            validating &&
            !shadowed(at, name, node.start) &&
            !defined.has(name) &&
            !Object.hasOwn(options.scalars ?? {}, name) &&
            !names.tokens.has(name) &&
            !everySymbol().has(name) &&
            !NAMESPACE_KEYS.has(name) &&
            !CHAIN_KEY_SET.has(name) &&
            !SVM_VENUE_ROOTS.has(name) &&
            !LANGUAGE_NAMES.has(name)
          ) {
            unknown.set(node.start, {
              name,
              start: node.start,
              end: node.end,
              form: role === "callee" ? "call" : role === "value" ? "value" : "member",
            });
          }
          return;
        }
        const property = prop<AstNode>(node, "property");
        const read =
          !prop<boolean>(node, "computed") && property.type === "Identifier"
            ? nameOf(property)
            : "[…]";
        const object = prop<AstNode>(node, "object");
        if (validating && read !== "[…]" && isRetiredPot(unwrap(object), at)) {
          fail(node, selfRefusal(`${RETIRED_POT_NAME}.${read}`, `${POT_NAME}.${read}`).message);
        }
        // The Pot's balance of a token the chain lacks (`pot.WETH`, `ctx.self().WETH`) is a use of
        // the token, refused where a test of it does not rule the read out. The Pot is never a
        // record, so no field of that name can be meant; another holder's may be one, which the
        // compile reads or refuses.
        if (
          names.absentTokens.has(read) &&
          !defined.has(read) &&
          !shadowed(at, read, node.start) &&
          isThePot(object, at)
        ) {
          use({ kind: "token", node: property, symbol: read, present: false }, "value", "value");
        } else if (
          validating &&
          read !== "[…]" &&
          read !== BALANCE_MEMBER &&
          !names.tokens.has(read) &&
          !defined.has(read) &&
          !everySymbol().has(read) &&
          !VALUE_MEMBERS.has(read) &&
          !nativeSymbols().has(read) &&
          role !== "callee" &&
          isAddress(object, at)
        ) {
          // Code a test rules out holds no read of an address that is no member it has on any
          // chain: a token, `balance`, a native coin's symbol, `.length` of bytes or, on Solana, an
          // account's field or role. The balance shorthand reads a token and the compile refuses
          // the rest where the branch is compiled, as this does.
          throw locatedError(
            source,
            options.file ?? "main.js",
            property,
            notAToken(read, chain, [...names.tokens.keys(), ...everySymbol(), BALANCE_MEMBER]),
          );
        }
        // `(A && B).getPool(…)` on contracts: `&&` and `||` give a bool, which has no method. Said
        // here, at the choice, rather than by the compiler, which cannot say where.
        const choice = unwrap(object);
        if (
          role === "callee" &&
          choice.type === "LogicalExpression" &&
          ["&&", "||"].includes(prop<string>(choice, "operator")) &&
          [prop<AstNode>(choice, "left"), prop<AstNode>(choice, "right")].some(
            (side) => bindingKind(side, at) !== "scalar",
          )
        ) {
          fail(
            choice,
            `\`${source.slice(choice.start, choice.end)}\` is true or false, which has no method ` +
              `\`${read}\`: \`&&\` and \`||\` give a bool. Choose the contract with \`?:\`: ` +
              "`X ? X : Y`.",
          );
        }
        visit(object, "value", `.${read}`, at);
        if (prop<boolean>(node, "computed")) visit(property, "value", "value", at);
        else if (read !== "[…]") contractMember(node, read, role, at);
        return;
      }
      case "Property":
        if (prop<boolean>(node, "computed")) visit(prop(node, "key"), "value", "value", at);
        visit(prop(node, "value"), "value", "value", at);
        return;
      case "TSNonNullExpression":
      case "TSAsExpression":
      case "TSSatisfiesExpression":
        visit(prop(node, "expression"), mode, role, at, wrap);
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

  return {
    chainKeys: [...chainKeys.values()],
    dead: dead.sort((a, b) => a.start - b.start),
    bindingSides: bindingSides.sort((a, b) => a.start - b.start),
    zeros: [...zeros.values()].sort((a, b) => a.start - b.start),
    unknown: [...unknown.values()].sort((a, b) => a.start - b.start),
  };
}
