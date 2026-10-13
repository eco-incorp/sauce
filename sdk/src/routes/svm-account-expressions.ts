/**
 * Accounts as expressions in a program compiled for Solana: an account written where it is used,
 * which the SDK adds to `main` as a parameter itself, the way a program on an EVM chain never
 * declares the contracts it calls.
 *
 *   Solana.pda(program, [seeds…])   the address `program` derives for the seeds
 *   Solana.account(key)             the account at a key
 *   Solana.self                     the authority the program acts with: the Pot (the signer cooked
 *                                   directly)
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
 * string, a token symbol, `ctx.self()`/`Solana.self` or `Solana.owner`. A program builds an account
 * from a value only it knows by taking that account as an `Account` parameter of `main`.
 *
 * What an account expression lowers to is the parameter's name: `svm.call(Solana.systemProgram, …)`
 * becomes `svm.call(systemProgram, …)`, with `systemProgram: Account` added to `main`.
 */
import { walk, TYPE_KEYS, type AstNode } from "./ast-walk.js";
import { methodCall } from "./token-rewrite.js";
import { base58, keyLiteral, nameOf, type SvmLowering } from "./svm-lowering.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../svm/token-program.js";

const SOLANA = "Solana";

/** The accounts `Solana.<name>` names, each with its derivation and its parameter's name. */
const KNOWN: Readonly<Record<string, { readonly derivation: string; readonly base: string }>> = {
  self: { derivation: "self", base: "pot" },
  owner: { derivation: "owner", base: "owner" },
  systemProgram: { derivation: "11111111111111111111111111111111", base: "systemProgram" },
  tokenProgram: { derivation: TOKEN_PROGRAM_ID, base: "tokenProgram" },
  token2022Program: { derivation: TOKEN_2022_PROGRAM_ID, base: "token2022Program" },
  associatedTokenProgram: {
    derivation: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    base: "associatedTokenProgram",
  },
  memoProgram: { derivation: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", base: "memoProgram" },
};

/** The program accounts among them, which a program address may name. */
const PROGRAMS = new Set([
  "systemProgram",
  "tokenProgram",
  "token2022Program",
  "associatedTokenProgram",
  "memoProgram",
]);

/** What `Solana.<name>(…)` takes. */
const CALLS = new Set(["pda", "account"]);
/** What a token's account expressions are. */
const TOKEN_MEMBERS = new Set(["mint", "tokenProgram"]);
const ROLES = new Set(["writable", "signer"]);

/** The account expressions' words, which the cheap "nothing to lower" scan looks for. */
export const ACCOUNT_EXPRESSION_ROOT = SOLANA;

interface Root {
  readonly node: AstNode;
  readonly describe: () => { readonly derivation: string; readonly base: string };
}

/** Each node's parent, over the value nodes `walk` visits. */
function parentsOf(program: AstNode): Map<AstNode, AstNode> {
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

/** The account expressions' sites, each lowered to the parameter it adds to `main`. */
export function collectAccountExpressions(l: SvmLowering): void {
  const parents = parentsOf(l.program);
  const text = (node: AstNode): string => l.source.slice(node.start, node.end);
  const solanaOwned = !l.declared.has(SOLANA);
  const isSolana = (node: AstNode | undefined): boolean =>
    solanaOwned && node?.type === "Identifier" && nameOf(node) === SOLANA;
  /** `Solana.<name>`, a member read (not the callee of a call), and the name. */
  const solanaMember = (node: AstNode): string | undefined => {
    if (node.type !== "MemberExpression" || (node as { computed?: boolean }).computed)
      return undefined;
    const property = node.property as AstNode;
    if (!isSolana(node.object as AstNode) || property.type !== "Identifier") return undefined;

    return nameOf(property);
  };
  let literalAccounts = 0;
  let pdas = 0;

  /** A program address: a parameter of `main` declared `Address`, a key, or a program account. */
  const programOf = (node: AstNode, spelled: string): string => {
    if (node.type === "Identifier" && l.param(nameOf(node))?.kind === "address")
      return `@${nameOf(node)}`;
    const key = keyLiteral(node, l.source);
    if (key !== undefined) return base58(key);
    const known = solanaMember(node);
    if (known !== undefined && PROGRAMS.has(known)) return KNOWN[known]!.derivation;
    throw new Error(
      `${spelled} on Solana: the program \`${text(node)}\` must be known when the transaction is ` +
        "built — a parameter of main declared `Address`, a 32-byte key, or a program account " +
        "such as `Solana.tokenProgram`.",
    );
  };

  /** One seed, as the account language writes it. */
  const seedOf = (node: AstNode, spelled: string): string => {
    const refuse = (): Error =>
      new Error(
        `${spelled} on Solana: the seed \`${text(node)}\` must be known when the transaction is ` +
          "built — a string, a parameter of main declared `Address`, an integer parameter's " +
          "`.toBytesLe(n)`, `ctx.self()`, `Solana.owner`, a token symbol, a 32-byte key, or " +
          "hex`…`. For an account derived from what only the program knows, take it as an " +
          "`Account` parameter of main.",
      );
    if (node.type === "Literal" && typeof (node as { value?: unknown }).value === "string") {
      const value = (node as unknown as { value: string }).value;
      if (value.includes('"')) throw refuse();
      if (new TextEncoder().encode(value).length > 32) {
        throw new Error(`${spelled} on Solana: the seed "${value}" is over 32 bytes`);
      }
      return `"${value}"`;
    }
    if (node.type === "Identifier") {
      const name = nameOf(node);
      if (name === "self" && !l.declared.has("self")) return "self";
      if (l.param(name)?.kind === "address") return `@${name}`;
      if (l.isSymbol(name)) return `mint:${l.symbolToken(name).name}`;
      throw refuse();
    }
    const site = methodCall(node);
    if (site !== undefined && site.method === "self" && site.object.type === "Identifier") {
      if (nameOf(site.object) === "ctx" && !l.declared.has("ctx")) return "self";
    }
    if (site !== undefined && site.method === "toBytesLe") {
      const args = (site.call as { arguments?: AstNode[] }).arguments ?? [];
      const width = args.length === 1 ? Number(text(args[0]!)) : NaN;
      if (![1, 2, 4, 8, 16].includes(width)) {
        throw new Error(
          `${spelled} on Solana: an integer seed takes 1, 2, 4, 8 or 16 bytes, \`${text(node)}\` does not`,
        );
      }
      const of = site.object;
      if (of.type === "Identifier" && l.param(nameOf(of))?.type === "Uint256") {
        return `u${width * 8}:@${nameOf(of)}`;
      }
      if (of.type === "Literal" && /^(0x[0-9a-fA-F]+|\d+)n?$/.test(text(of))) {
        return `u${width * 8}:${BigInt(text(of).replace(/n$/, ""))}`;
      }
      throw refuse();
    }
    const member = solanaMember(node);
    if (member === "owner" || member === "self") return member;
    if (member !== undefined && PROGRAMS.has(member)) return KNOWN[member]!.derivation;
    // A token's mint, or the program a registered mint belongs to.
    if (node.type === "MemberExpression" && (node.object as AstNode).type === "Identifier") {
      const symbol = nameOf(node.object as AstNode);
      const property =
        (node.property as AstNode).type === "Identifier" ? nameOf(node.property as AstNode) : "";
      if (l.isSymbol(symbol) && property === "mint") return `mint:${l.symbolToken(symbol).name}`;
      const program = l.isSymbol(symbol) ? l.symbolToken(symbol).row?.tokenProgram : undefined;
      if (property === "tokenProgram" && program !== undefined) return program;
    }
    const key = keyLiteral(node, l.source);
    if (key !== undefined) return base58(key);
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
        return `0x${raw}`;
      }
    }
    throw refuse();
  };

  /** A token's holder for `accountOf`: what the token methods take, or `Solana.owner`. */
  const holderAccount = (
    node: AstNode,
    symbol: string,
    spelled: string,
  ): { readonly derivation: string; readonly base: string } => {
    const token = l.symbolToken(symbol);
    if (solanaMember(node) === "owner") {
      return { derivation: `owner:${token.name}`, base: `owner${token.stem}` };
    }
    const holder = l.holderOf(node, "holder", spelled);
    if (holder.kind === "account") {
      throw new Error(
        `${spelled} on Solana: \`${holder.param}\` is an account, not a holder's key: pass the ` +
          "holder's key, a parameter of main declared `Address`",
      );
    }
    if (holder.kind === "self")
      return { derivation: `self:${token.name}`, base: `pot${token.stem}` };

    return { derivation: `${holder.name}:${token.name}`, base: `${holder.stem}${token.stem}` };
  };

  // Every account expression, before its role modifiers.
  const roots: Root[] = [];
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
            if (key.type === "Identifier" && l.param(nameOf(key))?.kind === "address") {
              return { derivation: `@${nameOf(key)}`, base: `${nameOf(key)}Account` };
            }
            const literal = keyLiteral(key, l.source);
            if (literal !== undefined) {
              literalAccounts++;
              return { derivation: base58(literal), base: `account${literalAccounts}` };
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
          const first = seeds.find((seed) => seed.startsWith('"'));
          const stem = first === undefined ? undefined : stemOf(first.slice(1, -1));
          pdas++;

          return {
            derivation: `pda:${programOf(args[0]!, spelled)}:${seeds.join(",")}`,
            base: stem === undefined ? `pda${pdas}` : `${stem}Pda`,
          };
        },
      });
      return;
    }
    const member = solanaMember(n);
    if (member !== undefined && !CALLS.has(member)) {
      // `Solana.<chain thing>` that is no account (an intent's `.chain`, say) is left as it is.
      if (!Object.hasOwn(KNOWN, member)) return;
      const parent = parents.get(n);
      if (parent?.type === "CallExpression" && parent.callee === n) return;
      roots.push({ node: n, describe: () => KNOWN[member]! });
      return;
    }
    if (site !== undefined && site.method === "accountOf" && site.object.type === "Identifier") {
      const symbol = nameOf(site.object);
      if (!l.isSymbol(symbol)) return;
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
      if (!l.isSymbol(nameOf(object)) || !TOKEN_MEMBERS.has(nameOf(property))) return;
      const parent = parents.get(n);
      if (parent?.type === "CallExpression" && parent.callee === n) return;
      const token = l.symbolToken(nameOf(object));
      roots.push({
        node: n,
        describe: () =>
          nameOf(property) === "mint"
            ? {
                derivation: `mint:${token.name}`,
                base: token.param === undefined ? `mint${token.stem}` : `${token.param}Account`,
              }
            : {
                derivation: tokenProgramDerivation(token.row?.tokenProgram, token.name),
                base: tokenProgramBase(token),
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
      l.requireInMain(top, spelled, "an account");
      const { derivation, base } = root.describe();
      l.splices.push({
        start: top.start,
        end: top.end,
        replacement: l.account(derivation, base, role),
      });
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
