/**
 * The token syntax on Solana, lowered before the compiler sees it: `USDC.transfer(to, amount)`,
 * `USDC.approve(spender, amount)`, `USDC.transferFrom(from, to, amount)`, `USDC.balanceOf(who)`,
 * `self.USDC`, and each of them on `Token(mint)`.
 *
 * On the EVM a token write names addresses and nothing else (`token-rewrite.ts`). On Solana a token
 * program moves tokens between token ACCOUNTS, and every account an instruction touches is one the
 * transaction attaches, which a program declares as an `Account` parameter of `main`. So each call
 * here lowers to `@sauce/token`'s SVM arm, and the accounts it takes are ADDED to `main`, each with
 * how it is derived, written as an `--account` value (`svm/account-names.ts`):
 *
 *   self                 the authority the program acts with: the Pot, or the signer cooked directly
 *   self:USDC            its associated token account for the mint
 *   @to:USDC             the associated token account of main's argument `to`
 *   <base58>:USDC        the associated token account of a key the program writes out
 *   @spender             main's argument itself, as an account (an approval's delegate)
 *   mint:USDC            the mint
 *   <token program id>   the token program that owns the mint, or `program:<token>` for a mint only
 *                        the transaction names
 *
 * The `sauce` command and the MCP server fill each from the cook's owner, Pot and arguments, so a
 * program written with the token methods runs with no `--account` at all; an `--account` given for
 * one of these slots replaces its derivation.
 *
 * WHICH WRITE. A mint the registry records belongs to a known program: an SPL Token mint is moved by
 * the legacy `transfer`/`approve` (a transfer is 321 bytes), a Token-2022 mint by `transferChecked`/
 * `approveChecked` with the registry's decimals (545 bytes, and the mint as one more account:
 * Token-2022 refuses the plain transfer for a mint with a fee, a hook or a pause). A mint only the
 * transaction names (`Token(mint)` of an argument, or a key no row records) may belong to either, so
 * it takes the checked write, which both programs implement, with the decimals read from the mint.
 *
 * THE HOLDER IS CHECKED ON CHAIN. A derived token account is whatever the builder attached, and
 * whoever builds the transaction (a solver, for a cook it fills) could attach another. So each write
 * is followed by a check that the account's owner (bytes 32 to 64) is the holder the call named:
 * `USDC.transfer(to, amount)` cannot pay anyone but `to`. Reading the owner is sound after the write,
 * because the token program has just taken the account as one of the mint's. A read is checked the
 * same way after `balanceOf` has validated the account (`__sauce_svm_balance`).
 *
 * WHAT MUST BE KNOWN. A holder and a mint are derived as the transaction is built, so each must be
 * known then: `self`, a parameter of `main` declared `Address` (its argument), or a 32-byte key
 * written out. One computed while the program runs is refused, naming the explicit form: an
 * `Account` parameter of `main` in its place is the token account itself, which the caller attaches
 * and the program does not check (`USDC.transfer(dest, amount)` with `dest: Account<Writable>`).
 *
 * The accounts are `main`'s parameters, so every call stands in `main` itself (a helper has no
 * account parameters), and the program has a `main` (a script has no signature to add them to).
 * The explicit forms (`transfer(USDC, tokenProgram, source, dest, authority, amount)` and the rest)
 * are untouched: only the method syntax is lowered, and to those same functions.
 */
import { getAddressDecoder } from "@solana/kit";

import { isChainKey, resolveNamespace } from "./accessor-index.js";
import { countDeclarations, walk, type AstNode } from "./ast-walk.js";
import { parseSauce } from "./parse.js";
import {
  applySplices,
  bindingCalls,
  collectValuePositionExclusions,
  factoryArgument,
  isFactoryCall,
  methodCall,
  REWRITABLE_METHODS,
  TOKEN_FACTORY_NAME,
  type MethodCall,
  type Splice,
} from "./token-rewrite.js";
import type { SvmTokenRow } from "./token-registry.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";

/** The `@sauce/token` functions a lowering calls, each imported under its `__sauce_` name. */
const LIBRARY = [
  "balanceOf",
  "transfer",
  "transferFrom",
  "approve",
  "transferChecked",
  "approveChecked",
] as const;
type LibraryFunction = (typeof LIBRARY)[number];

const local = (fn: LibraryFunction): string => `__sauce_${fn}`;

/** The read with its holder check, emitted once at the end of a program that reads a balance. */
const BALANCE_HELPER = "__sauce_svm_balance";
const BALANCE_HELPER_SOURCE = `
function ${BALANCE_HELPER}(token: Address, account: Account, holder: Address): Uint256 {
  const amount = ${local("balanceOf")}(token, account);
  require(svm.sload(account, 32, 32).toBe() == holder, "wrong holder account");
  return amount;
}
`;

/** Every name the lowering brings into the program, which the program cannot declare itself. */
const RESERVED = [...LIBRARY.map(local), BALANCE_HELPER];

/** What the method syntax takes: each method's parameters, as the EVM's ERC-20 names them. */
const METHOD_PARAMS: Readonly<Record<string, readonly string[]>> = {
  transfer: ["to", "amount"],
  approve: ["spender", "amount"],
  transferFrom: ["from", "to", "amount"],
  balanceOf: ["owner"],
};

export interface SvmTokenRewriteResult {
  readonly source: string;
  readonly rewrote: boolean;
  /**
   * Each account the lowering added to `main`, by its parameter name: how it is derived, as an
   * `--account` value (`self:USDC`, `@to:USDC`, …). Empty when nothing was lowered.
   */
  readonly derived: Readonly<Record<string, string>>;
}

/** A mint as a call names it. */
interface TokenRef {
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
type Holder =
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

const nameOf = (node: AstNode): string => (node as unknown as { name: string }).name;

const capitalized = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** A 32-byte key written out (`0x` and 64 hex digits, with or without an `n`), else undefined. */
function keyLiteral(node: AstNode, source: string): string | undefined {
  if (node.type !== "Literal") return undefined;
  const raw = source.slice(node.start, node.end);
  const hex = /^0x[0-9a-fA-F]{64}n?$/.test(raw) ? raw.replace(/n$/, "") : undefined;

  return hex;
}

/** A 32-byte key, hex, in base58. */
function base58(hex: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(2 + 2 * i, 4 + 2 * i), 16);

  return getAddressDecoder().decode(bytes);
}

/** A key as 64 hex digits, `0x`-prefixed, lowercase. */
const keyHex = (key: bigint): string => `0x${key.toString(16).padStart(64, "0")}`;

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

/**
 * Lowers the token syntax of a program for Solana, adding the accounts it needs to `main`. `tokens`
 * is the chain's symbol to mint key map (the registry's, with any symbol the caller gave its own
 * mint), and `rows` the registry's mints, whose programs and decimals pick each write.
 */
export function rewriteSvmTokenSyntax(
  source: string,
  tokens: ReadonlyMap<string, bigint>,
  rows: readonly SvmTokenRow[],
): SvmTokenRewriteResult {
  const none: SvmTokenRewriteResult = { source, rewrote: false, derived: {} };
  const program = parseSauce(source);
  const declarations = countDeclarations(program);
  const declared = new Set(declarations.keys());
  const isSymbol = (name: string): boolean => tokens.has(name) && !declared.has(name);
  const factoryOwned = !declared.has(TOKEN_FACTORY_NAME);

  // -- the sites, found in the whole program ------------------------------------------------------
  interface Site {
    readonly node: AstNode;
    readonly lower: () => void;
  }
  const sites: Site[] = [];
  const factories = new Set<AstNode>();
  if (factoryOwned) {
    walk(program, (n) => {
      if (isFactoryCall(n)) factories.add(n);
    });
  }
  if (
    factories.size === 0 &&
    ![...declarations.keys(), ...identifiers(program)].some((name) => isSymbol(name))
  ) {
    return none;
  }

  const main = findMain(program);
  const params = main === undefined ? new Map<string, MainParam>() : mainParams(main);
  const statements = new Map<AstNode, AstNode>();
  const listed = new Set<AstNode>();
  walk(program, (n) => {
    if (n.type === "ExpressionStatement") statements.set(n.expression as AstNode, n);
    if (n.type === "Program" || n.type === "BlockStatement" || n.type === "StaticBlock") {
      for (const statement of (n as { body?: AstNode[] }).body ?? []) listed.add(statement);
    }
    if (n.type === "SwitchCase") {
      for (const statement of (n as { consequent?: AstNode[] }).consequent ?? []) {
        listed.add(statement);
      }
    }
  });
  const functions: AstNode[] = [];
  walk(program, (n) => {
    if (
      n !== main &&
      (n.type === "FunctionDeclaration" ||
        n.type === "FunctionExpression" ||
        n.type === "ArrowFunctionExpression")
    ) {
      functions.push(n);
    }
  });

  const slots = new Slots(new Set([...declared, ...RESERVED]));
  const used = new Set<LibraryFunction>();
  let balanceHelper = false;
  const splices: Splice[] = [];
  let literalTokens = 0;

  const spelling = (receiver: string, method: string): string => `\`${receiver}.${method}(…)\``;

  /** Refuses a site outside `main`'s own body. */
  const requireInMain = (node: AstNode, spelled: string): void => {
    if (main === undefined) {
      throw new Error(
        `${spelled} on Solana: the accounts a token method moves through are added to main as ` +
          "parameters, and this program has no main. Write its statements in " +
          "`function main(...) { … }`.",
      );
    }
    const body = main.body as AstNode;
    const outer = functions.find((fn) => fn.start <= node.start && node.end <= fn.end);
    if (node.start < body.start || node.end > body.end || outer !== undefined) {
      const id = (outer as { id?: AstNode | null } | undefined)?.id;
      throw new Error(
        `${spelled} on Solana stands in ${id?.type === "Identifier" ? `\`${nameOf(id)}\`` : "a nested function"}: ` +
          "the accounts a token method moves through are parameters of main, so call it in main " +
          "itself, or give the helper the accounts and call @sauce/token's transfer or " +
          "transferChecked with them.",
      );
    }
  };

  /** A holder (or delegate) argument, resolved to what the transaction can attach for it. */
  const holderOf = (node: AstNode, role: string, spelled: string): Holder => {
    if (node.type === "Identifier") {
      const name = nameOf(node);
      if (name === "self" && !declared.has("self")) return { kind: "self" };
      const param = params.get(name);
      if (param?.kind === "address")
        return { kind: "key", name: `@${name}`, stem: name, value: name };
      if (param?.kind === "account") {
        return { kind: "account", param: name, writable: param.writable };
      }
    }
    const key = keyLiteral(node, source);
    if (key !== undefined) {
      return { kind: "key", name: base58(key), stem: "account", value: key };
    }
    const text = source.slice(node.start, node.end);
    const engine =
      text.replace(/\s/g, "") === "ctx.self()"
        ? " On Solana `ctx.self()` is the engine's program id, not the Pot: the Pot is `self`."
        : "";
    throw new Error(
      `${spelled} on Solana: the ${role} must be known when the transaction is built, to attach ` +
        `its token account — \`self\`, a parameter of main declared \`Address\`, or a 32-byte key ` +
        `— and \`${text}\` is not.${engine} For an account known only as the program runs, take ` +
        "the token account as a parameter of main (`dest: Account<Writable>`) and pass that.",
    );
  };

  /** A `Token(<arg>)`'s mint. */
  const tokenOfFactory = (call: AstNode, value: string): TokenRef => {
    const argument = factoryArgument(call);
    const spelled = `${TOKEN_FACTORY_NAME}(${source.slice(argument.start, argument.end)})`;
    if (argument.type === "Identifier") {
      const name = nameOf(argument);
      if (isSymbol(name)) return { ...symbolToken(name), value, spelled };
      if (params.get(name)?.kind === "address") {
        return { value, name: `@${name}`, stem: capitalized(name), param: name, spelled };
      }
    }
    const key = keyLiteral(argument, source);
    if (key !== undefined) {
      const row = rows.find((candidate) => candidate.address.toLowerCase() === key.toLowerCase());
      if (row !== undefined) return { value, name: row.symbol, stem: row.symbol, row, spelled };
      literalTokens++;

      return { value, name: base58(key), stem: `Token${literalTokens}`, spelled };
    }
    throw new Error(
      `${spelled} on Solana: the mint must be known when the transaction is built, to attach its ` +
        "accounts — a registered symbol, a parameter of main declared `Address`, or a 32-byte key.",
    );
  };

  /** A registered symbol's mint: the registry's row when the compile's mint is the row's. */
  const symbolToken = (symbol: string): TokenRef => {
    const key = keyHex(tokens.get(symbol)!);
    const row = rows.find((candidate) => candidate.symbol === symbol);
    if (row !== undefined && row.address.toLowerCase() === key) {
      return { value: symbol, name: symbol, stem: symbol, row, spelled: symbol };
    }

    return { value: symbol, name: base58(key), stem: symbol, spelled: symbol };
  };

  // -- the accounts a call takes ------------------------------------------------------------------

  const authority = (): string => slots.use("self", "pot", { signer: true });

  const tokenProgram = (token: TokenRef): string => {
    if (token.row?.tokenProgram === TOKEN_PROGRAM_ID) {
      return slots.use(TOKEN_PROGRAM_ID, "tokenProgram", {});
    }
    if (token.row?.tokenProgram === TOKEN_2022_PROGRAM_ID) {
      return slots.use(TOKEN_2022_PROGRAM_ID, "token2022Program", {});
    }

    return slots.use(
      `program:${token.name}`,
      token.param === undefined ? `program${token.stem}` : `${token.param}Program`,
      {},
    );
  };

  const mintAccount = (token: TokenRef): string =>
    slots.use(
      `mint:${token.name}`,
      token.param === undefined ? `mint${token.stem}` : `${token.param}Account`,
      {},
    );

  /** A holder's token account for the mint, and the check that binds it to the holder, if any. */
  const tokenAccount = (
    holder: Holder,
    token: TokenRef,
    writable: boolean,
    spelled: string,
  ): { readonly account: string; readonly holder?: string } => {
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
      const account = slots.use(`self:${token.name}`, `pot${token.stem}`, { writable });

      return { account, holder: `${authority()}.address` };
    }

    return {
      account: slots.use(`${holder.name}:${token.name}`, `${holder.stem}${token.stem}`, {
        writable,
      }),
      holder: holder.value,
    };
  };

  /** Whether a mint is moved by the checked writes: any mint but a registered SPL Token one. */
  const checked = (token: TokenRef): boolean => token.row?.tokenProgram !== TOKEN_PROGRAM_ID;

  /** The checked writes' decimals: the registry's, or the mint's own byte 44. */
  const decimalsOf = (token: TokenRef): string =>
    token.row !== undefined
      ? String(token.row.decimals)
      : `svm.sload(${mintAccount(token)}, 44, 1).toLe()`;

  // -- lowering one call --------------------------------------------------------------------------

  /** A write's arguments, checked against its method's parameters, and its statement. */
  const writeParts = (
    site: MethodCall,
    spelled: string,
  ): { readonly args: readonly AstNode[]; readonly statement: AstNode } => {
    const statement = statements.get(site.call);
    if (statement === undefined) {
      throw new Error(
        `${spelled} returns nothing, so its result cannot be used: a token write reverts the ` +
          "program unless the token program accepted it. Call it as a statement.",
      );
    }
    const args = (site.call as { arguments?: AstNode[] }).arguments ?? [];
    const expected = METHOD_PARAMS[site.method]!;
    if (args.length !== expected.length || args.some((arg) => arg.type === "SpreadElement")) {
      throw new Error(
        `${spelled} takes ${expected.length} arguments (${expected.join(", ")}), got ${args.length}.`,
      );
    }

    return { args, statement };
  };

  /**
   * Replaces a write's call with `call(<prefix>…amount…<suffix>)`, the amount argument left in
   * place so a read inside it is lowered on its own, and puts the checks after its statement — in
   * braces where the statement is a branch's or a loop's body rather than one of a list.
   */
  const spliceWrite = (
    site: MethodCall,
    statement: AstNode,
    amount: AstNode,
    prefix: string,
    suffix: string,
    checks: readonly string[],
  ): void => {
    const wrap = !listed.has(statement);
    const semicolon = source[statement.end - 1] === ";" ? "" : ";";
    const open = wrap ? "{ " : "";
    if (wrap && statement.start !== site.callee.start) {
      splices.push({ start: statement.start, end: statement.start, replacement: open });
    }
    splices.push(
      {
        start: site.callee.start,
        end: amount.start,
        replacement: `${wrap && statement.start === site.callee.start ? open : ""}${prefix}`,
      },
      { start: amount.end, end: site.call.end, replacement: suffix },
    );
    const after = checks.map((check) => ` ${check};`).join("");
    if (after !== "" || wrap) {
      splices.push({
        start: statement.end,
        end: statement.end,
        replacement: `${semicolon}${after}${wrap ? " }" : ""}`,
      });
    }
  };

  const lowerWrite = (site: MethodCall, token: TokenRef, receiver: string): void => {
    const spelled = spelling(receiver, site.method);
    requireInMain(site.call, spelled);
    const { args, statement } = writeParts(site, spelled);
    const program = tokenProgram(token);
    const self = authority();
    const isChecked = checked(token);
    const mint = isChecked ? mintAccount(token) : undefined;
    const decimals = isChecked ? `, ${decimalsOf(token)})` : ")";
    const checks: string[] = [];

    if (site.method === "approve") {
      const [spenderArg, amount] = args as [AstNode, AstNode];
      const source_ = tokenAccount({ kind: "self" }, token, true, spelled).account;
      const spender = holderOf(spenderArg, "spender", spelled);
      let delegate: string;
      if (spender.kind === "account") delegate = spender.param;
      else if (spender.kind === "self") delegate = self;
      else {
        delegate = slots.use(
          spender.name,
          spender.name.startsWith("@") ? `${spender.stem}Account` : "delegate",
          {},
        );
        checks.push(`require(${delegate} == ${spender.value}, "wrong spender account")`);
      }
      const fn: LibraryFunction = isChecked ? "approveChecked" : "approve";
      used.add(fn);
      const accounts = isChecked
        ? [program, source_, mint, delegate, self]
        : [program, source_, delegate, self];
      spliceWrite(
        site,
        statement,
        amount,
        `${local(fn)}(${token.value}, ${accounts.join(", ")}, `,
        decimals,
        checks,
      );
      return;
    }

    const [fromArg, toArg, amount] =
      site.method === "transferFrom"
        ? (args as [AstNode, AstNode, AstNode])
        : ([undefined, ...args] as [undefined, AstNode, AstNode]);
    const from =
      fromArg === undefined
        ? tokenAccount({ kind: "self" }, token, true, spelled)
        : tokenAccount(holderOf(fromArg, "sender", spelled), token, true, spelled);
    const to = tokenAccount(holderOf(toArg, "recipient", spelled), token, true, spelled);
    const fn: LibraryFunction = isChecked
      ? "transferChecked"
      : site.method === "transferFrom"
        ? "transferFrom"
        : "transfer";
    used.add(fn);
    // A transfer from the program's own account needs no sender check: its authority is the signer.
    if (fromArg !== undefined && from.holder !== undefined) {
      checks.push(
        `require(svm.sload(${from.account}, 32, 32).toBe() == ${from.holder}, "wrong sender account")`,
      );
    }
    if (to.holder !== undefined) {
      checks.push(
        `require(svm.sload(${to.account}, 32, 32).toBe() == ${to.holder}, "wrong recipient account")`,
      );
    }
    const accounts = isChecked
      ? [program, from.account, mint, to.account, self]
      : [program, from.account, to.account, self];
    spliceWrite(
      site,
      statement,
      amount,
      `${local(fn)}(${token.value}, ${accounts.join(", ")}, `,
      decimals,
      checks,
    );
  };

  /** A balance read: of a holder's derived account through the checked helper, or of a given one. */
  const balanceText = (token: TokenRef, holder: Holder, spelled: string): string => {
    const account = tokenAccount(holder, token, false, spelled);
    used.add("balanceOf");
    if (account.holder === undefined)
      return `${local("balanceOf")}(${token.value}, ${account.account})`;
    balanceHelper = true;

    return `${BALANCE_HELPER}(${token.value}, ${account.account}, ${account.holder})`;
  };

  const lowerRead = (site: MethodCall, token: TokenRef, receiver: string): void => {
    const spelled = spelling(receiver, site.method);
    requireInMain(site.call, spelled);
    const args = (site.call as { arguments?: AstNode[] }).arguments ?? [];
    if (args.length !== 1 || args[0]!.type === "SpreadElement") {
      throw new Error(`${spelled} takes 1 argument (owner), got ${args.length}.`);
    }
    splices.push({
      start: site.call.start,
      end: site.call.end,
      replacement: balanceText(token, holderOf(args[0]!, "holder", spelled), spelled),
    });
  };

  const lowerMethod = (site: MethodCall, token: TokenRef, receiver: string): void => {
    if (site.method === "balanceOf") lowerRead(site, token, receiver);
    else lowerWrite(site, token, receiver);
  };

  // `<Sym>.<method>(...)`.
  const exclusions = collectValuePositionExclusions(program);
  walk(program, (n) => {
    const site = methodCall(n);
    if (site === undefined || site.object.type !== "Identifier") return;
    const symbol = nameOf(site.object);
    if (!isSymbol(symbol) || !REWRITABLE_METHODS.has(site.method)) return;
    sites.push({ node: n, lower: () => lowerMethod(site, symbolToken(symbol), symbol) });
  });

  // `<holder>.<Sym>`, a balance, in value position.
  walk(program, (n) => {
    if (n.type !== "MemberExpression" || (n as { computed?: boolean }).computed) return;
    if (exclusions.has(n)) return;
    const property = (n as { property?: AstNode }).property;
    if (property?.type !== "Identifier" || !isSymbol(nameOf(property))) return;
    const object = (n as { object?: AstNode }).object!;
    const symbol = nameOf(property);
    // `USDC.WETH` is neither a holder's balance nor anything else, and `Base.USDC` is another
    // chain's token: both are left as they are, as on the EVM.
    if (object.type === "Identifier") {
      const holder = nameOf(object);
      if (tokens.has(holder) || isChainKey(holder) || resolveNamespace(holder) !== undefined)
        return;
    }
    sites.push({
      node: n,
      lower: () => {
        const spelled = `\`${source.slice(n.start, n.end)}\``;
        requireInMain(n, spelled);
        splices.push({
          start: n.start,
          end: n.end,
          replacement: balanceText(
            symbolToken(symbol),
            holderOf(object, "holder", spelled),
            spelled,
          ),
        });
      },
    });
  });

  // `Token(<mint>).<method>(...)`, and `const t = Token(<mint>)` with only `t.<method>(...)`.
  const lowered = new Set<AstNode>();
  const refuse = (what: string): Error =>
    new Error(
      `${what}. On Solana \`${TOKEN_FACTORY_NAME}(mint)\` is supported as the receiver of a call ` +
        `(\`${TOKEN_FACTORY_NAME}(mint).transfer(to, amount)\`) or bound once to a local that is ` +
        `only ever called (\`const t = ${TOKEN_FACTORY_NAME}(mint); t.transfer(to, amount)\`).`,
    );
  if (factoryOwned) {
    walk(program, (n) => {
      const site = methodCall(n);
      if (site === undefined || !factories.has(site.object)) return;
      lowered.add(site.object);
      if (!REWRITABLE_METHODS.has(site.method)) {
        throw refuse(`\`${TOKEN_FACTORY_NAME}(…).${site.method}(…)\` is not a token method`);
      }
      const argument = factoryArgument(site.object);
      const value = source.slice(argument.start, argument.end);
      sites.push({
        node: n,
        lower: () =>
          lowerMethod(site, tokenOfFactory(site.object, value), `${TOKEN_FACTORY_NAME}(${value})`),
      });
    });
    walk(program, (n) => {
      if (n.type !== "VariableDeclarator") return;
      const init = (n as { init?: AstNode | null }).init;
      if (!init || !factories.has(init)) return;
      const id = n.id as AstNode;
      if (id.type !== "Identifier")
        throw refuse(`A \`${TOKEN_FACTORY_NAME}(...)\` is destructured`);
      const name = nameOf(id);
      const argument = factoryArgument(init);
      const calls = bindingCalls(program, n, name, declarations, refuse);
      lowered.add(init);
      sites.push({
        node: init,
        lower: () => {
          const token = tokenOfFactory(init, name);
          splices.push(
            { start: init.start, end: argument.start, replacement: "" },
            { start: argument.end, end: init.end, replacement: "" },
          );
          for (const site of calls) {
            if (!REWRITABLE_METHODS.has(site.method)) {
              throw refuse(`\`${name}.${site.method}(…)\` is not a token method`);
            }
            lowerMethod(site, token, name);
          }
        },
      });
    });
    for (const call of factories) {
      if (!lowered.has(call)) {
        throw refuse(
          `\`${source.slice(call.start, call.end)}\` is used as a value, not called or bound`,
        );
      }
    }
  }

  if (sites.length === 0) return none;
  for (const name of RESERVED) {
    if (declared.has(name)) {
      throw new Error(
        `\`${name}\` is reserved: the token methods on Solana are lowered to @sauce/token's ` +
          `functions under \`__sauce_\` names. Rename your \`${name}\`.`,
      );
    }
  }
  // In source order, so the accounts are named, and added to main, in the order the calls are.
  for (const site of [...sites].sort((a, b) => a.node.start - b.node.start)) site.lower();

  // The accounts, after main's own parameters.
  const mainNode = main!;
  const declaredParams = (mainNode as { params?: AstNode[] }).params ?? [];
  const last = declaredParams[declaredParams.length - 1];
  const open = source.indexOf("(", (mainNode.id as AstNode).end);
  splices.push(
    last === undefined
      ? { start: open + 1, end: open + 1, replacement: slots.params() }
      : { start: last.end, end: last.end, replacement: `, ${slots.params()}` },
  );

  const imports = LIBRARY.filter((fn) => used.has(fn))
    .map((fn) => `${fn} as ${local(fn)}`)
    .join(", ");
  const rewritten = applySplices(source, splices);

  return {
    source: `import { ${imports} } from "@sauce/token";\n${rewritten}${balanceHelper ? BALANCE_HELPER_SOURCE : ""}`,
    rewrote: true,
    derived: slots.derived(),
  };
}

/** Every identifier the program reads or declares, for the cheap "names no token" bail. */
function identifiers(program: AstNode): string[] {
  const names: string[] = [];
  walk(program, (n) => {
    if (n.type === "Identifier") names.push(nameOf(n));
  });

  return names;
}
