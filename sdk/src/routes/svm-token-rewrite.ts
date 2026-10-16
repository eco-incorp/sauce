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
 * known then: `self` (or `ctx.self()`, which as a holder is the program's own account, the Pot, as
 * on the EVM), a parameter of `main` declared `Address` (its argument), or a 32-byte key written
 * out. One computed while the program runs is refused, naming the explicit form: an
 * `Account` parameter of `main` in its place is the token account itself, PAID AS ATTACHED. The
 * call names no holder to check it against, so it is not checked, and whoever builds the
 * transaction chooses it; the skill and the manual say so, and point to an `Address` recipient
 * (`USDC.transfer(dest, amount)` with `dest: Account<Writable>`).
 *
 * The accounts are `main`'s parameters, so every call stands in `main` itself (a helper has no
 * account parameters), and the program has a `main` (a script has no signature to add them to).
 * The explicit forms (`transfer(USDC, tokenProgram, source, dest, authority, amount)` and the rest)
 * are untouched: only the method syntax is lowered, and to those same functions.
 */
import { isChainKey, resolveNamespace } from "./accessor-index.js";
import { walk, type AstNode } from "./ast-walk.js";
import {
  bindingCalls,
  collectValuePositionExclusions,
  factoryArgument,
  isFactoryCall,
  methodCall,
  REWRITABLE_METHODS,
  TOKEN_FACTORY_NAME,
  type MethodCall,
} from "./token-rewrite.js";
import type { SvmTokenRow } from "./token-registry.js";
import {
  namesAny,
  nameOf,
  SvmLowering,
  type Holder,
  type SvmLoweringResult,
  type TokenRef,
} from "./svm-lowering.js";
import { collectVenueMethods, isVenueProtocol, unrollPoolKeyLoops } from "./svm-venue-methods.js";
import { ACCOUNT_EXPRESSION_ROOT, collectAccountExpressions } from "./svm-account-expressions.js";
import { TOKEN_PROGRAM_ID } from "../svm/token-program.js";

const TOKEN_LIBRARY = "@sauce/token";

/** The `@sauce/token` functions a lowering calls, each imported under its `__sauce_` name. */
type LibraryFunction =
  "balanceOf" | "transfer" | "transferFrom" | "approve" | "transferChecked" | "approveChecked";

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

/** What the method syntax takes: each method's parameters, as the EVM's ERC-20 names them. */
const METHOD_PARAMS: Readonly<Record<string, readonly string[]>> = {
  transfer: ["to", "amount"],
  approve: ["spender", "amount"],
  transferFrom: ["from", "to", "amount"],
  balanceOf: ["owner"],
};

/** The token methods' result: the program lowered, and the accounts it added to `main`. */
export type SvmTokenRewriteResult = SvmLoweringResult;

/**
 * Lowers a program's token syntax, venue namespaces and account expressions for Solana, adding the
 * accounts they need to
 * `main`. `tokens` is the chain's symbol to mint key map (the registry's, with any symbol the caller
 * gave its own mint), and `rows` the registry's mints, whose programs and decimals pick each write.
 */
export function rewriteSvmTokenSyntax(
  source: string,
  tokens: ReadonlyMap<string, bigint>,
  rows: readonly SvmTokenRow[],
  /** Compile-time values a holder may name, as a key (`SvmLowering`'s `keys`). */
  keys?: ReadonlyMap<string, bigint>,
): SvmTokenRewriteResult {
  // Before parsing: a program that names neither `Token`, a symbol nor a venue has nothing to lower.
  // The scan stops at the first it meets; a mention in a comment only costs the parse.
  if (
    !source.includes(TOKEN_FACTORY_NAME) &&
    !namesAny(
      source,
      (name) => tokens.has(name) || isVenueProtocol(name) || name === ACCOUNT_EXPRESSION_ROOT,
    )
  ) {
    return { source, rewrote: false, derived: {} };
  }
  const lowering = new SvmLowering(unrollPoolKeyLoops(source), tokens, rows, keys);
  collectTokenMethods(lowering);
  collectVenueMethods(lowering);
  collectAccountExpressions(lowering);

  return lowering.finish();
}

/** Whether a mint is moved by the checked writes: any mint but a registered SPL Token one. */
const checked = (token: TokenRef): boolean => token.row?.tokenProgram !== TOKEN_PROGRAM_ID;

/** The token methods' sites: `<Sym>.<method>(…)`, `<holder>.<Sym>`, and `Token(<mint>)`'s. */
function collectTokenMethods(l: SvmLowering): void {
  const { program, source } = l;
  const spelling = (receiver: string, method: string): string => `\`${receiver}.${method}(…)\``;
  const fn = (name: LibraryFunction): string => l.use(TOKEN_LIBRARY, name, local(name));

  /** The checked writes' decimals: the registry's, or the mint's own byte 44. */
  const decimalsOf = (token: TokenRef): string =>
    token.row !== undefined
      ? String(token.row.decimals)
      : `svm.sload(${l.mintAccount(token)}, 44, 1).toLe()`;

  /** A write's arguments, checked against its method's parameters, and its statement. */
  const writeParts = (
    site: MethodCall,
    spelled: string,
  ): { readonly args: readonly AstNode[]; readonly statement: AstNode } => {
    const statement = l.statements.get(site.call);
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
    const wrap = !l.listed.has(statement);
    const semicolon = source[statement.end - 1] === ";" ? "" : ";";
    const open = wrap ? "{ " : "";
    if (wrap && statement.start !== site.callee.start) {
      l.splices.push({ start: statement.start, end: statement.start, replacement: open });
    }
    l.spliceCall(
      site,
      amount,
      amount,
      `${wrap && statement.start === site.callee.start ? open : ""}${prefix}`,
      suffix,
    );
    const after = checks.map((check) => ` ${check};`).join("");
    if (after !== "" || wrap) {
      l.splices.push({
        start: statement.end,
        end: statement.end,
        replacement: `${semicolon}${after}${wrap ? " }" : ""}`,
      });
    }
  };

  const lowerWrite = (site: MethodCall, token: TokenRef, receiver: string): void => {
    const spelled = spelling(receiver, site.method);
    l.requireInMain(site.call, spelled);
    const { args, statement } = writeParts(site, spelled);
    const program_ = l.tokenProgram(token);
    const self = l.authority();
    const isChecked = checked(token);
    const mint = isChecked ? l.mintAccount(token) : undefined;
    const decimals = isChecked ? `, ${decimalsOf(token)})` : ")";
    const checks: string[] = [];

    if (site.method === "approve") {
      const [spenderArg, amount] = args as [AstNode, AstNode];
      const source_ = l.tokenAccount({ kind: "self" }, token, true, spelled).account;
      const spender = l.holderOf(spenderArg, "spender", spelled);
      let delegate: string;
      if (spender.kind === "account") delegate = spender.param;
      else if (spender.kind === "self") delegate = self;
      else {
        delegate = l.account(
          spender.name,
          spender.name.startsWith("@") ? `${spender.stem}Account` : "delegate",
          {},
        );
        checks.push(`require(${delegate} == ${spender.value}, "wrong spender account")`);
      }
      const accounts = isChecked
        ? [program_, source_, mint, delegate, self]
        : [program_, source_, delegate, self];
      spliceWrite(
        site,
        statement,
        amount,
        `${fn(isChecked ? "approveChecked" : "approve")}(${token.value}, ${accounts.join(", ")}, `,
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
        ? l.tokenAccount({ kind: "self" }, token, true, spelled)
        : l.tokenAccount(l.holderOf(fromArg, "sender", spelled), token, true, spelled);
    const to = l.tokenAccount(l.holderOf(toArg, "recipient", spelled), token, true, spelled);
    const write: LibraryFunction = isChecked
      ? "transferChecked"
      : site.method === "transferFrom"
        ? "transferFrom"
        : "transfer";
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
      ? [program_, from.account, mint, to.account, self]
      : [program_, from.account, to.account, self];
    spliceWrite(
      site,
      statement,
      amount,
      `${fn(write)}(${token.value}, ${accounts.join(", ")}, `,
      decimals,
      checks,
    );
  };

  /** A balance read: of a holder's derived account through the checked helper, or of a given one. */
  const balanceText = (token: TokenRef, holder: Holder, spelled: string): string => {
    const account = l.tokenAccount(holder, token, false, spelled);
    const read = fn("balanceOf");
    if (account.holder === undefined) return `${read}(${token.value}, ${account.account})`;
    l.helper(BALANCE_HELPER, BALANCE_HELPER_SOURCE);

    return `${BALANCE_HELPER}(${token.value}, ${account.account}, ${account.holder})`;
  };

  const lowerRead = (site: MethodCall, token: TokenRef, receiver: string): void => {
    const spelled = spelling(receiver, site.method);
    l.requireInMain(site.call, spelled);
    const args = (site.call as { arguments?: AstNode[] }).arguments ?? [];
    if (args.length !== 1 || args[0]!.type === "SpreadElement") {
      throw new Error(`${spelled} takes 1 argument (owner), got ${args.length}.`);
    }
    l.splices.push({
      start: site.call.start,
      end: site.call.end,
      replacement: balanceText(token, l.holderOf(args[0]!, "holder", spelled), spelled),
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
    if (!l.isSymbol(symbol) || !REWRITABLE_METHODS.has(site.method)) return;
    l.site(n, () => lowerMethod(site, l.symbolToken(symbol), symbol));
  });

  // `<holder>.<Sym>`, a balance, in value position.
  walk(program, (n) => {
    if (n.type !== "MemberExpression" || (n as { computed?: boolean }).computed) return;
    if (exclusions.has(n)) return;
    const property = (n as { property?: AstNode }).property;
    if (property?.type !== "Identifier" || !l.isSymbol(nameOf(property))) return;
    const object = (n as { object?: AstNode }).object!;
    const symbol = nameOf(property);
    // `USDC.WETH` is neither a holder's balance nor anything else, and `Base.USDC` is another
    // chain's token: both are left as they are, as on the EVM.
    if (object.type === "Identifier") {
      const holder = nameOf(object);
      if (l.tokens.has(holder) || isChainKey(holder) || resolveNamespace(holder) !== undefined)
        return;
    }
    l.site(n, () => {
      const spelled = `\`${source.slice(n.start, n.end)}\``;
      l.requireInMain(n, spelled);
      l.splices.push({
        start: n.start,
        end: n.end,
        replacement: balanceText(
          l.symbolToken(symbol),
          l.holderOf(object, "holder", spelled),
          spelled,
        ),
      });
    });
  });

  // `Token(<mint>).<method>(...)`, and `const t = Token(<mint>)` with only `t.<method>(...)`.
  if (l.declared.has(TOKEN_FACTORY_NAME)) return;
  const factories = new Set<AstNode>();
  walk(program, (n) => {
    if (isFactoryCall(n)) factories.add(n);
  });
  const tokenOfFactory = (call: AstNode, value: string): TokenRef => {
    const argument = factoryArgument(call);

    return l.tokenOf(
      argument,
      value,
      `${TOKEN_FACTORY_NAME}(${source.slice(argument.start, argument.end)})`,
    );
  };
  const lowered = new Set<AstNode>();
  const refuse = (what: string): Error =>
    new Error(
      `${what}. On Solana \`${TOKEN_FACTORY_NAME}(mint)\` is supported as the receiver of a call ` +
        `(\`${TOKEN_FACTORY_NAME}(mint).transfer(to, amount)\`) or bound once to a local that is ` +
        `only ever called (\`const t = ${TOKEN_FACTORY_NAME}(mint); t.transfer(to, amount)\`).`,
    );
  walk(program, (n) => {
    const site = methodCall(n);
    if (site === undefined || !factories.has(site.object)) return;
    lowered.add(site.object);
    if (!REWRITABLE_METHODS.has(site.method)) {
      throw refuse(`\`${TOKEN_FACTORY_NAME}(…).${site.method}(…)\` is not a token method`);
    }
    const argument = factoryArgument(site.object);
    const value = source.slice(argument.start, argument.end);
    l.site(n, () =>
      lowerMethod(site, tokenOfFactory(site.object, value), `${TOKEN_FACTORY_NAME}(${value})`),
    );
  });
  walk(program, (n) => {
    if (n.type !== "VariableDeclarator") return;
    const init = (n as { init?: AstNode | null }).init;
    if (!init || !factories.has(init)) return;
    const id = n.id as AstNode;
    if (id.type !== "Identifier") throw refuse(`A \`${TOKEN_FACTORY_NAME}(...)\` is destructured`);
    const name = nameOf(id);
    const argument = factoryArgument(init);
    const calls = bindingCalls(program, n, name, l.declarations, refuse);
    lowered.add(init);
    l.site(init, () => {
      const token = tokenOfFactory(init, name);
      l.splices.push(
        { start: init.start, end: argument.start, replacement: "" },
        { start: argument.end, end: init.end, replacement: "" },
      );
      for (const site of calls) {
        if (!REWRITABLE_METHODS.has(site.method)) {
          throw refuse(`\`${name}.${site.method}(…)\` is not a token method`);
        }
        lowerMethod(site, token, name);
      }
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
