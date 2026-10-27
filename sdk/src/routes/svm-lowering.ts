/**
 * The machinery every Solana lowering shares: a program's calls that need accounts — the token
 * methods (`svm-token-rewrite.ts`) and the venue namespaces (`svm-venue-methods.ts`) — rewritten
 * into the library calls they stand for, with the accounts each takes ADDED to `main` as parameters,
 * every one with how it is derived, written as an `--account` value (`svm/account-names.ts`).
 *
 * One `SvmLowering` per compile holds the parsed program, its `main`, the accounts added so far (one
 * per derivation, named apart from every name the program declares), the text splices and the
 * imports. A collector finds its sites in the whole program and registers each with `site`; the
 * sites are then lowered in source order, so the accounts are named, and added to `main`, in the
 * order the calls are. What a collector may lower is what can be derived when the transaction is
 * built: a holder or a mint the program names by a parameter of `main`, a key it writes out, or the
 * Pot (`pot`, or `ctx.self()` as a holder); `holderOf` and `tokenOf` refuse anything else, naming
 * the explicit form.
 *
 * WHERE A SITE STANDS. In `main`; in a top-level function, which is given each account (and value)
 * it uses as a parameter, under main's name for it, and passed it at every call, a function calling
 * another passing on what that one uses; or in a script, whose statements are made `main`'s body
 * (`scriptAsMain`). A function inside another, and a top-level function used other than by calling
 * it, are refused: nothing can pass them the accounts.
 */
import { address, getAddressDecoder, getAddressEncoder } from "@solana/kit";

import {
  collectPatternBinders,
  collectPatternNames,
  countDeclarations,
  isTypeDeclaration,
  TYPE_KEYS,
  walk,
  type AstNode,
} from "./ast-walk.js";
import { bindingOf, shadowed, walkScoped, type Scope } from "./lexical-scope.js";
import { parseSauce } from "./parse.js";
import { BALANCE_MEMBER, POT_NAME, potOwners, RETIRED_POT_NAME } from "./pot-sugar.js";
import {
  applySplices,
  argumentRange,
  methodCall,
  type MethodCall,
  type Splice,
} from "./token-rewrite.js";
import { blankLiterals } from "./rs-compile.js";
import type { SvmTokenRow } from "./token-registry.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";
import { STD_SOURCES } from "../embedded/sources.generated.js";

export interface SvmLoweringResult {
  readonly source: string;
  readonly rewrote: boolean;
  /**
   * Each account the lowering added to `main`, by its parameter name: how it is derived, as an
   * `--account` value (`pot:USDC`, `authority:USDC`, `@to:USDC`, …). Empty when nothing was lowered.
   */
  readonly derived: Readonly<Record<string, string>>;
  /**
   * Each `Uint256` the lowering added to `main` after the accounts, by its parameter name, in their
   * order: how the cook's builder works it out (a venue's `stop:…`). None of them is one of the
   * arguments a caller gives.
   */
  readonly values?: Readonly<Record<string, string>>;
  /** Each venue's swap at a price that a stop could hold, by its stop's derivation, in order. */
  readonly stoppable?: readonly string[];
  /** How many times each of those inside a loop runs, by its derivation (`SvmLowering.runsOf`). */
  readonly stoppableRuns?: Readonly<Record<string, number | null>>;
  /**
   * Whether the program names the Pot (`pot`, where nothing else binds it): then every account it
   * acts with derives from the Pot (`pot`, `pot:<token>`), not `authority`.
   */
  readonly namesPot?: boolean;
}

/** A mint as a call names it. */
export interface TokenRef {
  /** The mint's key in the program's text: the symbol, the parameter, the literal or the binding. */
  readonly value: string;
  /** The mint in a derivation: a registered symbol, the mint in base58, or `@<parameter>`. */
  readonly name: string;
  /** The mint in an account's name. */
  readonly stem: string;
  /** The parameter that gives the mint, when an argument does. */
  readonly param?: string;
  /** The registry's row, when it records the mint: its program and decimals. */
  readonly row?: SvmTokenRow;
  /** How the call was spelled, for a message. */
  readonly spelled: string;
}

/**
 * A holder, or a delegate, as a call names it. `authority` is the account the program acts with:
 * the Pot where the program names it (`pot`), else the account that signs the engine call, which
 * is the Pot through the Kitchen and the owner cooked directly (`SvmLowering.authorityDerivation`).
 */
export type Holder =
  | { readonly kind: "authority" }
  | {
      readonly kind: "key";
      /** `@<parameter>`, or the key in base58. */
      readonly name: string;
      /** The holder in an account's name. */
      readonly stem: string;
      /** The key in the program's text, for the check. */
      readonly value: string;
    }
  | {
      readonly kind: "account";
      readonly param: string;
      readonly writable: boolean;
      /** The top-level function whose parameter it is, and its position, where it is not main's:
       *  the account each call passes there is held to what the function does with it. */
      readonly helper?: { readonly fn: AstNode; readonly name: string; readonly index: number };
    };

/** A parameter of `main`, or of a top-level function, as a call reads it. */
interface Param {
  readonly kind: "address" | "account" | "other";
  /** Whether main's account is declared `Writable`; never a top-level function's, which declares no
   *  role. */
  readonly writable: boolean;
  /** The annotation's type name (`Uint256`, `Address`, `Account`), where it is one name, of main's. */
  readonly type?: string;
  /** The top-level function whose parameter it is, where it is not main's. */
  readonly of?: string;
  /** Its position among the function's parameters. */
  readonly index: number;
}

/** Where a site stands: in `main`, in a top-level function, inside a function in another, or in
 *  no function at all. */
type Place =
  | { readonly kind: "main" }
  | { readonly kind: "helper"; readonly fn: AstNode; readonly name: string }
  | { readonly kind: "nested"; readonly fn: AstNode }
  | { readonly kind: "outside" };

interface Slot {
  readonly name: string;
  writable: boolean;
  signer: boolean;
}

/** The accounts a lowering adds to `main`, one per derivation, named apart from every name the
 *  program declares. */
class Slots {
  private readonly byDerivation = new Map<string, Slot>();

  constructor(readonly taken: Set<string>) {}

  use(derivation: string, base: string, role: { writable?: boolean; signer?: boolean }): string {
    let slot = this.byDerivation.get(derivation);
    if (slot === undefined) {
      let name = base;
      for (let n = 2; this.taken.has(name); n++) name = `${base}${n}`;
      this.taken.add(name);
      slot = { name, writable: false, signer: false };
      this.byDerivation.set(derivation, slot);
    }
    slot.writable ||= role.writable === true;
    slot.signer ||= role.signer === true;

    return slot.name;
  }

  /** The parameters, as `main` declares them. */
  params(): string {
    return [...this.byDerivation.values()]
      .map(({ name, writable, signer }) => {
        const roles = [...(writable ? ["Writable"] : []), ...(signer ? ["Signer"] : [])];

        return `${name}: Account${roles.length === 0 ? "" : `<${roles.join(", ")}>`}`;
      })
      .join(", ");
  }

  derived(): Record<string, string> {
    return Object.fromEntries(
      [...this.byDerivation].map(([derivation, slot]) => [slot.name, derivation]),
    );
  }

  /** The parameters' names, in main's order. */
  names(): string[] {
    return [...this.byDerivation.values()].map((slot) => slot.name);
  }
}

export const nameOf = (node: AstNode): string => (node as unknown as { name: string }).name;

export const capitalized = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** A 32-byte key written out (`0x` and 64 hex digits, with or without an `n`), else undefined. */
export function keyLiteral(node: AstNode, source: string): string | undefined {
  if (node.type !== "Literal") return undefined;
  const raw = source.slice(node.start, node.end);

  return /^0x[0-9a-fA-F]{64}n?$/.test(raw) ? raw.replace(/n$/, "") : undefined;
}

/** A 32-byte key, hex, in base58. */
export function base58(hex: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(2 + 2 * i, 4 + 2 * i), 16);

  return getAddressDecoder().decode(bytes);
}

/** A key as 64 hex digits, `0x`-prefixed, lowercase. */
const keyHex = (key: bigint): string => `0x${key.toString(16).padStart(64, "0")}`;

/** A base58 key as 64 hex digits, `0x`-prefixed, lowercase: the scalar a program compares. */
export function hexKey(key: string): string {
  return `0x${[...getAddressEncoder().encode(address(key))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** The type `node`'s annotation names, where it is one name: `Address`, `Account` (roles or not). */
export function annotatedType(node: AstNode): string | undefined {
  const annotation = (node as { typeAnnotation?: { typeAnnotation?: AstNode } }).typeAnnotation
    ?.typeAnnotation;
  const typeName = (annotation as { typeName?: AstNode } | undefined)?.typeName;

  return typeName?.type === "Identifier" ? nameOf(typeName) : undefined;
}

/**
 * A function's `Address` and `Account` parameters, by name. Main's carry their roles (whether an
 * account is writable) and their type; a top-level function's account may declare no role (the
 * compiler takes roles only on main's), so the account a caller passes it is held to what the
 * function does with it (`holdWrittenParams`), and its `Address` is a value only the program has as
 * it runs.
 */
function paramsOf(fn: AstNode, helper?: string): ReadonlyMap<string, Param> {
  const params = new Map<string, Param>();
  ((fn as { params?: AstNode[] }).params ?? []).forEach((param, index) => {
    if (param.type !== "Identifier") return;
    const annotation = (param as { typeAnnotation?: { typeAnnotation?: AstNode } }).typeAnnotation
      ?.typeAnnotation;
    const type = annotatedType(param);
    const roles = (
      (annotation as { typeArguments?: { params?: AstNode[] } } | undefined)?.typeArguments
        ?.params ?? []
    ).map((role) => {
      const name = (role as { typeName?: AstNode }).typeName;

      return name?.type === "Identifier" ? nameOf(name) : "";
    });
    params.set(
      nameOf(param),
      helper === undefined
        ? {
            kind: type === "Address" ? "address" : type === "Account" ? "account" : "other",
            writable: roles.includes("Writable"),
            ...(type === undefined ? {} : { type }),
            index,
          }
        : { kind: type === "Account" ? "account" : "other", writable: false, of: helper, index },
    );
  });

  return params;
}

/** A top-level statement's function declaration, exported or not. */
function declaredFunction(statement: AstNode): AstNode | undefined {
  const node =
    statement.type === "ExportNamedDeclaration"
      ? ((statement as { declaration?: AstNode | null }).declaration ?? undefined)
      : statement;

  return node?.type === "FunctionDeclaration" &&
    (node as { id?: AstNode | null }).id?.type === "Identifier"
    ? node
    : undefined;
}

/** The program's top-level functions, by name, `main` included. */
function topLevelFunctions(program: AstNode): Map<string, AstNode> {
  const functions = new Map<string, AstNode>();
  for (const statement of (program as { body?: AstNode[] }).body ?? []) {
    const fn = declaredFunction(statement);
    if (fn !== undefined) functions.set(nameOf(fn.id as AstNode), fn);
  }

  return functions;
}

/** Each node's parent, over the value nodes `walk` visits. */
export function parentsOf(program: AstNode): Map<AstNode, AstNode> {
  const parents = new Map<AstNode, AstNode>();
  walk(program, (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || TYPE_KEYS.has(key)) continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (child !== null && typeof child === "object" && typeof child.type === "string") {
          parents.set(child as AstNode, node);
        }
      }
    }
  });

  return parents;
}

/**
 * Every identifier a declaration binds: a variable's, a function's own name or a parameter's, a
 * `catch` clause's, through any destructuring pattern (`[pot, bump]`, `{ pot }`, `...pot`). A
 * default's value (`[a = pot]`) and a computed key are reads, not binders.
 */
function bindersOf(program: AstNode): ReadonlySet<AstNode> {
  const binders = new Set<AstNode>();
  const add = (node: AstNode): void => {
    binders.add(node);
  };
  walk(program, (n) => {
    if (n.type === "VariableDeclarator") collectPatternBinders(n.id, add);
    if (n.type === "CatchClause") collectPatternBinders(n.param, add);
    if (
      n.type === "FunctionDeclaration" ||
      n.type === "FunctionExpression" ||
      n.type === "ArrowFunctionExpression"
    ) {
      collectPatternBinders(n.id, add);
      for (const param of (n.params as AstNode[] | undefined) ?? []) {
        collectPatternBinders(param, add);
      }
    }
  });

  return binders;
}

/**
 * Every place the program reads a name: an identifier in value position, not a member's name, a
 * record's key, a label, an import's or export's name, or a name a declaration binds (`bindersOf`).
 */
function readsOf(program: AstNode, parents: ReadonlyMap<AstNode, AstNode>): AstNode[] {
  const reads: AstNode[] = [];
  const binders = bindersOf(program);
  walk(program, (n) => {
    if (n.type !== "Identifier" || binders.has(n)) return;
    const parent = parents.get(n);
    if (parent === undefined) return;
    const computed = parent.computed === true;
    switch (parent.type) {
      case "MemberExpression":
        if (parent.property === n && !computed) return;
        break;
      case "Property":
      case "PropertyDefinition":
      case "MethodDefinition":
        if (parent.key === n && !computed && !(parent.shorthand === true && parent.value === n)) {
          return;
        }
        break;
      case "LabeledStatement":
      case "BreakStatement":
      case "ContinueStatement":
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
      case "ExportSpecifier":
        return;
    }
    reads.push(n);
  });

  return reads;
}

/** The top-level statements a script runs, as against the declarations it makes. */
function isDeclaration(statement: AstNode): boolean {
  return (
    statement.type === "ImportDeclaration" ||
    statement.type.startsWith("Export") ||
    statement.type === "FunctionDeclaration" ||
    isTypeDeclaration(statement.type)
  );
}

/**
 * A script (top-level statements and no `main`, which runs as `main(): void`) written with its
 * `main`: its statements, in order, made the body of `function main(): void`, and its imports,
 * functions and types left at the top level, in order, before it. A script's top-level `const` and
 * `let` are the entry's locals already, which no function reads, so nothing changes but that main
 * now has a signature for the accounts its lowered sites take. `undefined` for a program with no
 * statement to run.
 */
export function scriptAsMain(program: AstNode, source: string): string | undefined {
  const body = (program as { body?: AstNode[] }).body ?? [];
  if (!body.some((statement) => !isDeclaration(statement))) return undefined;
  const declarations: string[] = [];
  const statements: string[] = [];
  let at = body[0]!.start;
  for (const statement of body) {
    (isDeclaration(statement) ? declarations : statements).push(source.slice(at, statement.end));
    at = statement.end;
  }

  return (
    `${source.slice(0, body[0]!.start)}${declarations.join("")}\n` +
    `function main(): void {\n${statements.join("")}\n}${source.slice(at)}`
  );
}

/** The standard libraries' Solana arms, whose functions take accounts by position. */
const LIBRARY_ARMS: Readonly<Record<string, string>> = {
  "@sauce/token": "token/token.svm.js",
  "@sauce/router": "router/router.svm.js",
};

/** Each library's exported functions, by name: which of their parameters is an `Account`. */
const libraryAccounts = new Map<string, ReadonlyMap<string, readonly boolean[]>>();

/** Which parameters of a library function are accounts, by the library's own declarations. */
export function libraryAccountParams(module: string, fn: string): readonly boolean[] | undefined {
  let functions = libraryAccounts.get(module);
  if (functions === undefined) {
    const text = LIBRARY_ARMS[module] === undefined ? undefined : STD_SOURCES[LIBRARY_ARMS[module]];
    const found = new Map<string, readonly boolean[]>();
    if (text !== undefined) {
      for (const [name, node] of topLevelFunctions(parseSauce(text))) {
        found.set(
          name,
          [...paramsOf(node).values()].map((param) => param.kind === "account"),
        );
      }
    }
    functions = found;
    libraryAccounts.set(module, functions);
  }

  return functions.get(fn);
}

/**
 * The splices with each one another replaces dropped: a site whose text a wider site rewrites as a
 * whole (a holder `pot` inside `USDC.transfer(pot, amount)`) is that site's. An insertion at either
 * end of a wider splice is kept.
 */
function dropContained(splices: readonly Splice[]): Splice[] {
  const wide = splices.filter((splice) => splice.end > splice.start);

  return splices.filter((splice, index) =>
    wide.every((other) => {
      if (other === splice || other.start > splice.start || splice.end > other.end) return true;
      if (splice.end === splice.start)
        return !(other.start < splice.start && splice.start < other.end);
      // The same range twice: the first one stands.
      return (
        other.start === splice.start && other.end === splice.end && splices.indexOf(other) > index
      );
    }),
  );
}

/** A name a program's text reads: an identifier, not a member's (`.owner`) or in a string. */
const NAME = /(?<![\w$.])[A-Za-z_$][\w$]*/g;

/** The text's string literals and the code between them, alternately (code first). */
const codeAndStrings = (text: string): string[] => text.split(/("(?:[^"\\]|\\.)*")/);

/** The names a lowered text reads. */
const identifiers = (text: string): string[] =>
  codeAndStrings(text).flatMap((part, i) => (i % 2 === 1 ? [] : (part.match(NAME) ?? [])));

/**
 * The text with each name `to` maps read as what it maps it to. A splice's text holds only what
 * the program reads there, never a record's key (a shorthand `{ pot }` keeps its own key, and its
 * splice is the value after it), so every name in it is a read.
 */
const substitute = (text: string, to: ReadonlyMap<string, string>): string =>
  codeAndStrings(text)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(NAME, (name) => to.get(name) ?? name)))
    .join("");

/** The list a top-level function is given the accounts it uses in (`threadHelpers`). */
const HELPER_ACCOUNTS = "__sauce_accounts";

/** Every statement that may run its body more than once. */
const LOOPS = new Set([
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

const UINT256 = 1n << 256n;

/**
 * A literal's integer as the compiler reads it, from its text: a non-negative decimal (with no
 * leading zero) or hexadecimal integer, `n` or not, below 2^256. Undefined for anything else, a
 * negative number included (`-1` is a signed `Int256` literal, not a counter this counts), whose
 * loop is left uncounted rather than read some other way.
 */
function integerOf(node: AstNode | null | undefined): bigint | undefined {
  if (node?.type !== "Literal") return undefined;
  const raw = (node as { raw?: string }).raw ?? "";
  const digits = /^(0|[1-9][0-9]*|0[xX][0-9a-fA-F]+)n?$/.exec(raw)?.[1];
  if (digits === undefined) return undefined;
  const value = BigInt(digits);
  return value < UINT256 ? value : undefined;
}

/**
 * How many times a loop's body runs, where the loop writes it out: `for (const x of [a, b])`, or
 * `for (let i = 0; i < 3; i++)` with a start, bound and step (`++`, `--`, `+=`, `-=`) written as
 * integers the compiler reads as such (`integerOf`) and a counter its body never sets. Its arithmetic
 * is checked, so this is the most the body runs: a `break`, a `return` or a step past 0 or 2^256
 * only ends the loop sooner. Null for any other loop: `while`, a bound that is a value, a negative
 * number.
 */
function loopCount(loop: AstNode): bigint | null {
  if (loop.type === "ForOfStatement") {
    const right = (loop as { right?: AstNode }).right;
    if (right?.type !== "ArrayExpression") return null;
    const elements = (right as { elements?: (AstNode | null)[] }).elements ?? [];
    return elements.some((element) => element === null || element.type === "SpreadElement")
      ? null
      : BigInt(elements.length);
  }
  if (loop.type !== "ForStatement") return null;
  const { init, test, update, body } = loop as {
    init?: AstNode | null;
    test?: AstNode | null;
    update?: AstNode | null;
    body?: AstNode;
  };
  const declarations = (init as { declarations?: AstNode[] } | null | undefined)?.declarations;
  if (init?.type !== "VariableDeclaration" || declarations?.length !== 1) return null;
  const { id, init: first } = declarations[0] as { id?: AstNode; init?: AstNode | null };
  if (id?.type !== "Identifier") return null;
  const counter = nameOf(id);
  const isCounter = (node: AstNode | undefined): boolean =>
    node?.type === "Identifier" && nameOf(node) === counter;
  const start = integerOf(first);
  const { operator, left, right } = (test ?? {}) as {
    operator?: string;
    left?: AstNode;
    right?: AstNode;
  };
  const bound = integerOf(right);
  if (start === undefined || bound === undefined || !isCounter(left)) return null;
  let step: bigint | undefined;
  if (update?.type === "UpdateExpression") {
    const { argument, operator: op } = update as { argument?: AstNode; operator?: string };
    if (isCounter(argument)) step = op === "++" ? 1n : -1n;
  } else if (update?.type === "AssignmentExpression") {
    const {
      left: target,
      right: by,
      operator: op,
    } = update as {
      left?: AstNode;
      right?: AstNode;
      operator?: string;
    };
    const amount = integerOf(by);
    if (isCounter(target) && amount !== undefined && (op === "+=" || op === "-=")) {
      step = op === "+=" ? amount : -amount;
    }
  }
  if (step === undefined || step === 0n) return null;
  let set = false;
  walk(body, (n) => {
    if (n.type === "AssignmentExpression" && isCounter((n as { left?: AstNode }).left)) set = true;
    if (n.type === "UpdateExpression" && isCounter((n as { argument?: AstNode }).argument)) {
      set = true;
    }
  });
  if (set) return null;
  // The runs from `start` to `bound` by `step`, none where the test fails at once.
  const up = step > 0n;
  const span = up ? bound - start : start - bound;
  const by = up ? step : -step;
  switch (operator) {
    case "<":
    case ">":
      if (up !== (operator === "<")) return null;
      return span <= 0n ? 0n : (span + by - 1n) / by;
    case "<=":
    case ">=":
      if (up !== (operator === "<=")) return null;
      return span < 0n ? 0n : span / by + 1n;
    default:
      return null;
  }
}

/** `ctx.self()`, with `ctx` the language's, not a name the program declares. */
export function isCtxSelf(node: AstNode, declared: ReadonlySet<string>): boolean {
  const site = methodCall(node);

  return (
    site !== undefined &&
    site.method === "self" &&
    site.object.type === "Identifier" &&
    nameOf(site.object) === "ctx" &&
    !declared.has("ctx") &&
    ((node as { arguments?: AstNode[] }).arguments ?? []).length === 0
  );
}

/**
 * Whether `source` may have an identifier that `wanted` takes, stopping at the first. An identifier
 * may spell a character as an escape (`p\u006ft`), which only the parse reads as the name it spells,
 * so a source with an escape is taken to have any.
 */
export function namesAny(source: string, wanted: (name: string) => boolean): boolean {
  if (source.includes("\\u")) return true;
  for (const [name] of source.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    if (wanted(name)) return true;
  }

  return false;
}

/** The registry's rows by symbol and by key, built once per registry. */
interface RowIndex {
  readonly bySymbol: ReadonlyMap<string, SvmTokenRow>;
  /** By the mint's 32-byte key, lowercase hex. */
  readonly byKey: ReadonlyMap<string, SvmTokenRow>;
}

const ROW_INDEXES = new WeakMap<readonly SvmTokenRow[], RowIndex>();

function rowIndex(rows: readonly SvmTokenRow[]): RowIndex {
  let index = ROW_INDEXES.get(rows);
  if (index === undefined) {
    index = {
      bySymbol: new Map(rows.map((row) => [row.symbol, row])),
      byKey: new Map(rows.map((row) => [row.address.toLowerCase(), row])),
    };
    ROW_INDEXES.set(rows, index);
  }

  return index;
}

/** One program's lowering: what the collectors read, and what they add. */
export class SvmLowering {
  readonly program: AstNode;
  readonly declarations: ReadonlyMap<string, number>;
  readonly declared: ReadonlySet<string>;
  readonly main: AstNode | undefined;
  /** Each node's parent. */
  readonly parents: ReadonlyMap<AstNode, AstNode>;
  /** Every place the program reads a name (`readsOf`). */
  private readonly reads: readonly AstNode[];
  /** The source with its strings and comments as spaces (`blankLiterals`), once a splice needs it. */
  private blanked: string | undefined;
  /** Every read of `pot` where the program does not bind it (`owns`): the Pot. The `pot` of a
   *  `pot.owner` is none: that reads the Pot's owner (`isOwner`). */
  readonly potReads: ReadonlySet<AstNode>;
  /** Every read of `self` where the program does not bind it: refused, naming `pot`. */
  readonly selfReads: readonly AstNode[];
  /** Every `pot.owner` read on the Pot, and not called: the Pot's owner's account. */
  private readonly ownerMembers: ReadonlySet<AstNode>;
  /** By name, every read of it where neither the program nor the caller binds it (`freeReads`). */
  private readonly freeByName = new Map<string, ReadonlySet<AstNode>>();
  /**
   * How the account the program acts with is derived: `pot` where the program names the Pot (in any
   * form but its owner, `pot.owner`: `pot`, `pot.USDC`, `pot.balance`, `pot.signer()`), so its token
   * writes, its `ctx.self()` holders and its `pot` are one account; else `authority`, the account
   * that signs the engine call, which is the Pot through the Kitchen and the owner cooked directly
   * (`--via engine`).
   */
  readonly authorityDerivation: "pot" | "authority";
  /** Each expression statement, by its expression: where a write's checks go after it. */
  readonly statements = new Map<AstNode, AstNode>();
  /** The statements that are one of a list (a block's, a case's), which need no braces. */
  readonly listed = new Set<AstNode>();
  readonly splices: Splice[] = [];
  /** Each function's parameters, main's and every top-level function's. */
  private readonly paramsByFunction = new Map<AstNode, ReadonlyMap<string, Param>>();
  /** By the identifier that declares it: each parameter of main and of a top-level function, and
   *  the function it is one of. */
  private readonly paramBinders = new Map<
    AstNode,
    { readonly fn: AstNode; readonly param: Param }
  >();
  /** The top-level functions but `main`, by name. */
  private readonly topLevel: ReadonlyMap<string, AstNode>;
  private readonly functions: AstNode[] = [];
  private readonly slots: Slots;
  private readonly values = new Map<string, string>();
  /** Each swap at a price a stop could hold, by its stop's derivation. */
  readonly stoppable: string[] = [];
  /** How many times each of those inside a loop runs, by its derivation (`runsOf`). */
  readonly stoppableRuns = new Map<string, number | null>();
  private readonly sites: { readonly node: AstNode; readonly lower: () => void }[] = [];
  /** Each module's imports, `name as local`, in the order they were first used. */
  private readonly imports = new Map<string, Map<string, string>>();
  private readonly helpers = new Map<string, string>();
  /** Statements emitted once each, by key, at the top of `main`'s body. */
  private readonly opening = new Map<string, string>();
  private readonly reserved = new Set<string>();
  private readonly index: RowIndex;
  private literalTokens = 0;
  /** By top-level function: each of its `Account` parameters a site writes as a token account, by
   *  position, and how the first such site is spelled (`holdWrittenParams`). */
  private readonly written = new Map<AstNode, Map<number, string>>();
  /** The top-level function each splice a site made in one stands in. */
  private readonly spliceIn = new Map<Splice, AstNode>();
  /** The scope each node is read in (`walkScoped`). */
  private readonly scopes = new Map<AstNode, Scope | undefined>();
  /** The names main's parameters bind, everywhere in main. */
  private readonly mainParams = new Set<string>();

  constructor(
    readonly source: string,
    readonly tokens: ReadonlyMap<string, bigint>,
    rows: readonly SvmTokenRow[],
    /** Compile-time values a holder may name, by name: a key bound before the program compiles —
     *  main's `Address` argument, bound into the program (`args`) — which the cook attaches by
     *  value. */
    private readonly keys: ReadonlyMap<string, bigint> = new Map(),
    /** The chain's native coin, SOL: `<holder>.SOL` is refused, naming `<holder>.balance`. */
    readonly native?: string,
    /** The swaps at a price to hold to a stop, by their stop's derivation (`stop:…`). */
    readonly stopped: ReadonlySet<string> = new Set(),
    /** The names the caller binds (its defines, its contract bindings, and ambient exports, a `pot`
     *  or `self` among them), separately from source declarations: SDK namespaces never replace
     *  them, a `pot` or `self` among them is the caller's, and the accounts this adds are named
     *  apart from them. */
    readonly bound: ReadonlySet<string> = new Set(),
  ) {
    this.program = parseSauce(source);
    this.declarations = countDeclarations(this.program);
    this.declared = new Set(this.declarations.keys());
    this.parents = parentsOf(this.program);
    const topLevel = topLevelFunctions(this.program);
    this.main = topLevel.get("main");
    topLevel.delete("main");
    this.topLevel = topLevel;
    if (this.main !== undefined) this.paramsByFunction.set(this.main, paramsOf(this.main));
    for (const [name, fn] of topLevel) this.paramsByFunction.set(fn, paramsOf(fn, name));
    for (const [fn, params] of this.paramsByFunction) {
      for (const id of (fn.params as AstNode[] | undefined) ?? []) {
        const param = id.type === "Identifier" ? params.get(nameOf(id)) : undefined;
        if (param !== undefined) this.paramBinders.set(id, { fn, param });
      }
    }
    walkScoped(this.program, (n, scope) => this.scopes.set(n, scope));
    for (const param of (this.main?.params as AstNode[] | undefined) ?? []) {
      collectPatternNames(param, this.mainParams);
    }
    this.reads = readsOf(this.program, this.parents);
    // `pot.owner` is the Pot's owner, and reads no Pot: its `pot` makes no account the Pot's.
    const owners = potOwners(this.program);
    const potReads = new Set<AstNode>();
    const ownerMembers = new Set<AstNode>();
    for (const read of this.freeReads(POT_NAME)) {
      const owner = owners.get(read);
      if (owner === undefined) potReads.add(read);
      else ownerMembers.add(owner);
    }
    this.potReads = potReads;
    this.ownerMembers = ownerMembers;
    this.selfReads = [...this.freeReads(RETIRED_POT_NAME)];
    this.authorityDerivation = this.potReads.size > 0 ? "pot" : "authority";
    this.index = rowIndex(rows);
    // The accounts this adds to `main` are named apart from every name the program declares, every
    // name the caller binds, and every other name the program reads, which a parameter of `main`
    // of that name would hide: an ambient module's export among them. The Pot's own `pot` is the
    // one the Pot's account stands for.
    this.slots = new Slots(
      new Set([
        ...this.declared,
        ...bound,
        ...this.reads.map(nameOf).filter((name) => name !== POT_NAME && name !== RETIRED_POT_NAME),
      ]),
    );
    walk(this.program, (n) => {
      if (n.type === "ExpressionStatement") this.statements.set(n.expression as AstNode, n);
      if (n.type === "Program" || n.type === "BlockStatement" || n.type === "StaticBlock") {
        for (const statement of (n as { body?: AstNode[] }).body ?? []) this.listed.add(statement);
      }
      if (n.type === "SwitchCase") {
        for (const statement of (n as { consequent?: AstNode[] }).consequent ?? []) {
          this.listed.add(statement);
        }
      }
      if (
        n.type === "FunctionDeclaration" ||
        n.type === "FunctionExpression" ||
        n.type === "ArrowFunctionExpression"
      ) {
        this.functions.push(n);
      }
    });
  }

  /** Whether `name`, read at `node`, is a name the program binds there (`lexical-scope.ts`). */
  owns(node: AstNode, name: string): boolean {
    return shadowed(this.scopes.get(node), name, node.start);
  }

  /**
   * Every read of `name` where neither the program binds it there (`owns`) nor the caller binds it
   * (`bound`): the language's own name, `pot` or `Account`, where it reads one.
   */
  freeReads(name: string): ReadonlySet<AstNode> {
    let reads = this.freeByName.get(name);
    if (reads === undefined) {
      reads = new Set(
        this.bound.has(name)
          ? []
          : this.reads.filter((n) => nameOf(n) === name && !this.owns(n, name)),
      );
      this.freeByName.set(name, reads);
    }

    return reads;
  }

  /**
   * Whether `name`, read at `at`, is a registered symbol: one the program binds neither there nor
   * as a parameter of main, at the top of which the checks of the accounts it names stand.
   */
  isSymbol(name: string, at: AstNode): boolean {
    return this.tokens.has(name) && !this.owns(at, name) && !this.mainParams.has(name);
  }

  /** Whether `<holder>.<name>`, read at `at`, is the token syntax's: a registered symbol,
   *  `balance`, or the native coin's symbol (refused, naming `balance`) the program binds not. */
  isBalanceName(name: string, at: AstNode): boolean {
    return (
      this.isSymbol(name, at) ||
      name === BALANCE_MEMBER ||
      (name === this.native && !this.owns(at, name))
    );
  }

  /** Whether the lowering found sites in a program with no `main` to add their accounts to. */
  needsMain(): boolean {
    return this.main === undefined && this.sites.length > 0;
  }

  /** Where `node` stands: the innermost function around it. */
  placeOf(node: AstNode): Place {
    let inner: AstNode | undefined;
    for (const fn of this.functions) {
      if (
        fn.start <= node.start &&
        node.end <= fn.end &&
        (inner === undefined || fn.start > inner.start)
      ) {
        inner = fn;
      }
    }
    if (inner === undefined) return { kind: "outside" };
    if (inner === this.main) return { kind: "main" };
    for (const [name, fn] of this.topLevel) if (fn === inner) return { kind: "helper", fn, name };

    return { kind: "nested", fn: inner };
  }

  /** Registers a site, lowered once every collector has run, in source order. */
  site(node: AstNode, lower: () => void): void {
    this.sites.push({ node, lower });
  }

  /** `local`, the name a library function is imported under, which the program cannot declare. */
  use(module: string, name: string, local: string): string {
    let names = this.imports.get(module);
    if (names === undefined) {
      names = new Map();
      this.imports.set(module, names);
    }
    names.set(name, local);
    this.reserve(local);

    return local;
  }

  /** A helper function emitted once at the end of the program, under a reserved name. */
  helper(name: string, source: string): string {
    this.helpers.set(name, source);
    this.reserve(name);

    return name;
  }

  /**
   * A statement emitted once, by `key`, at the top of `main`'s body, before any of its own: where an
   * account added to `main` is checked to be the one its derivation names.
   */
  prologue(key: string, statement: string): void {
    if (!this.opening.has(key)) this.opening.set(key, statement);
  }

  /** A name the lowering brings in: refused, by name, where the program declares it too. */
  reserve(name: string): void {
    if (this.reserved.has(name)) return;
    this.reserved.add(name);
    if (this.declared.has(name)) {
      throw new Error(
        `\`${name}\` is reserved: Solana's token methods and venues are lowered to library ` +
          `functions under \`__sauce_\` names. Rename your \`${name}\`.`,
      );
    }
  }

  /**
   * A `Uint256` added to `main` after the accounts, one per derivation, which the cook's builder
   * works out as it builds the cook (a venue's `stop`).
   */
  value(derivation: string, base: string): string {
    let name = this.values.get(derivation);
    if (name === undefined) {
      name = base;
      for (let n = 2; this.slots.taken.has(name); n++) name = `${base}${n}`;
      this.slots.taken.add(name);
      this.values.set(derivation, name);
    }

    return name;
  }

  /** An account added to `main`: one per derivation, its role the union of its uses. */
  account(
    derivation: string,
    base: string,
    role: { writable?: boolean; signer?: boolean },
  ): string {
    return this.slots.use(derivation, base, role);
  }

  /**
   * Refuses a site no account can reach: in a function inside another, or outside every function of
   * a program with a `main`. A site in `main` takes main's parameters, and one in a top-level
   * function takes the same accounts as parameters of its own, passed at each call (`finish`).
   * `what` is the call's kind, for the message ("a token method").
   */
  requirePlaced(node: AstNode, spelled: string, what = "a token method"): void {
    const place = this.placeOf(node);
    if (place.kind === "nested") {
      const id = (place.fn as { id?: AstNode | null }).id;
      throw new Error(
        `${spelled} on Solana stands in ${id?.type === "Identifier" ? `\`${nameOf(id)}\`, ` : ""}a ` +
          `function inside another: the accounts ${what} moves through are added to main and ` +
          "passed to each top-level function that uses them, which a function inside another " +
          "cannot take. Write it in main, or in a top-level function main calls.",
      );
    }
    if (place.kind === "outside") {
      throw new Error(
        `${spelled} on Solana stands outside main: the accounts ${what} moves through are added ` +
          "to main as parameters. Write it in main, or in a top-level function main calls.",
      );
    }
  }

  /**
   * How many times `node`, in `main`'s body, runs: once outside any loop, else the product of the
   * counts of the loops around it (`loopCount`). A loop that never runs makes it 0, whatever the
   * other loops' counts, inside or outside it; short of that, null where one does not write its
   * count out. Null in a top-level function, which runs as often as it is called.
   */
  runsOf(node: AstNode): number | null {
    if (this.placeOf(node).kind !== "main") return null;
    let runs = 1n;
    let counted = true;
    walk(this.main?.body, (n) => {
      if (n.start > node.start || node.end > n.end || !LOOPS.has(n.type)) return;
      const count = loopCount(n);
      if (count === null) counted = false;
      else runs *= count;
    });

    return runs === 0n ? 0 : counted ? Number(runs) : null;
  }

  /**
   * The parameter `node` reads, where the binding in scope there is one of the function it stands
   * in (`lexical-scope.ts`): main's `Address`, an `Account` (with whether it is writable), or other.
   * A top-level function's `Address` is a value only the program has as it runs, so it is other.
   * Undefined for any other read: a local, a loop's binding, a parameter of a function around the
   * one it stands in, a name the program does not declare.
   */
  param(node: AstNode): Param | undefined {
    const binder = this.binderOf(node);
    const own = binder === undefined ? undefined : this.paramBinders.get(binder);
    if (own === undefined) return undefined;
    const place = this.placeOf(node);
    const fn = place.kind === "main" ? this.main : place.kind === "helper" ? place.fn : undefined;

    return own.fn === fn ? own.param : undefined;
  }

  /** A parameter `id` declares, of main or of a top-level function. */
  declaredParam(id: AstNode): Param | undefined {
    return this.paramBinders.get(id)?.param;
  }

  /** The identifier that declares the binding `node` reads, where the program declares one. */
  binderOf(node: AstNode): AstNode | undefined {
    return node.type === "Identifier"
      ? bindingOf(this.scopes.get(node), nameOf(node), node.start)
      : undefined;
  }

  /** Whether `node` reads the Pot: `pot`, where the program does not bind it. */
  isPot(node: AstNode): boolean {
    return this.potReads.has(node);
  }

  /** Whether `node` reads the Pot's owner: `pot.owner`, read on the Pot and not called. */
  isOwner(node: AstNode): boolean {
    return this.ownerMembers.has(node);
  }

  /** The program's top-level function `name`, `main` aside, where it declares the name once. */
  functionNamed(name: string): AstNode | undefined {
    return this.declarations.get(name) === 1 ? this.topLevel.get(name) : undefined;
  }

  /** Where the program imports `name` from: the module, and the name the module exports. */
  importOf(name: string): { readonly module: string; readonly name: string } | undefined {
    for (const statement of (this.program as { body?: AstNode[] }).body ?? []) {
      if (statement.type !== "ImportDeclaration") continue;
      for (const specifier of (statement as { specifiers?: AstNode[] }).specifiers ?? []) {
        const local = specifier.local as AstNode;
        const imported = specifier.imported as AstNode | undefined;
        if (specifier.type === "ImportSpecifier" && nameOf(local) === name && imported) {
          return {
            module: String((statement.source as { value?: unknown }).value),
            name: nameOf(imported),
          };
        }
      }
    }

    return undefined;
  }

  /** A holder (or delegate) argument, resolved to what the transaction can attach for it. */
  holderOf(node: AstNode, role: string, spelled: string): Holder {
    if (this.isPot(node)) return { kind: "authority" };
    if (node.type === "Identifier") {
      const name = nameOf(node);
      const param = this.param(node);
      if (param?.kind === "address") {
        return { kind: "key", name: `@${name}`, stem: name, value: name };
      }
      if (param?.kind === "account") {
        const fn = this.placeOf(node);
        return {
          kind: "account",
          param: name,
          writable: param.writable,
          ...(fn.kind === "helper"
            ? { helper: { fn: fn.fn, name: fn.name, index: param.index } }
            : {}),
        };
      }
      // A key the compile binds to a name the program does not declare there: main's `Address`
      // argument, bound into the program.
      const key = this.keys.get(name);
      if (key !== undefined && this.binderOf(node) === undefined) {
        return { kind: "key", name: base58(keyHex(key)), stem: name, value: name };
      }
      // A registered mint's own key: its associated token accounts derive off it as off any key.
      if (this.isSymbol(name, node)) {
        return {
          kind: "key",
          name: base58(keyHex(this.tokens.get(name)!)),
          stem: name,
          value: name,
        };
      }
    }
    // As a token's holder, `ctx.self()` is the account the program acts with, as on the EVM, so a
    // program written for an EVM chain (`USDC.balanceOf(ctx.self())`) means the same here. On
    // Solana `ctx.self()` alone is the engine's program id, which holds no token account.
    if (isCtxSelf(node, this.declared)) return { kind: "authority" };
    const key = keyLiteral(node, this.source);
    if (key !== undefined) {
      return { kind: "key", name: base58(key), stem: "account", value: key };
    }
    const text = this.source.slice(node.start, node.end);
    const account =
      role === "recipient" || role === "sender" ? "dest: Account<Writable>" : "account: Account";
    const of = this.param(node)?.of;
    throw new Error(
      `${spelled} on Solana: the ${role} must be known when the transaction is built, to attach ` +
        "its token account — `pot`, a parameter of main declared `Address`, a token's mint, or a " +
        "32-byte key — " +
        `and \`${text}\` is not` +
        (of === undefined
          ? ". For an account known only as the program runs, take the token account as a " +
            `parameter of main (\`${account}\`) and pass that.`
          : `: it is a parameter of \`${of}\`, a value only the program has as it runs. Make the ` +
            `call in main, where \`${text}\` can be main's \`Address\`, or take the token account ` +
            `as a parameter of main (\`${account}\`) and pass it to \`${of}\` as an \`Account\`.`),
    );
  }

  /**
   * A mint named by `node` — a registered symbol, a parameter of `main` declared `Address`, or a
   * 32-byte key — with `value` the program text that holds its key there.
   */
  tokenOf(node: AstNode, value: string, spelled: string): TokenRef {
    if (node.type === "Identifier") {
      const name = nameOf(node);
      if (this.isSymbol(name, node)) return { ...this.symbolToken(name), value, spelled };
      if (this.param(node)?.kind === "address") {
        return { value, name: `@${name}`, stem: capitalized(name), param: name, spelled };
      }
    }
    const key = keyLiteral(node, this.source);
    if (key !== undefined) {
      const row = this.index.byKey.get(key.toLowerCase());
      if (row !== undefined) return { value, name: row.symbol, stem: row.symbol, row, spelled };
      this.literalTokens++;

      return { value, name: base58(key), stem: `Token${this.literalTokens}`, spelled };
    }
    throw new Error(
      `${spelled} on Solana: the mint must be known when the transaction is built, to attach its ` +
        "accounts — a registered symbol, a parameter of main declared `Address`, or a 32-byte key.",
    );
  }

  /** A registered symbol's mint: the registry's row when the compile's mint is the row's. */
  symbolToken(symbol: string): TokenRef {
    const key = keyHex(this.tokens.get(symbol)!);
    const row = this.index.bySymbol.get(symbol);
    if (row !== undefined && row.address.toLowerCase() === key) {
      return { value: symbol, name: symbol, stem: symbol, row, spelled: symbol };
    }

    return { value: symbol, name: base58(key), stem: symbol, spelled: symbol };
  }

  // -- the accounts a call takes ------------------------------------------------------------------

  /**
   * The account the program acts with, which signs its token writes: the Pot where the program
   * names it, else the account that signs the engine call (`authorityDerivation`).
   */
  authority(): string {
    return this.account(this.authorityDerivation, POT_NAME, { signer: true });
  }

  /** The Pot's own account, `pot`, with the roles a use gives it. */
  pot(role: { writable?: boolean; signer?: boolean } = {}): string {
    return this.account(POT_NAME, POT_NAME, role);
  }

  /** The token program that owns the mint. */
  tokenProgram(token: TokenRef, role: { writable?: boolean; signer?: boolean } = {}): string {
    if (token.row?.tokenProgram === TOKEN_PROGRAM_ID) {
      return this.account(TOKEN_PROGRAM_ID, "tokenProgram", role);
    }
    if (token.row?.tokenProgram === TOKEN_2022_PROGRAM_ID) {
      return this.account(TOKEN_2022_PROGRAM_ID, "token2022Program", role);
    }

    return this.account(
      `program:${token.name}`,
      token.param === undefined ? `program${token.stem}` : `${token.param}Program`,
      role,
    );
  }

  /** The mint's own account. */
  mintAccount(token: TokenRef, role: { writable?: boolean; signer?: boolean } = {}): string {
    return this.account(
      `mint:${token.name}`,
      token.param === undefined ? `mint${token.stem}` : `${token.param}Account`,
      role,
    );
  }

  /** A holder's token account for the mint, and the check that binds it to the holder, if any. */
  tokenAccount(
    holder: Holder,
    token: TokenRef,
    writable: boolean,
    spelled: string,
  ): { readonly account: string; readonly holder?: string } {
    if (holder.kind === "account") {
      if (writable && holder.helper !== undefined) {
        // A top-level function declares no roles: each call's account is held to the write.
        const written = this.written.get(holder.helper.fn) ?? new Map<number, string>();
        if (!written.has(holder.helper.index)) written.set(holder.helper.index, spelled);
        this.written.set(holder.helper.fn, written);
      } else if (writable && !holder.writable) {
        throw new Error(
          `${spelled} on Solana: \`${holder.param}\` is a token account the call writes, so ` +
            `declare it \`${holder.param}: Account<Writable>\``,
        );
      }

      return { account: holder.param };
    }
    if (holder.kind === "authority") {
      const account = this.account(
        `${this.authorityDerivation}:${token.name}`,
        `pot${token.stem}`,
        {
          writable,
        },
      );

      return { account, holder: `${this.authority()}.address` };
    }

    return {
      account: this.account(`${holder.name}:${token.name}`, `${holder.stem}${token.stem}`, {
        writable,
      }),
      holder: holder.value,
    };
  }

  /**
   * Replaces a call with `<prefix>…kept…<suffix>`, from its start to the first argument kept and
   * from the last kept to its end: the arguments kept stay in place, so a call inside one is lowered
   * on its own. The parser leaves parentheses out of an expression's range, so the call's own range
   * is taken, which a parenthesized callee's are inside, and each argument kept keeps its own
   * (`argumentRange`).
   */
  spliceCall(
    site: MethodCall,
    first: AstNode,
    last: AstNode,
    prefix: string,
    suffix: string,
  ): void {
    const code = (this.blanked ??= blankLiterals(this.source));
    this.splices.push(
      {
        start: site.call.start,
        end: argumentRange(code, site.call, first).start,
        replacement: prefix,
      },
      { start: argumentRange(code, site.call, last).end, end: site.call.end, replacement: suffix },
    );
  }

  /**
   * Lowers every registered site, adds the accounts to `main` after its own parameters, gives each
   * top-level function the accounts its sites use (and those of the functions it calls) as
   * parameters of its own, passed at every call, and returns the program with its imports first and
   * its helpers last.
   */
  finish(): SvmLoweringResult {
    if (this.sites.length === 0) return { source: this.source, rewrote: false, derived: {} };
    const main = this.main;
    if (main === undefined) {
      throw new Error(
        "on Solana the accounts the token methods, venues and `pot` use are added to main as " +
          "parameters, and this program has no main and no statement to make one of. Write " +
          "`function main(...) { … }`.",
      );
    }
    // Every `__sauce_` name is the lowering's to bring in, whichever it brings.
    const taken = [...this.declared].find((name) => name.startsWith("__sauce_"));
    if (taken !== undefined) this.reserve(taken);
    for (const site of [...this.sites].sort((a, b) => a.node.start - b.node.start)) {
      const place = this.placeOf(site.node);
      const first = this.splices.length;
      site.lower();
      if (place.kind === "helper") {
        for (const splice of this.splices.slice(first)) this.spliceIn.set(splice, place.fn);
      }
    }
    this.holdWrittenParams();
    const splices = this.threadHelpers(dropContained(this.splices));
    if (this.opening.size > 0) {
      // An insertion, applied after a site's splice that starts where the body does.
      const body = (main.body as AstNode).start + 1;
      splices.push({
        start: body,
        end: body,
        replacement: [...this.opening.values()].map((statement) => `\n  ${statement}`).join(""),
      });
    }
    const added = [
      this.slots.params(),
      ...[...this.values.values()].map((name) => `${name}: Uint256`),
    ]
      .filter((params) => params !== "")
      .join(", ");
    splices.push(...this.appendParams(main, added));
    const imports = [...this.imports].map(
      ([module, names]) =>
        `import { ${[...names].map(([name, local]) => `${name} as ${local}`).join(", ")} } from "${module}";\n`,
    );
    // At one position a replacement is applied before an insertion, which so lands before it.
    const ordered = [
      ...splices.filter((splice) => splice.end > splice.start),
      ...splices.filter((splice) => splice.end === splice.start),
    ];

    return {
      source: `${imports.join("")}${applySplices(this.source, ordered)}${[...this.helpers.values()].join("")}`,
      rewrote: true,
      derived: this.slots.derived(),
      ...(this.values.size === 0
        ? {}
        : {
            values: Object.fromEntries(
              [...this.values].map(([derivation, name]) => [name, derivation]),
            ),
          }),
      ...(this.stoppable.length === 0 ? {} : { stoppable: this.stoppable }),
      ...(this.stoppableRuns.size === 0
        ? {}
        : { stoppableRuns: Object.fromEntries(this.stoppableRuns) }),
      ...(this.authorityDerivation === "pot" ? { namesPot: true } : {}),
    };
  }

  /** The insertion that adds `added`, parameters written out, after `fn`'s own. */
  private appendParams(fn: AstNode, added: string): Splice[] {
    if (added === "") return [];
    const declared = (fn as { params?: AstNode[] }).params ?? [];
    const last = declared[declared.length - 1];
    const open = this.source.indexOf("(", (fn.id as AstNode).end);

    return [
      last === undefined
        ? { start: open + 1, end: open + 1, replacement: added }
        : { start: last.end, end: last.end, replacement: `, ${added}` },
    ];
  }

  /**
   * Gives each top-level function the accounts and values its sites use, and those of every
   * top-level function it calls, and passes them at each call: the accounts as one list, its own
   * last parameter `__sauce_accounts: Account[]` in main's order, read by position where its sites
   * name one (a list is one value however many accounts it holds, where a parameter each would
   * pass the compiler's limit on what a function keeps in use: a venue's swap takes seventeen); the
   * values (a swap's stop) under main's names after it. A function that uses one and is not only
   * ever called by name, or is called from a function inside another, is refused: nothing could
   * pass it the accounts. So is one main never reaches: its accounts would be attached to every
   * cook for code that never runs. Returns `splices`, with the functions' rewritten, and the
   * additions.
   */
  private threadHelpers(splices: readonly Splice[]): Splice[] {
    const accounts = this.slots.names();
    const values = [...this.values.values()];
    const names = new Set([...accounts, ...values]);
    const uses = new Map<AstNode, Set<string>>();
    for (const splice of splices) {
      const fn = this.spliceIn.get(splice);
      if (fn === undefined) continue;
      const used = uses.get(fn) ?? new Set<string>();
      for (const word of identifiers(splice.replacement)) if (names.has(word)) used.add(word);
      uses.set(fn, used);
    }
    const reached = this.reachedFunctions();
    for (const [fn, used] of uses) {
      if (used.size === 0 || reached.has(fn)) continue;
      const name = nameOf(fn.id as AstNode);
      const named = [...accounts, ...values].filter((one) => used.has(one));
      throw new Error(
        `\`${name}\` uses accounts the lowering adds to main (${named.join(", ")}), and main ` +
          "never calls it: they would be attached to every cook for code that never runs. Call " +
          `\`${name}\` from main, or remove it.`,
      );
    }
    // Each call of a function that uses one, checked; and, to a fixed point, what each passes on.
    const calls = new Map<string, AstNode[]>();
    for (let changed = true; changed;) {
      changed = false;
      for (const [name, fn] of this.topLevel) {
        const used = uses.get(fn);
        if (used === undefined || used.size === 0) continue;
        if ((this.declarations.get(name) ?? 0) > 1) {
          throw new Error(
            `\`${name}\` is declared more than once, and on Solana it uses accounts the lowering ` +
              "passes to it at each call: name each function apart.",
          );
        }
        const sites = calls.get(name) ?? this.callsOf(name, used);
        calls.set(name, sites);
        for (const call of sites) {
          const place = this.placeOf(call);
          if (place.kind !== "helper") continue;
          const caller = uses.get(place.fn) ?? new Set<string>();
          for (const one of used) {
            if (!caller.has(one)) {
              caller.add(one);
              changed = true;
            }
          }
          uses.set(place.fn, caller);
        }
      }
    }
    if (uses.size === 0) return [...splices];
    const list = HELPER_ACCOUNTS;
    this.reserve(list);
    /** Each function's accounts, in main's order, and its values. */
    const passed = new Map<AstNode, { accounts: string[]; values: string[] }>();
    for (const [fn, used] of uses) {
      passed.set(fn, {
        accounts: accounts.filter((one) => used.has(one)),
        values: values.filter((one) => used.has(one)),
      });
    }
    // In a function, each account its sites name is read from its list by position.
    const rewritten = splices.map((splice) => {
      const fn = this.spliceIn.get(splice);
      const own = fn === undefined ? undefined : passed.get(fn);
      if (own === undefined) return splice;
      const at = new Map(own.accounts.map((one, i) => [one, `${list}[${i}]`]));
      return { ...splice, replacement: substitute(splice.replacement, at) };
    });
    for (const [name, fn] of this.topLevel) {
      const own = passed.get(fn);
      if (own === undefined || own.accounts.length + own.values.length === 0) continue;
      rewritten.push(
        ...this.appendParams(
          fn,
          [
            ...(own.accounts.length === 0 ? [] : [`${list}: Account[]`]),
            ...own.values.map((one) => `${one}: Uint256`),
          ].join(", "),
        ),
      );
      for (const call of calls.get(name) ?? []) {
        const place = this.placeOf(call);
        const caller = place.kind === "helper" ? passed.get(place.fn) : undefined;
        const of = (one: string): string =>
          caller === undefined ? one : `${list}[${caller.accounts.indexOf(one)}]`;
        const args = [
          ...(own.accounts.length === 0
            ? []
            : [
                caller !== undefined && caller.accounts.join() === own.accounts.join()
                  ? list
                  : `[${own.accounts.map(of).join(", ")}]`,
              ]),
          ...own.values,
        ].join(", ");
        const given = (call as { arguments?: AstNode[] }).arguments ?? [];
        const last = given[given.length - 1];
        // After the last argument's own parentheses (`argumentRange`): `f((x))` is `f((x), …)`.
        const after =
          last === undefined
            ? call.end - 1
            : argumentRange((this.blanked ??= blankLiterals(this.source)), call, last).end;
        rewritten.push({
          start: after,
          end: after,
          replacement: last === undefined ? args : `, ${args}`,
        });
      }
    }

    return rewritten;
  }

  /**
   * The top-level functions main reaches: those it names, and those each of them names, through
   * the binding each name is read as. A name read outside every function (a module constant's
   * value) reaches its function too, whose call is refused where it stands (`callsOf`).
   */
  private reachedFunctions(): ReadonlySet<AstNode> {
    const reached = new Set<AstNode>();
    const byBinder = new Map<AstNode, AstNode>();
    for (const fn of this.topLevel.values()) byBinder.set(fn.id as AstNode, fn);
    const pending: AstNode[] = [];
    const reach = (read: AstNode): void => {
      const binder = this.binderOf(read);
      const fn = binder === undefined ? undefined : byBinder.get(binder);
      if (fn === undefined || reached.has(fn)) return;
      reached.add(fn);
      pending.push(fn);
    };
    for (const read of this.reads) if (this.placeOf(read).kind === "outside") reach(read);
    if (this.main !== undefined) pending.push(this.main);
    for (let fn = pending.pop(); fn !== undefined; fn = pending.pop()) {
      for (const read of this.reads) {
        if (fn.start <= read.start && read.end <= fn.end) reach(read);
      }
    }

    return reached;
  }

  /**
   * Holds each account a top-level function writes as a token account, which it takes as a
   * parameter, to what each call passes there: a parameter of main declared `Account<Writable>`,
   * which carries the role the write needs (a function other than main declares no roles), or a
   * calling function's own parameter, held in turn at each of its calls. Anything else is refused.
   */
  private holdWrittenParams(): void {
    // Each parameter held, and where the write that holds it stands: in which function, by which
    // of its parameters.
    const pending = [...this.written].flatMap(([fn, params]) =>
      [...params].map(([index, spelled]) => {
        const site = `${spelled} on Solana, in \`${nameOf(fn.id as AstNode)}\`: its \`${nameOf((fn.params as AstNode[])[index]!)}\``;
        return { fn, index, site };
      }),
    );
    const held = new Set<string>();
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const { fn, index, site } = next;
      const key = `${fn.start}:${index}`;
      if (held.has(key)) continue;
      held.add(key);
      for (const read of this.reads) {
        const call = this.parents.get(read);
        if (call?.type !== "CallExpression" || call.callee !== read) continue;
        if (this.binderOf(read) !== fn.id) continue;
        const place = this.placeOf(call);
        // A call nothing can pass accounts from is refused where the accounts are passed.
        if (place.kind !== "main" && place.kind !== "helper") continue;
        const given = ((call.arguments as AstNode[] | undefined) ?? [])[index];
        if (given === undefined) continue;
        const param = this.param(given);
        if (param?.kind === "account" && place.kind === "helper") {
          pending.push({ fn: place.fn, index: param.index, site });
          continue;
        }
        if (param?.kind === "account" && param.writable) continue;
        const text = this.source.slice(given.start, given.end);
        throw new Error(
          `${site} is a token account the call writes, and a function other than main declares ` +
            "no roles: " +
            (param?.kind === "account"
              ? `declare main's \`${text}\` as \`${text}: Account<Writable>\`.`
              : `pass it a parameter of main declared \`Account<Writable>\`, which \`${text}\` is not.`),
        );
      }
    }
  }

  /**
   * Every call of the top-level function `name`, which uses the accounts `used`: refused where it is
   * read other than as the callee of a call (a value, a `.catch` handler), or called from a
   * function inside another or outside every function.
   */
  private callsOf(name: string, used: ReadonlySet<string>): AstNode[] {
    const calls: AstNode[] = [];
    const what = `\`${name}\` uses accounts the lowering adds to main (${[...used].join(", ")}), which it takes as parameters, passed at each call`;
    for (const read of this.reads.filter((n) => nameOf(n) === name)) {
      const parent = this.parents.get(read);
      if (parent?.type !== "CallExpression" || parent.callee !== read) {
        const callee = parent?.type === "CallExpression" ? (parent.callee as AstNode) : undefined;
        const handler =
          callee?.type === "MemberExpression" &&
          (callee.property as AstNode).type === "Identifier" &&
          nameOf(callee.property as AstNode) === "catch";
        throw new Error(
          `${what}: it can only be called by name, and here it is ` +
            (handler
              ? "a `.catch` handler, which the program calls with the error alone"
              : `a value (\`${this.source.slice((parent ?? read).start, (parent ?? read).end)}\`)`) +
            `. Call \`${name}\` directly, or write what it does where it is used.`,
        );
      }
      const place = this.placeOf(parent);
      if (place.kind === "nested" || place.kind === "outside") {
        throw new Error(
          `${what}: here it is called ${place.kind === "nested" ? "from a function inside another, which has no accounts to pass" : "outside every function"}. Call it from main, or from a top-level function.`,
        );
      }
      calls.push(parent);
    }

    return calls;
  }
}
