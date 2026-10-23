/**
 * The token syntax on Solana, lowered before the compiler sees it: `USDC.transfer(to, amount)`,
 * `USDC.approve(spender, amount)`, `USDC.transferFrom(from, to, amount)`, `USDC.balanceOf(who)`,
 * `pot.USDC`, `<holder>.balance`, and each of them on `Token(mint)`.
 *
 * On the EVM a token write names addresses and nothing else (`token-rewrite.ts`). On Solana a token
 * program moves tokens between token ACCOUNTS, and every account an instruction touches is one the
 * transaction attaches, which a program declares as an `Account` parameter of `main`. So each call
 * here lowers to `@sauce/token`'s SVM arm, and the accounts it takes are ADDED to `main`, each with
 * how it is derived, written as an `--account` value (`svm/account-names.ts`):
 *
 *   pot                  the Pot, where the program names it (`pot`, `pot.USDC`, …)
 *   authority            else the account that signs the engine call: the Pot through the Kitchen,
 *                        the owner cooked directly
 *   pot:USDC, authority:USDC
 *                        that account's associated token account for the mint
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
 * known then: `pot` (or `ctx.self()`, which as a holder is the account the program acts with, as
 * on the EVM), a parameter of `main` declared `Address` (its argument), or a 32-byte key written
 * out. One computed while the program runs is refused, naming the explicit form: an
 * `Account` parameter of `main` in its place is the token account itself, PAID AS ATTACHED. The
 * call names no holder to check it against, so it is not checked, and whoever builds the
 * transaction chooses it; the skill and the manual say so, and point to an `Address` recipient
 * (`USDC.transfer(dest, amount)` with `dest: Account<Writable>`).
 *
 * THE NATIVE COIN. `<holder>.balance` is the holder's lamports, `ctx.balance` of its key, its
 * account attached: `pot.balance`, an `Address` parameter's, a key's, a mint's (`USDC.balance`), an
 * `Account`'s or an account expression's (`ctx.balance(acct.address)`). A record's or a list's
 * `balance`, and a value's whose type the text does not show, is its field (`readsField`).
 * `<holder>.SOL` is refused, naming `.balance`: SOL is no token Solana registers.
 *
 * The accounts are `main`'s parameters, given to a top-level function that uses one at each call
 * (`SvmLowering.finish`), and a script is given the `main` it runs as (`scriptAsMain`). The explicit
 * forms (`transfer(USDC, tokenProgram, source, dest, authority, amount)` and the rest) are
 * untouched: only the method syntax is lowered, and to those same functions.
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
  isCtxSelf,
  namesAny,
  nameOf,
  scriptAsMain,
  SvmLowering,
  type Holder,
  type SvmLoweringResult,
  type TokenRef,
} from "./svm-lowering.js";
import { collectVenueMethods, isVenueProtocol, unrollPoolKeyLoops } from "./svm-venue-methods.js";
import {
  ACCOUNT_EXPRESSION_ROOT,
  ACCOUNT_MEMBERS,
  collectAccountExpressions,
  isAccountValue,
  isPotKey,
} from "./svm-account-expressions.js";
import { TOKEN_PROGRAM_ID } from "../svm/token-program.js";
import { holderShapes, notAnAddress, readsField, reservedNameError } from "./balance-holder.js";
import {
  BALANCE_MEMBER,
  nativeSymbolRefusal,
  POT_NAME,
  RETIRED_POT_NAME,
  selfRefusal,
} from "./pot-sugar.js";
import { nearMatches } from "./unknown-global.js";

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
 * accounts they need to `main`. `tokens` is the chain's symbol to mint key map (the registry's, with
 * any symbol the caller gave its own mint), and `rows` the registry's mints, whose programs and
 * decimals pick each write. A script with sites is lowered as the `main` it runs as.
 */
export function rewriteSvmTokenSyntax(
  source: string,
  tokens: ReadonlyMap<string, bigint>,
  rows: readonly SvmTokenRow[],
  /** Compile-time values a holder may name, as a key (`SvmLowering`'s `keys`). */
  keys?: ReadonlyMap<string, bigint>,
  /** The chain's native coin, SOL, which `<holder>.SOL` is refused naming `<holder>.balance` for. */
  native?: string,
  /** The swaps at a price to hold to a stop (`SvmLowering`'s `stopped`). */
  stopped?: ReadonlySet<string>,
  /** The names the caller binds: a `pot` or `self` among them is its own (`SvmLowering`'s `bound`). */
  bound?: ReadonlySet<string>,
  /** The token symbols some chain registers and this one lacks (`SvmLowering`'s `absent`). */
  absent?: ReadonlySet<string>,
): SvmTokenRewriteResult {
  // Before parsing: a program that names neither `Token`, a symbol, a venue, the Pot nor a balance
  // has nothing to lower. The scan stops at the first it meets; a mention in a comment only costs
  // the parse.
  if (
    !source.includes(TOKEN_FACTORY_NAME) &&
    !namesAny(
      source,
      (name) =>
        tokens.has(name) ||
        isVenueProtocol(name) ||
        name === ACCOUNT_EXPRESSION_ROOT ||
        name === native ||
        name === POT_NAME ||
        name === RETIRED_POT_NAME ||
        name === BALANCE_MEMBER,
    )
  ) {
    return { source, rewrote: false, derived: {} };
  }
  const lower = (text: string): SvmLowering => {
    const lowering = new SvmLowering(text, tokens, rows, keys, native, stopped, bound, absent);
    refuseRetiredPot(lowering);
    collectTokenMethods(lowering);
    collectVenueMethods(lowering);
    collectAccountExpressions(lowering);
    return lowering;
  };
  let lowering = lower(unrollPoolKeyLoops(source));
  // A script runs as `main(): void`, which has no signature to add the accounts to: give it one.
  const script = lowering.needsMain() ? scriptAsMain(lowering.program, lowering.source) : undefined;
  if (script !== undefined) lowering = lower(script);

  return lowering.finish();
}

/**
 * Refuses the retired spellings of the Pot, each naming what to write: a bare `self` the program
 * does not declare (`self.USDC` → `pot.USDC`, `self.SOL` → `pot.balance`, `self` → `pot`), and
 * `Solana.self` (`Solana.self.signer()` → `pot.signer()`).
 */
function refuseRetiredPot(l: SvmLowering): void {
  /** The expression `node` heads: its members and calls, as far as they go on it. */
  const chain = (node: AstNode): AstNode => {
    let top = node;
    for (;;) {
      const parent = l.parents.get(top);
      if (
        (parent?.type === "MemberExpression" &&
          parent.object === top &&
          parent.computed !== true) ||
        (parent?.type === "CallExpression" && parent.callee === top)
      ) {
        top = parent;
      } else return top;
    }
  };
  const refuse = (node: AstNode): Error => {
    const top = chain(node);
    const rest = l.source.slice(node.end, top.end);
    const native = l.native === undefined ? undefined : `.${l.native}`;
    const instead =
      native !== undefined && rest.startsWith(native) && !/^[\w$]/.test(rest.slice(native.length))
        ? `.${BALANCE_MEMBER}${rest.slice(native.length)}`
        : rest;
    // A shorthand field (`{ self }`) keeps its key, written out.
    const parent = l.parents.get(node);
    const field =
      parent?.type === "Property" && parent.shorthand === true ? `${RETIRED_POT_NAME}: ` : "";
    return selfRefusal(l.source.slice(node.start, top.end), `${field}${POT_NAME}${instead}`);
  };
  const [first] = l.selfReads;
  const solanaSelf: AstNode[] = [];
  walk(l.program, (n) => {
    if (
      n.type === "MemberExpression" &&
      n.computed !== true &&
      (n.object as AstNode).type === "Identifier" &&
      nameOf(n.object as AstNode) === ACCOUNT_EXPRESSION_ROOT &&
      !l.owns(n.object as AstNode, ACCOUNT_EXPRESSION_ROOT) &&
      (n.property as AstNode).type === "Identifier" &&
      nameOf(n.property as AstNode) === RETIRED_POT_NAME
    ) {
      solanaSelf.push(n);
    }
  });
  const earliest = [first, solanaSelf[0]]
    .filter((node): node is AstNode => node !== undefined)
    .sort((a, b) => a.start - b.start)[0];
  if (earliest !== undefined) throw refuse(earliest);
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
    if (wrap && statement.start !== site.call.start) {
      l.splices.push({ start: statement.start, end: statement.start, replacement: open });
    }
    l.spliceCall(
      site,
      amount,
      amount,
      `${wrap && statement.start === site.call.start ? open : ""}${prefix}`,
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
    l.requirePlaced(site.call, spelled);
    const { args, statement } = writeParts(site, spelled);
    const program_ = l.tokenProgram(token);
    const authority = l.authority();
    const isChecked = checked(token);
    const mint = isChecked ? l.mintAccount(token) : undefined;
    const decimals = isChecked ? `, ${decimalsOf(token)})` : ")";
    const checks: string[] = [];

    if (site.method === "approve") {
      const [spenderArg, amount] = args as [AstNode, AstNode];
      const source_ = l.tokenAccount({ kind: "authority" }, token, true, spelled).account;
      const spender = l.holderOf(spenderArg, "spender", spelled);
      let delegate: string;
      if (spender.kind === "account") delegate = spender.param;
      else if (spender.kind === "authority") delegate = authority;
      else {
        delegate = l.account(
          spender.name,
          spender.name.startsWith("@") ? `${spender.stem}Account` : "delegate",
          {},
        );
        checks.push(`require(${delegate} == ${spender.value}, "wrong spender account")`);
      }
      const accounts = isChecked
        ? [program_, source_, mint, delegate, authority]
        : [program_, source_, delegate, authority];
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
        ? l.tokenAccount({ kind: "authority" }, token, true, spelled)
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
      ? [program_, from.account, mint, to.account, authority]
      : [program_, from.account, to.account, authority];
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
    l.requirePlaced(site.call, spelled);
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
    if (!l.isSymbol(symbol, site.object) || !REWRITABLE_METHODS.has(site.method)) return;
    l.site(n, () => lowerMethod(site, l.symbolToken(symbol), symbol));
  });

  /** `Solana.<name>`, a member read, where the program binds no `Solana` of its own. */
  const solanaMember = (node: AstNode): string | undefined =>
    node.type === "MemberExpression" &&
    (node as { computed?: boolean }).computed !== true &&
    (node.object as AstNode).type === "Identifier" &&
    nameOf(node.object as AstNode) === ACCOUNT_EXPRESSION_ROOT &&
    !l.owns(node.object as AstNode, ACCOUNT_EXPRESSION_ROOT) &&
    (node.property as AstNode).type === "Identifier"
      ? nameOf(node.property as AstNode)
      : undefined;
  /** The account the program acts with, as the program names it: `pot`, or `ctx.self()`. */
  const isAuthority = (node: AstNode): boolean => l.isPot(node) || isCtxSelf(node, l.declared);
  /** A balance's holder: what the token methods take, or `Solana.owner`. */
  const balanceHolder = (node: AstNode, spelled: string): Holder => {
    if (solanaMember(node) === "owner") {
      const owner = `${l.account("owner", "owner", { signer: true })}.address`;
      return { kind: "key", name: "owner", stem: "owner", value: owner };
    }
    return l.holderOf(node, "holder", spelled);
  };
  /** The native coin's balance, read at `at`: the lamports of the holder's own account, which the
   *  cook attaches. */
  const nativeText = (holder: Holder, at: AstNode): string => {
    if (holder.kind === "authority") return `ctx.balance(${l.authority()}.address)`;
    if (holder.kind === "key" && l.isSymbol(holder.value, at)) {
      l.mintAccount(l.symbolToken(holder.value));
      return `ctx.balance(${holder.value})`;
    }
    if (holder.kind === "account") return `ctx.balance(${holder.param}.address)`;
    l.account(holder.name, holder.stem === "account" ? "account" : `${holder.stem}Account`, {});
    return `ctx.balance(${holder.value})`;
  };
  const shapes = holderShapes(program);
  /**
   * Whether `node` is a holder of Solana's own, whose `.balance` is its lamports whatever its text's
   * type: the Pot, `ctx.self()`, `Solana.owner`, or an account (an `Account` parameter, an account
   * expression, a local bound to one).
   */
  const solanaHolder = (node: AstNode): boolean =>
    isAuthority(node) || solanaMember(node) === "owner" || isAccountValue(l, node);

  // `<holder>.<Sym>`, `<holder>.balance` and the refused `<holder>.SOL`, in value position.
  walk(program, (n) => {
    if (n.type !== "MemberExpression" || (n as { computed?: boolean }).computed) return;
    if (exclusions.has(n)) return;
    const property = (n as { property?: AstNode }).property;
    if (property?.type !== "Identifier") return;
    const object = (n as { object?: AstNode }).object!;
    const name = nameOf(property);
    const text = source.slice(n.start, n.end);
    const spelled = `\`${text}\``;
    const holderText = source.slice(object.start, object.end);
    // `pot.signer()`, `pot.address` and the rest are its account's, whatever a token is called.
    if (l.isPot(object) && ACCOUNT_MEMBERS.has(name)) return;
    if (!l.isBalanceName(name, property)) {
      // On Solana the Pot has no member but its balances and its account's: say so, rather than
      // leave `pot` to a pass that cannot take it. A method is the value's (`pot.toBytesBe(32)`).
      const parent = l.parents.get(n);
      if (parent?.type === "CallExpression" && parent.callee === n) return;
      if (!isAuthority(object) || (l.isPot(object) && ACCOUNT_MEMBERS.has(name))) return;
      // A token the chain lacks is zero, and its read the compiler's, on the Pot's `ctx.self()` as on
      // the EVM: compiled only where a test of it rules the read out, and refused anywhere else.
      if (l.isAbsentToken(name, property)) {
        if (l.isPot(object)) {
          l.site(n, () =>
            l.splices.push({ start: object.start, end: object.end, replacement: "ctx.self()" }),
          );
        }
        return;
      }
      const near = nearMatches(name, [
        ...l.tokens.keys(),
        BALANCE_MEMBER,
        ...(l.isPot(object) ? ACCOUNT_MEMBERS : []),
      ]);
      throw new Error(
        `${spelled} on Solana: \`${name}\` is not a token solana registers.` +
          (near.length === 0
            ? ""
            : ` Did you mean ${near.map((one) => `\`${one}\``).join(" or ")}?`) +
          ` \`${holderText}.<TOKEN>\` reads the Pot's balance of a token and ` +
          `\`${holderText}.${BALANCE_MEMBER}\` its lamports` +
          (l.isPot(object)
            ? `; \`${POT_NAME}.address\`, \`${POT_NAME}.owner\`, \`${POT_NAME}.dataLen\`, ` +
              `\`${POT_NAME}.signer()\` and \`${POT_NAME}.writable()\` are its account's.`
            : "."),
      );
    }
    // `Base.USDC` is another chain's token, left as it is, as on the EVM. A mint is a holder:
    // `USDC.WSOL` is the WSOL in the USDC mint's own token account, `USDC.balance` the mint's
    // lamports.
    if (object.type === "Identifier") {
      const holder = nameOf(object);
      if (isChainKey(holder) || resolveNamespace(holder) !== undefined) return;
    }
    if (name !== BALANCE_MEMBER && !l.isSymbol(name, property)) {
      // The native coin's symbol, which no token on Solana is: its balance is `.balance`. A record's
      // or a list's field of that name is its own.
      if (!solanaHolder(object) && readsField(object, shapes)) return;
      throw nativeSymbolRefusal(text, name, "solana", `${holderText}.${BALANCE_MEMBER}`);
    }
    if (name === BALANCE_MEMBER) {
      if (l.isPot(object) || isCtxSelf(object, l.declared) || solanaMember(object) === "owner") {
        l.site(n, () => {
          l.requirePlaced(n, spelled, "a balance of the native coin");
          l.splices.push({
            start: n.start,
            end: n.end,
            replacement: nativeText(balanceHolder(object, spelled), object),
          });
        });
        return;
      }
      if (isAccountValue(l, object)) {
        // An account's lamports, by its key: the account expression in it is lowered on its own.
        // The member's own ends, not the receiver's, so parentheses around it go with it.
        l.site(n, () => {
          l.requirePlaced(n, spelled, "a balance of the native coin");
          l.splices.push(
            { start: n.start, end: object.start, replacement: "ctx.balance(" },
            { start: object.end, end: n.end, replacement: ".address)" },
          );
        });
        return;
      }
      if (isPotKey(l, object)) {
        // A local holding the Pot's key: the lamports at it, the Pot's, which the cook attaches.
        l.site(n, () => {
          l.splices.push({ start: n.start, end: n.end, replacement: `ctx.balance(${holderText})` });
        });
        return;
      }
      // A record's, a list's or a value's whose type the text does not show: its own field.
      if (readsField(object, shapes)) return;
      l.site(n, () => {
        l.requirePlaced(n, spelled, "a balance of the native coin");
        l.splices.push({
          start: n.start,
          end: n.end,
          replacement: nativeText(l.holderOf(object, "holder", spelled), object),
        });
      });
      return;
    }
    // A holder of Solana's own is no record, whatever another scope binds its name to.
    const what = solanaHolder(object) ? undefined : notAnAddress(object, shapes);
    if (what !== undefined) throw reservedNameError(spelled, holderText, what, name);
    l.site(n, () => {
      l.requirePlaced(n, spelled, "a token method");
      l.splices.push({
        start: n.start,
        end: n.end,
        replacement: balanceText(l.symbolToken(name), balanceHolder(object, spelled), spelled),
      });
    });
  });

  // `Token(<mint>).<method>(...)`, and `const t = Token(<mint>)` with only `t.<method>(...)`.
  if (l.declared.has(TOKEN_FACTORY_NAME)) return;
  const factories = new Set<AstNode>();
  walk(program, (n) => {
    if (!isFactoryCall(n)) return;
    // A token the chain lacks is zero, the compiler's: used only where a test of it rules it out.
    const [argument, ...rest] = (n as { arguments?: AstNode[] }).arguments ?? [];
    if (
      rest.length === 0 &&
      argument?.type === "Identifier" &&
      l.isAbsentToken(nameOf(argument), argument)
    ) {
      return;
    }
    factories.add(n);
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
