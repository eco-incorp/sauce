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
 * program's own account (`self`, `ctx.self()`); `holderOf` and `tokenOf` refuse anything else,
 * naming the explicit form.
 */
import { address, getAddressDecoder, getAddressEncoder } from "@solana/kit";

import { countDeclarations, walk, type AstNode } from "./ast-walk.js";
import { parseSauce } from "./parse.js";
import { applySplices, methodCall, type MethodCall, type Splice } from "./token-rewrite.js";
import type { SvmTokenRow } from "./token-registry.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";

export interface SvmLoweringResult {
  readonly source: string;
  readonly rewrote: boolean;
  /**
   * Each account the lowering added to `main`, by its parameter name: how it is derived, as an
   * `--account` value (`self:USDC`, `@to:USDC`, …). Empty when nothing was lowered.
   */
  readonly derived: Readonly<Record<string, string>>;
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

/** A holder, or a delegate, as a call names it. */
export type Holder =
  | { readonly kind: "self" }
  | {
      readonly kind: "key";
      /** `@<parameter>`, or the key in base58. */
      readonly name: string;
      /** The holder in an account's name. */
      readonly stem: string;
      /** The key in the program's text, for the check. */
      readonly value: string;
    }
  | { readonly kind: "account"; readonly param: string; readonly writable: boolean };

interface MainParam {
  readonly kind: "address" | "account" | "other";
  readonly writable: boolean;
  /** The annotation's type name (`Uint256`, `Address`, `Account`), where it is one name. */
  readonly type?: string;
}

interface Slot {
  readonly name: string;
  writable: boolean;
  signer: boolean;
}

/** The accounts a lowering adds to `main`, one per derivation, named apart from every name the
 *  program declares. */
class Slots {
  private readonly byDerivation = new Map<string, Slot>();

  constructor(private readonly taken: Set<string>) {}

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

/** `main`'s `Address` and `Account` parameters, by name, with whether an account is writable. */
function mainParams(main: AstNode): ReadonlyMap<string, MainParam> {
  const params = new Map<string, MainParam>();
  for (const param of (main as { params?: AstNode[] }).params ?? []) {
    if (param.type !== "Identifier") continue;
    const annotation = (param as { typeAnnotation?: { typeAnnotation?: AstNode } }).typeAnnotation
      ?.typeAnnotation;
    const typeName = (annotation as { typeName?: AstNode } | undefined)?.typeName;
    const type = typeName?.type === "Identifier" ? nameOf(typeName) : undefined;
    const roles = (
      (annotation as { typeArguments?: { params?: AstNode[] } } | undefined)?.typeArguments
        ?.params ?? []
    ).map((role) => {
      const name = (role as { typeName?: AstNode }).typeName;

      return name?.type === "Identifier" ? nameOf(name) : "";
    });
    params.set(nameOf(param), {
      kind: type === "Address" ? "address" : type === "Account" ? "account" : "other",
      writable: roles.includes("Writable"),
      ...(type === undefined ? {} : { type }),
    });
  }

  return params;
}

/** The top-level `function main`, exported or not. */
function findMain(program: AstNode): AstNode | undefined {
  for (const statement of (program as { body?: AstNode[] }).body ?? []) {
    const node =
      statement.type === "ExportNamedDeclaration"
        ? ((statement as { declaration?: AstNode | null }).declaration ?? undefined)
        : statement;
    if (
      node?.type === "FunctionDeclaration" &&
      (node as { id?: AstNode | null }).id?.type === "Identifier" &&
      nameOf((node as unknown as { id: AstNode }).id) === "main"
    ) {
      return node;
    }
  }

  return undefined;
}

/** `ctx.self()`, with `ctx` the language's, not a name the program declares. */
function isCtxSelf(node: AstNode, declared: ReadonlySet<string>): boolean {
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

/** Whether `source` has an identifier that `wanted` takes, stopping at the first. */
export function namesAny(source: string, wanted: (name: string) => boolean): boolean {
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
  /** Each expression statement, by its expression: where a write's checks go after it. */
  readonly statements = new Map<AstNode, AstNode>();
  /** The statements that are one of a list (a block's, a case's), which need no braces. */
  readonly listed = new Set<AstNode>();
  readonly splices: Splice[] = [];
  private readonly params: ReadonlyMap<string, MainParam>;
  private readonly functions: AstNode[] = [];
  private readonly slots: Slots;
  private readonly sites: { readonly node: AstNode; readonly lower: () => void }[] = [];
  /** Each module's imports, `name as local`, in the order they were first used. */
  private readonly imports = new Map<string, Map<string, string>>();
  private readonly helpers = new Map<string, string>();
  /** Statements emitted once each, by key, at the top of `main`'s body. */
  private readonly opening = new Map<string, string>();
  private readonly reserved = new Set<string>();
  private readonly index: RowIndex;
  private literalTokens = 0;

  constructor(
    readonly source: string,
    readonly tokens: ReadonlyMap<string, bigint>,
    rows: readonly SvmTokenRow[],
    /** Compile-time values a holder may name, by name: a key bound before the program compiles —
     *  main's `Address` argument, bound into an intent's body — which the cook attaches by value. */
    private readonly keys: ReadonlyMap<string, bigint> = new Map(),
  ) {
    this.program = parseSauce(source);
    this.declarations = countDeclarations(this.program);
    this.declared = new Set(this.declarations.keys());
    this.main = findMain(this.program);
    this.params = this.main === undefined ? new Map() : mainParams(this.main);
    this.index = rowIndex(rows);
    this.slots = new Slots(new Set(this.declared));
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
        n !== this.main &&
        (n.type === "FunctionDeclaration" ||
          n.type === "FunctionExpression" ||
          n.type === "ArrowFunctionExpression")
      ) {
        this.functions.push(n);
      }
    });
  }

  /** Whether `name` is a registered symbol the program does not declare itself. */
  isSymbol(name: string): boolean {
    return this.tokens.has(name) && !this.declared.has(name);
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

  /** An account added to `main`: one per derivation, its role the union of its uses. */
  account(
    derivation: string,
    base: string,
    role: { writable?: boolean; signer?: boolean },
  ): string {
    return this.slots.use(derivation, base, role);
  }

  /**
   * Refuses a site outside `main`'s own body: its accounts are main's parameters. `what` is the
   * call's kind, for the message ("a token method").
   */
  requireInMain(node: AstNode, spelled: string, what = "a token method"): void {
    if (this.main === undefined) {
      throw new Error(
        `${spelled} on Solana: the accounts ${what} moves through are added to main as ` +
          "parameters, and this program has no main. Write its statements in " +
          "`function main(...) { … }`.",
      );
    }
    const body = this.main.body as AstNode;
    const outer = this.functions.find((fn) => fn.start <= node.start && node.end <= fn.end);
    if (node.start < body.start || node.end > body.end || outer !== undefined) {
      const id = (outer as { id?: AstNode | null } | undefined)?.id;
      throw new Error(
        `${spelled} on Solana stands in ${id?.type === "Identifier" ? `\`${nameOf(id)}\`` : "a nested function"}: ` +
          `the accounts ${what} moves through are parameters of main, so call it in main ` +
          "itself, or give the helper the accounts and call the library function with them.",
      );
    }
  }

  /** `main`'s parameter `name`: an `Address`, an `Account` (with whether it is writable), or other. */
  param(name: string): MainParam | undefined {
    return this.params.get(name);
  }

  /** A holder (or delegate) argument, resolved to what the transaction can attach for it. */
  holderOf(node: AstNode, role: string, spelled: string): Holder {
    if (node.type === "Identifier") {
      const name = nameOf(node);
      if (name === "self" && !this.declared.has("self")) return { kind: "self" };
      const param = this.params.get(name);
      if (param?.kind === "address") {
        return { kind: "key", name: `@${name}`, stem: name, value: name };
      }
      if (param?.kind === "account") {
        return { kind: "account", param: name, writable: param.writable };
      }
      const key = this.keys.get(name);
      if (key !== undefined && param === undefined && !this.declared.has(name)) {
        return { kind: "key", name: base58(keyHex(key)), stem: name, value: name };
      }
    }
    // As a token's holder, `ctx.self()` is the program's own account, the Pot, as on the EVM, so a
    // program written for an EVM chain (`USDC.balanceOf(ctx.self())`) means the same here. On
    // Solana `ctx.self()` alone is the engine's program id, which holds no token account.
    if (isCtxSelf(node, this.declared)) return { kind: "self" };
    const key = keyLiteral(node, this.source);
    if (key !== undefined) {
      return { kind: "key", name: base58(key), stem: "account", value: key };
    }
    const text = this.source.slice(node.start, node.end);
    const account =
      role === "recipient" || role === "sender" ? "dest: Account<Writable>" : "account: Account";
    throw new Error(
      `${spelled} on Solana: the ${role} must be known when the transaction is built, to attach ` +
        "its token account — `self`, a parameter of main declared `Address`, or a 32-byte key — " +
        `and \`${text}\` is not. For an account known only as the program runs, take the token ` +
        `account as a parameter of main (\`${account}\`) and pass that.`,
    );
  }

  /**
   * A mint named by `node` — a registered symbol, a parameter of `main` declared `Address`, or a
   * 32-byte key — with `value` the program text that holds its key there.
   */
  tokenOf(node: AstNode, value: string, spelled: string): TokenRef {
    if (node.type === "Identifier") {
      const name = nameOf(node);
      if (this.isSymbol(name)) return { ...this.symbolToken(name), value, spelled };
      if (this.params.get(name)?.kind === "address") {
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

  /** The authority the program acts with: the Pot, or the signer cooked directly. */
  authority(): string {
    return this.account("self", "pot", { signer: true });
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
      if (writable && !holder.writable) {
        throw new Error(
          `${spelled} on Solana: \`${holder.param}\` is a token account the call writes, so ` +
            `declare it \`${holder.param}: Account<Writable>\``,
        );
      }

      return { account: holder.param };
    }
    if (holder.kind === "self") {
      const account = this.account(`self:${token.name}`, `pot${token.stem}`, { writable });

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
   * Replaces a call with `<prefix>…kept…<suffix>`, from its callee to the first argument kept and
   * from the last kept to its end: the arguments kept stay in place, so a call inside one is lowered
   * on its own.
   */
  spliceCall(
    site: MethodCall,
    first: AstNode,
    last: AstNode,
    prefix: string,
    suffix: string,
  ): void {
    this.splices.push(
      { start: site.callee.start, end: first.start, replacement: prefix },
      { start: last.end, end: site.call.end, replacement: suffix },
    );
  }

  /**
   * Lowers every registered site, adds the accounts to `main` after its own parameters, and returns
   * the program with its imports first and its helpers last.
   */
  finish(): SvmLoweringResult {
    if (this.sites.length === 0) return { source: this.source, rewrote: false, derived: {} };
    // Every `__sauce_` name is the lowering's to bring in, whichever it brings.
    const taken = [...this.declared].find((name) => name.startsWith("__sauce_"));
    if (taken !== undefined) this.reserve(taken);
    for (const site of [...this.sites].sort((a, b) => a.node.start - b.node.start)) site.lower();
    const main = this.main!;
    if (this.opening.size > 0) {
      // Pushed after every site's splice, so one that starts where the body does is applied first.
      const body = (main.body as AstNode).start + 1;
      this.splices.push({
        start: body,
        end: body,
        replacement: [...this.opening.values()].map((statement) => `\n  ${statement}`).join(""),
      });
    }
    const declaredParams = (main as { params?: AstNode[] }).params ?? [];
    const last = declaredParams[declaredParams.length - 1];
    const open = this.source.indexOf("(", (main.id as AstNode).end);
    this.splices.push(
      last === undefined
        ? { start: open + 1, end: open + 1, replacement: this.slots.params() }
        : { start: last.end, end: last.end, replacement: `, ${this.slots.params()}` },
    );
    const imports = [...this.imports].map(
      ([module, names]) =>
        `import { ${[...names].map(([name, local]) => `${name} as ${local}`).join(", ")} } from "${module}";\n`,
    );

    return {
      source: `${imports.join("")}${applySplices(this.source, this.splices)}${[...this.helpers.values()].join("")}`,
      rewrote: true,
      derived: this.slots.derived(),
    };
  }
}
