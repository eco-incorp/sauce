/**
 * Accounts as expressions in a program compiled for Solana: an account written where it is used,
 * which the SDK adds to `main` as a parameter itself, the way a program on an EVM chain never
 * declares the contracts it calls.
 *
 *   pot                             the Pot, which the program acts with through the Kitchen
 *   Solana.pda(program, [seeds…])   the address `program` derives for the seeds
 *   Solana.account(key)             the account at a key
 *   Solana.owner                    the Pot's owner, who signs the cook
 *   Solana.systemProgram, Solana.tokenProgram, Solana.token2022Program,
 *   Solana.associatedTokenProgram, Solana.memoProgram
 *   USDC.accountOf(holder)          the holder's associated USDC account
 *   USDC.mint, USDC.tokenProgram    the mint, and the token program that owns it
 *
 * Each is read-only, and `.writable()` and `.signer()` give it the role a call needs; one account
 * used several ways takes every role any use gives it, as a Solana transaction does. The same
 * account written twice is one parameter. Each is derived when the cook is built
 * (`svm/account-names.ts`), so what it is made of must be known then: a program, a holder or a seed
 * is a parameter of `main` (an `Address`, or an integer's `.toBytesLe(n)`), a key written out, a
 * string, a token symbol, `pot`, `ctx.self()` or `Solana.owner`. A program builds an account from a
 * value only it knows by taking that account as an `Account` parameter of `main`.
 *
 * `pot` is the Pot's key where a value is wanted (`return pot`, `require(x == pot)`,
 * `const holder = pot`), and its account where one is: with a role (`pot.signer()`), read for a
 * field (`pot.address`, `pot.owner`, `pot.dataLen`), as `svm.call`'s program or one of its
 * accounts, `svm.sload`'s and `svm.sstore`'s account, a local declared `Account`, and an argument
 * a function declares `Account` (the program's own, and `@sauce/token`'s and `@sauce/router`'s).
 * Its balances are the token syntax's (`pot.USDC`, `pot.balance`).
 *
 * What an account expression lowers to is the parameter's name: `svm.call(Solana.systemProgram, …)`
 * becomes `svm.call(systemProgram, …)`, with `systemProgram: Account` added to `main`.
 */
import { walk, type AstNode } from "./ast-walk.js";
import { methodCall } from "./token-rewrite.js";
import {
  annotatedType,
  base58,
  hexKey,
  isCtxSelf,
  keyLiteral,
  libraryAccountParams,
  nameOf,
  type Holder,
  type SvmLowering,
} from "./svm-lowering.js";
import { BALANCE_MEMBER, POT_NAME } from "./pot-sugar.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";

const SOLANA = "Solana";

/** An account a name stands for: its derivation, its parameter's name and what it is. */
interface Known {
  readonly derivation: string;
  readonly base: string;
  readonly account: string;
}

/** The accounts a bare name is, where the program does not declare the name. */
const BARE: Readonly<Record<string, Known>> = {
  [POT_NAME]: {
    derivation: POT_NAME,
    base: POT_NAME,
    account: "the Pot, which the program acts with through the Kitchen",
  },
};

/** The accounts `Solana.<name>` names. */
const KNOWN: Readonly<Record<string, Known>> = {
  owner: { derivation: "owner", base: "owner", account: "the Pot's owner, who signs the cook" },
  systemProgram: {
    derivation: "11111111111111111111111111111111",
    base: "systemProgram",
    account: "the System Program",
  },
  tokenProgram: { derivation: TOKEN_PROGRAM_ID, base: "tokenProgram", account: "SPL Token" },
  token2022Program: {
    derivation: TOKEN_2022_PROGRAM_ID,
    base: "token2022Program",
    account: "Token-2022",
  },
  associatedTokenProgram: {
    derivation: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    base: "associatedTokenProgram",
    account: "the Associated Token Account program",
  },
  memoProgram: {
    derivation: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    base: "memoProgram",
    account: "the Memo program",
  },
};

/** An account's fields, which the language reads off any account. */
const ACCOUNT_FIELDS = new Set(["address", "owner", "dataLen"]);

/** Every member an account has: its fields and its roles. */
export const ACCOUNT_MEMBERS: ReadonlySet<string> = new Set([
  ...ACCOUNT_FIELDS,
  "signer",
  "writable",
]);

/** The program accounts among them, which a program address may name. */
const PROGRAMS = new Set([
  "systemProgram",
  "tokenProgram",
  "token2022Program",
  "associatedTokenProgram",
  "memoProgram",
]);

/** An account expression for a person: what a program writes, the account, how it is derived. */
export interface SvmAccountExpression {
  readonly expression: string;
  readonly account: string;
  readonly derive: string;
}

/** Every account expression, as `sauce globals --chain solana` lists them. */
export const SVM_ACCOUNT_EXPRESSIONS: readonly SvmAccountExpression[] = [
  ...Object.entries(BARE).map(([name, known]) => ({
    expression: name,
    account: known.account,
    derive: known.derivation,
  })),
  {
    expression: "Solana.pda(program, [seeds])",
    account: "the address program derives for the seeds",
    derive: "pda:<program>:<seeds>",
  },
  { expression: "Solana.account(key)", account: "the account at a key", derive: "<key>" },
  ...Object.entries(KNOWN).map(([name, known]) => ({
    expression: `Solana.${name}`,
    account: known.account,
    derive: known.derivation,
  })),
  {
    expression: "<Sym>.accountOf(holder)",
    account: "the holder's associated account for the token",
    derive: "<holder>:<Sym>",
  },
  { expression: "<Sym>.mint", account: "the token's mint", derive: "mint:<Sym>" },
  {
    expression: "<Sym>.tokenProgram",
    account: "the token program that owns the mint",
    derive: "program:<Sym>",
  },
];

/** What `Solana.<name>(…)` takes. */
const CALLS = new Set(["pda", "account"]);
/** What a token's account expressions are. */
const TOKEN_MEMBERS = new Set(["mint", "tokenProgram"]);
const ROLES = new Set(["writable", "signer"]);

/** The account expressions' words, which the cheap "nothing to lower" scan looks for. */
export const ACCOUNT_EXPRESSION_ROOT = SOLANA;

/** An account expression's slot: how it is derived, its parameter's name, and its check. */
interface Described {
  readonly derivation: string;
  readonly base: string;
  /**
   * The statement that holds the account attached to the derivation, given the parameter's name:
   * emitted once at the top of `main`, so a transaction built another way cannot attach another.
   */
  readonly check?: (slot: string) => string;
}

interface Root {
  readonly node: AstNode;
  readonly describe: () => Described;
}

const TOKEN_LIBRARY = "@sauce/token";

/** A name made an identifier stem: `"vault-state"` → `vaultState`. */
function stemOf(text: string): string | undefined {
  const words = text.split(/[^A-Za-z0-9]+/).filter((word) => word !== "");
  if (words.length === 0 || !/^[A-Za-z]/.test(words[0]!)) return undefined;

  return words
    .map(
      (word, i) =>
        (i === 0 ? word.charAt(0).toLowerCase() : word.charAt(0).toUpperCase()) + word.slice(1),
    )
    .join("");
}

/** `Solana`, where the program does not bind a `Solana` of its own. */
const solanaRoot = (l: SvmLowering, node: AstNode | undefined): boolean =>
  node?.type === "Identifier" && nameOf(node) === SOLANA && !l.owns(node, SOLANA);

/** `Solana.<name>`, a member read, and the name. */
function solanaMemberOf(l: SvmLowering, node: AstNode): string | undefined {
  if (node.type !== "MemberExpression" || (node as { computed?: boolean }).computed)
    return undefined;
  const property = node.property as AstNode;
  if (!solanaRoot(l, node.object as AstNode) || property.type !== "Identifier") return undefined;

  return nameOf(property);
}

/**
 * The local `node` reads, where the binding in scope there is one a declarator makes with a value
 * (`lexical-scope.ts`): its declarator.
 */
function localOf(l: SvmLowering, node: AstNode): AstNode | undefined {
  const binder = l.binderOf(node);
  const declarator = binder === undefined ? undefined : l.parents.get(binder);

  return declarator?.type === "VariableDeclarator" &&
    declarator.id === binder &&
    declarator.init !== null &&
    declarator.init !== undefined
    ? declarator
    : undefined;
}

/**
 * Whether a bare name an account stands for (`pot`) is, at `n`, that account rather than its key:
 * with a role (`pot.signer()`), read for a field (`pot.address`), or where an account is wanted
 * (`wantsAccount`).
 */
function standsAsAccount(l: SvmLowering, n: AstNode): boolean {
  const parent = l.parents.get(n);
  if (parent?.type === "MemberExpression" && parent.object === n && parent.computed !== true) {
    const name = nameOf(parent.property as AstNode);
    const call = l.parents.get(parent);
    const called = call?.type === "CallExpression" && call.callee === parent;

    return (ROLES.has(name) && called) || ACCOUNT_FIELDS.has(name);
  }

  return wantsAccount(l, n);
}

/**
 * Whether `node` is an account: a bare name's (`pot`), an account expression (`Solana.pda(…)`,
 * `Solana.owner`, `USDC.accountOf(x)`, `USDC.mint`), `svm.remainingAccount(i)`, an `Account`
 * parameter, or a local bound once to one of them — with any roles chained on it. A local holds
 * what its declared type says, else what its value is lowered to: `const holder = pot` holds the
 * Pot's key. Its `.balance` is its lamports, by its key.
 */
export function isAccountValue(l: SvmLowering, node: AstNode, seen = new Set<AstNode>()): boolean {
  let at = node;
  for (let site = methodCall(at); site !== undefined && ROLES.has(site.method);) {
    at = site.object;
    site = methodCall(at);
  }
  if (l.isPot(at)) return seen.size === 0 || standsAsAccount(l, at);
  if (at.type === "Identifier") {
    if (l.param(at)?.kind === "account") return true;
    const local = localOf(l, at);
    if (local === undefined || seen.has(local)) return false;
    const declared = annotatedType(local.id as AstNode);
    if (declared !== undefined) return declared === "Account";
    seen.add(local);
    return isAccountValue(l, local.init as AstNode, seen);
  }
  const member = solanaMemberOf(l, at);
  if (member !== undefined) return Object.hasOwn(KNOWN, member);
  const site = methodCall(at);
  if (site !== undefined) {
    if (solanaRoot(l, site.object)) return CALLS.has(site.method);
    if (site.object.type === "Identifier" && nameOf(site.object) === "svm") {
      return site.method === "remainingAccount" && !l.declared.has("svm");
    }
    return (
      site.method === "accountOf" &&
      site.object.type === "Identifier" &&
      l.isSymbol(nameOf(site.object), site.object)
    );
  }
  return (
    at.type === "MemberExpression" &&
    (at as { computed?: boolean }).computed !== true &&
    (at.object as AstNode).type === "Identifier" &&
    l.isSymbol(nameOf(at.object as AstNode), at.object as AstNode) &&
    (at.property as AstNode).type === "Identifier" &&
    TOKEN_MEMBERS.has(nameOf(at.property as AstNode))
  );
}

/**
 * Whether `node` is a local bound, by `const`, to the Pot's key: a bare `pot` where a value is
 * wanted (`const holder: Address = pot`), or another such local. Its `.balance` is the lamports at
 * that key, the Pot's, which the cook attaches.
 */
export function isPotKey(l: SvmLowering, node: AstNode, seen = new Set<AstNode>()): boolean {
  if (node.type !== "Identifier") return false;
  const local = localOf(l, node);
  if (local === undefined || seen.has(local)) return false;
  const declaration = l.parents.get(local) as { kind?: string } | undefined;
  if (declaration?.kind !== "const" || annotatedType(local.id as AstNode) === "Account") {
    return false;
  }
  const init = local.init as AstNode;
  seen.add(local);

  return l.isPot(init) ? !standsAsAccount(l, init) : isPotKey(l, init, seen);
}

/**
 * Whether `pot` at `node` stands where an account is wanted: `svm.call`'s program or one of its
 * accounts, `svm.sload`'s or `svm.sstore`'s account, the value of a local declared `Account`, or an
 * argument the function it is passed to declares an `Account` — the program's own top-level
 * function, or one imported from (or ambient in) `@sauce/token` or `@sauce/router`.
 */
function wantsAccount(l: SvmLowering, node: AstNode): boolean {
  const parent = l.parents.get(node);
  if (parent?.type === "VariableDeclarator") {
    return parent.init === node && annotatedType(parent.id as AstNode) === "Account";
  }
  if (parent?.type === "ArrayExpression") {
    const call = l.parents.get(parent);
    if (call?.type !== "CallExpression") return false;
    const site = methodCall(call);
    return (
      site?.method === "call" &&
      site.object.type === "Identifier" &&
      nameOf(site.object) === "svm" &&
      !l.declared.has("svm") &&
      (call.arguments as AstNode[])[1] === parent
    );
  }
  if (parent?.type !== "CallExpression" || parent.callee === node) return false;
  const index = (parent.arguments as AstNode[]).indexOf(node);
  const site = methodCall(parent);
  if (site !== undefined) {
    return (
      site.object.type === "Identifier" &&
      nameOf(site.object) === "svm" &&
      !l.declared.has("svm") &&
      ["call", "sload", "sstore"].includes(site.method) &&
      index === 0
    );
  }
  const callee = parent.callee as AstNode;
  if (callee.type !== "Identifier") return false;
  const name = nameOf(callee);
  const own = l.functionNamed(name);
  if (own !== undefined) {
    const param = ((own as { params?: AstNode[] }).params ?? [])[index];
    return param !== undefined && l.declaredParam(param)?.kind === "account";
  }
  const imported = l.importOf(name);
  const accounts =
    imported !== undefined
      ? libraryAccountParams(imported.module, imported.name)
      : l.declared.has(name)
        ? undefined
        : (libraryAccountParams(TOKEN_LIBRARY, name) ??
          libraryAccountParams("@sauce/router", name));
  return accounts?.[index] === true;
}

/** The account expressions' sites, each lowered to the parameter it adds to `main`. */
export function collectAccountExpressions(l: SvmLowering): void {
  const parents = l.parents;
  const text = (node: AstNode): string => l.source.slice(node.start, node.end);
  const isSolana = (node: AstNode | undefined): boolean => solanaRoot(l, node);
  /** `Solana.<name>`, a member read (not the callee of a call), and the name. */
  const solanaMember = (node: AstNode): string | undefined => solanaMemberOf(l, node);
  let literalAccounts = 0;
  let pdas = 0;

  /** The name of the variable an account expression initializes, its roles given or not. */
  const boundName = (node: AstNode): string | undefined => {
    let at = node;
    for (;;) {
      const member = parents.get(at);
      const call = member === undefined ? undefined : parents.get(member);
      if (
        member?.type !== "MemberExpression" ||
        member.object !== at ||
        call?.type !== "CallExpression" ||
        call.callee !== member ||
        (member.property as AstNode).type !== "Identifier" ||
        !ROLES.has(nameOf(member.property as AstNode))
      ) {
        break;
      }
      at = call;
    }
    const declarator = parents.get(at);
    const id = declarator?.type === "VariableDeclarator" ? (declarator.id as AstNode) : undefined;

    return declarator?.init === at && id?.type === "Identifier" ? nameOf(id) : undefined;
  };

  /**
   * A program address: a parameter of `main` declared `Address`, a key, or a program account; its
   * derivation, and the scalar a program compares it with.
   */
  const programOf = (
    node: AstNode,
    spelled: string,
  ): { readonly derivation: string; readonly value: string } => {
    if (node.type === "Identifier" && l.param(node)?.kind === "address")
      return { derivation: `@${nameOf(node)}`, value: nameOf(node) };
    const key = keyLiteral(node, l.source);
    if (key !== undefined) return { derivation: base58(key), value: key };
    const known = solanaMember(node);
    if (known !== undefined && PROGRAMS.has(known)) {
      return { derivation: KNOWN[known]!.derivation, value: hexKey(KNOWN[known]!.derivation) };
    }
    throw new Error(
      `${spelled} on Solana: the program \`${text(node)}\` must be known when the transaction is ` +
        "built — a parameter of main declared `Address`, a 32-byte key, or a program account " +
        "such as `Solana.tokenProgram`.",
    );
  };

  /** The owner's account, a signer: the owner signs the cook, so no other account can stand in. */
  const ownerKey = (): string => `${l.account("owner", "owner", { signer: true })}.address`;
  /**
   * An account's key as a value of its own, bound once at the top of `main`: a method is called on
   * a name, not on a field.
   */
  const bound = (key: string, local: string): string => {
    l.reserve(local);
    l.prologue(local, `const ${local} = ${key};`);
    return local;
  };
  /** A key's bytes, as a seed. */
  const keyBytes = (hex: string): string => `hex\`${hex.slice(2)}\``;

  /** One seed: as the account language writes it, and as the bytes a program derives with. */
  const seedOf = (
    node: AstNode,
    spelled: string,
  ): { readonly derivation: string; readonly bytes: string } => {
    const refuse = (): Error =>
      new Error(
        `${spelled} on Solana: the seed \`${text(node)}\` must be known when the transaction is ` +
          "built — a string, a parameter of main declared `Address`, an integer parameter's " +
          "`.toBytesLe(n)`, `pot`, `ctx.self()`, `Solana.owner`, a token symbol, a 32-byte key, " +
          "or hex`…`. For an account derived from what only the program knows, take it as an " +
          "`Account` parameter of main.",
      );
    // The account the program acts with: the Pot where the program names it (`pot`).
    const authority = () => ({
      derivation: l.authorityDerivation,
      bytes: `${bound(`${l.authority()}.address`, "__sauce_potKey")}.toBytesBe(32)`,
    });
    const mint = (symbol: string) => {
      const token = l.symbolToken(symbol);
      return {
        derivation: `mint:${token.name}`,
        bytes: keyBytes(`0x${l.tokens.get(symbol)!.toString(16).padStart(64, "0")}`),
      };
    };
    const program = (id: string) => ({ derivation: id, bytes: keyBytes(hexKey(id)) });
    if (node.type === "Literal" && typeof (node as { value?: unknown }).value === "string") {
      const value = (node as unknown as { value: string }).value;
      if (value.includes('"') || value.includes("\\")) throw refuse();
      if (new TextEncoder().encode(value).length > 32) {
        throw new Error(`${spelled} on Solana: the seed "${value}" is over 32 bytes`);
      }
      return { derivation: `"${value}"`, bytes: `"${value}"` };
    }
    if (l.isPot(node) || isCtxSelf(node, l.declared)) return authority();
    if (node.type === "Identifier") {
      const name = nameOf(node);
      if (l.param(node)?.kind === "address") {
        return { derivation: `@${name}`, bytes: `${name}.toBytesBe(32)` };
      }
      if (l.isSymbol(name, node)) return mint(name);
      throw refuse();
    }
    const site = methodCall(node);
    if (site !== undefined && site.method === "toBytesLe") {
      const args = (site.call as { arguments?: AstNode[] }).arguments ?? [];
      const width = args.length === 1 ? Number(text(args[0]!)) : NaN;
      if (![1, 2, 4, 8, 16].includes(width)) {
        throw new Error(
          `${spelled} on Solana: an integer seed takes 1, 2, 4, 8 or 16 bytes, \`${text(node)}\` does not`,
        );
      }
      const of = site.object;
      if (of.type === "Identifier" && l.param(of)?.type === "Uint256") {
        return {
          derivation: `u${width * 8}:@${nameOf(of)}`,
          bytes: `${nameOf(of)}.toBytesLe(${width})`,
        };
      }
      if (of.type === "Literal" && /^(0x[0-9a-fA-F]+|\d+)n?$/.test(text(of))) {
        const value = BigInt(text(of).replace(/n$/, ""));
        if (value >= 1n << BigInt(width * 8)) {
          throw new Error(
            `${spelled} on Solana: ${value} does not fit the seed's ${width} bytes, \`${text(node)}\``,
          );
        }
        const le = [...Array(width).keys()]
          .map((i) =>
            Number((value >> BigInt(8 * i)) & 0xffn)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
        return { derivation: `u${width * 8}:${value}`, bytes: `hex\`${le}\`` };
      }
      throw refuse();
    }
    const member = solanaMember(node);
    if (member === "owner") {
      return {
        derivation: "owner",
        bytes: `${bound(ownerKey(), "__sauce_ownerKey")}.toBytesBe(32)`,
      };
    }
    if (member !== undefined && PROGRAMS.has(member)) return program(KNOWN[member]!.derivation);
    // A token's mint, or the program a registered mint belongs to.
    if (node.type === "MemberExpression" && (node.object as AstNode).type === "Identifier") {
      const object = node.object as AstNode;
      const symbol = nameOf(object);
      const property =
        (node.property as AstNode).type === "Identifier" ? nameOf(node.property as AstNode) : "";
      if (l.isSymbol(symbol, object) && property === "mint") return mint(symbol);
      const id = l.isSymbol(symbol, object) ? l.symbolToken(symbol).row?.tokenProgram : undefined;
      if (property === "tokenProgram" && id !== undefined) return program(id);
    }
    const key = keyLiteral(node, l.source);
    if (key !== undefined) return { derivation: base58(key), bytes: keyBytes(key) };
    if (node.type === "TaggedTemplateExpression") {
      const tag = node.tag as AstNode;
      const quasi = node.quasi as { expressions: AstNode[]; quasis: { value: { raw: string } }[] };
      const raw = quasi.quasis.map((one) => one.value.raw).join("");
      if (
        tag.type === "Identifier" &&
        nameOf(tag) === "hex" &&
        quasi.expressions.length === 0 &&
        /^(?:[0-9a-fA-F]{2})*$/.test(raw)
      ) {
        return { derivation: `0x${raw}`, bytes: `hex\`${raw}\`` };
      }
    }
    throw refuse();
  };

  /**
   * A token's holder for `accountOf`: what the token methods take, or `Solana.owner`. The account
   * attached is held to the holder's: owned by a token program, of the token's mint, and the
   * holder's, as the token methods hold each account they move through.
   */
  const holderAccount = (node: AstNode, symbol: string, spelled: string): Described => {
    const token = l.symbolToken(symbol);
    const checked =
      (holder: () => string) =>
      (slot: string): string =>
        `require(${l.use(TOKEN_LIBRARY, "ownerOf", "__sauce_ownerOf")}(${symbol}, ${slot}) == ` +
        `${holder()}, "wrong holder account");`;
    if (solanaMember(node) === "owner") {
      return {
        derivation: `owner:${token.name}`,
        base: `owner${token.stem}`,
        check: checked(ownerKey),
      };
    }
    const holder: Holder = l.holderOf(node, "holder", spelled);
    if (holder.kind === "account") {
      throw new Error(
        `${spelled} on Solana: \`${holder.param}\` is an account, not a holder's key: pass the ` +
          "holder's key, a parameter of main declared `Address`",
      );
    }
    if (holder.kind === "authority") {
      return {
        derivation: `${l.authorityDerivation}:${token.name}`,
        base: `pot${token.stem}`,
        check: checked(() => `${l.authority()}.address`),
      };
    }

    return {
      derivation: `${holder.name}:${token.name}`,
      base: `${holder.stem}${token.stem}`,
      check: checked(() => holder.value),
    };
  };

  /** A check that the account attached is at `key`, a scalar the program has. */
  const atKey =
    (key: string, reason: string) =>
    (slot: string): string =>
      `require(${slot}.address == ${key}, "${reason}");`;
  let derived = 0;

  // Every account expression, before its role modifiers.
  const roots: Root[] = [];
  /**
   * A bare name an account stands for (`pot`): its account where the program uses it as one
   * (`standsAsAccount`), else its key, `key()`. Its balances (`pot.USDC`, `pot.balance`) are the
   * token syntax's, and a method on it (`pot.toBytesBe(32)`) is its key's.
   */
  const collectBare = (n: AstNode, known: Known, key: () => string): void => {
    if (standsAsAccount(l, n)) {
      roots.push({ node: n, describe: () => ({ derivation: known.derivation, base: known.base }) });
      return;
    }
    const parent = parents.get(n);
    if (parent?.type === "MemberExpression" && parent.object === n && parent.computed !== true) {
      const call = parents.get(parent);
      const called = call?.type === "CallExpression" && call.callee === parent;
      const property = parent.property as AstNode;
      if (l.isBalanceName(nameOf(property), property) || !called) return;
      l.site(n, () => {
        l.requirePlaced(n, `\`${text(parent)}\``, "an account");
        l.splices.push({ start: n.start, end: n.end, replacement: key() });
      });
      return;
    }
    l.site(n, () => {
      l.requirePlaced(n, `\`${text(n)}\``, "an account");
      // `{ pot }` is `{ pot: <key> }`: the key stays the program's own text, so a splice holds
      // only what is read, which a top-level function's threading rewrites (`threadHelpers`).
      const shorthand = parent?.type === "Property" && parent.shorthand === true;
      l.splices.push(
        shorthand
          ? { start: n.end, end: n.end, replacement: `: ${key()}` }
          : { start: n.start, end: n.end, replacement: key() },
      );
    });
  };
  walk(l.program, (n) => {
    const site = methodCall(n);
    if (site !== undefined && isSolana(site.object) && CALLS.has(site.method)) {
      const spelled = `\`Solana.${site.method}(…)\``;
      const args = (n as { arguments?: AstNode[] }).arguments ?? [];
      roots.push({
        node: n,
        describe: () => {
          if (site.method === "account") {
            if (args.length !== 1)
              throw new Error(`${spelled} takes 1 argument (key), got ${args.length}.`);
            const key = args[0]!;
            if (key.type === "Identifier" && l.param(key)?.kind === "address") {
              return {
                derivation: `@${nameOf(key)}`,
                base: `${nameOf(key)}Account`,
                check: atKey(nameOf(key), "wrong account"),
              };
            }
            const literal = keyLiteral(key, l.source);
            if (literal !== undefined) {
              literalAccounts++;
              return {
                derivation: base58(literal),
                base: `account${literalAccounts}`,
                check: atKey(literal, "wrong account"),
              };
            }
            throw new Error(
              `${spelled} on Solana: the key \`${text(key)}\` must be known when the transaction is ` +
                "built — a parameter of main declared `Address`, or a 32-byte key.",
            );
          }
          if (args.length !== 2 || args[1]!.type !== "ArrayExpression") {
            throw new Error(`${spelled} takes 2 arguments (program, [seeds…]).`);
          }
          const seeds = ((args[1] as { elements?: AstNode[] }).elements ?? []).map((seed) =>
            seedOf(seed, spelled),
          );
          if (seeds.length === 0 || seeds.length > 16) {
            throw new Error(`${spelled} on Solana: an address derives from 1 to 16 seeds`);
          }
          // Named for the constant it initializes, else its first string seed.
          const first = seeds.find((seed) => seed.derivation.startsWith('"'));
          const stem =
            boundName(n) ??
            (first === undefined ? undefined : stemOf(first.derivation.slice(1, -1)));
          pdas++;
          const program = programOf(args[0]!, spelled);

          return {
            derivation: `pda:${program.derivation}:${seeds.map((seed) => seed.derivation).join(",")}`,
            base: stem === undefined ? `pda${pdas}` : `${stem}Pda`,
            // The engine derives it again, as the cook did: the program's own canonical address.
            check: (slot) => {
              derived++;
              const found = `__sauce_pda${derived}`;
              const bump = `__sauce_bump${derived}`;
              l.reserve(found);
              l.reserve(bump);
              return (
                `const [${found}, ${bump}] = crypto.findPDA(${program.value}, ` +
                `[${seeds.map((seed) => seed.bytes).join(", ")}]);\n  ` +
                `require(${slot}.address == ${found}, "wrong program-derived address");`
              );
            },
          };
        },
      });
      return;
    }
    if (n.type === "Identifier" && l.isPot(n)) {
      collectBare(n, BARE[POT_NAME]!, () => `${l.pot()}.address`);
      return;
    }
    const member = solanaMember(n);
    if (member !== undefined && !CALLS.has(member)) {
      // `Solana.<chain thing>` that is no account (its `.chain`, say) is left as it is.
      if (!Object.hasOwn(KNOWN, member)) return;
      const parent = parents.get(n);
      if (parent?.type === "CallExpression" && parent.callee === n) return;
      // `Solana.owner.USDC`, `Solana.owner.balance`: the holder of a balance, which the token
      // methods lower whole. Another account's `.balance` is its lamports by its key, read around
      // the account this lowers.
      if (
        parent?.type === "MemberExpression" &&
        parent.object === n &&
        (parent as { computed?: boolean }).computed !== true &&
        (parent.property as AstNode).type === "Identifier" &&
        l.isBalanceName(nameOf(parent.property as AstNode), parent.property as AstNode) &&
        (member === "owner" || nameOf(parent.property as AstNode) !== BALANCE_MEMBER)
      ) {
        return;
      }
      roots.push({
        node: n,
        describe: () => {
          const known = KNOWN[member]!;
          // A program is held to its id. The owner is what the cook attaches, and held by its
          // signature where `.signer()` asks for one.
          return PROGRAMS.has(member)
            ? { ...known, check: atKey(hexKey(known.derivation), "wrong program") }
            : known;
        },
      });
      return;
    }
    if (site !== undefined && site.method === "accountOf" && site.object.type === "Identifier") {
      const symbol = nameOf(site.object);
      if (!l.isSymbol(symbol, site.object)) return;
      const spelled = `\`${symbol}.accountOf(…)\``;
      roots.push({
        node: n,
        describe: () => {
          const args = (n as { arguments?: AstNode[] }).arguments ?? [];
          if (args.length !== 1)
            throw new Error(`${spelled} takes 1 argument (holder), got ${args.length}.`);
          return holderAccount(args[0]!, symbol, spelled);
        },
      });
      return;
    }
    if (n.type === "MemberExpression" && !(n as { computed?: boolean }).computed) {
      const object = n.object as AstNode;
      const property = n.property as AstNode;
      if (object.type !== "Identifier" || property.type !== "Identifier") return;
      if (!l.isSymbol(nameOf(object), object) || !TOKEN_MEMBERS.has(nameOf(property))) return;
      const parent = parents.get(n);
      if (parent?.type === "CallExpression" && parent.callee === n) return;
      const symbol = nameOf(object);
      const token = l.symbolToken(symbol);
      roots.push({
        node: n,
        describe: (): Described => {
          if (nameOf(property) === "mint") {
            return {
              derivation: `mint:${token.name}`,
              base: token.param === undefined ? `mint${token.stem}` : `${token.param}Account`,
              check: atKey(symbol, "wrong mint"),
            };
          }
          const derivation = tokenProgramDerivation(token.row?.tokenProgram, token.name);
          return {
            derivation,
            base: tokenProgramBase(token),
            // A mint the registry does not record is either program's, read as the cook is built.
            check: derivation.startsWith("program:")
              ? (slot) =>
                  `require(${slot}.address == ${hexKey(TOKEN_PROGRAM_ID)} || ` +
                  `${slot}.address == ${hexKey(TOKEN_2022_PROGRAM_ID)}, "wrong program");`
              : atKey(hexKey(derivation), "wrong program"),
          };
        },
      });
    }
  });

  // A root inside another's own expression (a program account naming a `Solana.pda`'s program) is
  // that one's, not an account of its own.
  const outer = roots.filter(
    (root) =>
      !roots.some(
        (other) =>
          other !== root && other.node.start <= root.node.start && root.node.end <= other.node.end,
      ),
  );
  for (const root of outer) {
    // `.writable()` and `.signer()`, as many as are chained on it.
    let top = root.node;
    const role = { writable: false, signer: false };
    for (;;) {
      const member = parents.get(top);
      const call = member === undefined ? undefined : parents.get(member);
      if (
        member?.type !== "MemberExpression" ||
        member.object !== top ||
        (member.property as AstNode).type !== "Identifier" ||
        !ROLES.has(nameOf(member.property as AstNode)) ||
        call?.type !== "CallExpression" ||
        call.callee !== member ||
        ((call as { arguments?: AstNode[] }).arguments ?? []).length !== 0
      ) {
        break;
      }
      role[nameOf(member.property as AstNode) as "writable" | "signer"] = true;
      top = call;
    }
    const spelled = `\`${text(root.node)}\``;
    l.site(top, () => {
      l.requirePlaced(top, spelled, "an account");
      const { derivation, base, check } = root.describe();
      const slot = l.account(derivation, base, role);
      if (check !== undefined) l.prologue(slot, check(slot));
      l.splices.push({ start: top.start, end: top.end, replacement: slot });
    });
  }
}

/** The derivation of a token's program: its id where the registry records it. */
function tokenProgramDerivation(program: string | undefined, name: string): string {
  return program === TOKEN_PROGRAM_ID || program === TOKEN_2022_PROGRAM_ID
    ? program
    : `program:${name}`;
}

/** The name of a token program's parameter, as the token methods name it. */
function tokenProgramBase(token: {
  row?: { tokenProgram: string };
  param?: string;
  stem: string;
}): string {
  if (token.row?.tokenProgram === TOKEN_PROGRAM_ID) return "tokenProgram";
  if (token.row?.tokenProgram === TOKEN_2022_PROGRAM_ID) return "token2022Program";

  return token.param === undefined ? `program${token.stem}` : `${token.param}Program`;
}
