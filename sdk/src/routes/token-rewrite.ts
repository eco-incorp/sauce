/**
 * ERC-20 token syntax in a route body, lowered before the compiler sees it.
 *
 * Two passes, each one parse (`parse.ts`) and one reverse-ordered textual splice over its input:
 *
 *   `rewriteTokenMembers` — a registry token SYMBOL:
 *     writes (call position):  `<Sym>.transfer/.approve/.transferFrom(...)` -> `@sauce/token`'s function
 *     read (call position):    `<Sym>.balanceOf(...)`                       -> `IERC20.at(<Sym>).balanceOf(...)`
 *     sugar (value position):  `<holder>.<Sym>`                             -> `IERC20.at(<Sym>).balanceOf(<holder>)`
 *                              `<holder>.balance`, the native coin          -> `ctx.selfBalance()`, `ctx.balance(<holder>)`
 *
 *   `rewriteTokenFactory` — the `Token(<addr>)` wrapper, for any address:
 *     `Token(<addr>).<write>(...)`, and `t.<write>(...)` on `const t = Token(<addr>)` -> `@sauce/token`
 *     `Token(<addr>).<read>(...)`, and `t.<read>(...)` likewise                    -> `IERC20.at(...)`
 *
 * EVERY WRITE IS OPENZEPPELIN `SafeERC20`. A write lowers to the `@sauce/token` library function
 * of the same name, with the token moved to the front: `USDC.transfer(to, amount)` becomes
 * `transfer(USDC, to, amount)`. That function is the SDK's one implementation of a token write —
 * empty returndata accepted only from an address with code, anything else decoded as a word that
 * must equal 1, and `approve` as `forceApprove` (see `std/token/token.evm.js`). The typed
 * `IERC20.at(t).transfer(...)` this used to emit decodes the ABI's declared `bool`, so it reverted
 * the whole program on a token that returns nothing (USDT) and accepted one that returns `false`.
 * The reads keep the typed binding: a `uint256` is always returned, so there is nothing to check.
 *
 * The library is imported under the names in `SAFE_WRITES` (`import { transfer as
 * __sauce_transfer } from "@sauce/token"`), never its own, so a program that declares its own
 * `transfer` keeps it. `tokenImportLines` renders the imports a rewrite needs; the caller prepends
 * them, because both passes run over one source and must share one import block. `@sauce/token`
 * resolves inside the SDK (`embedded/resolve.ts`), so no caller resolver has to serve it.
 *
 * An explicit `IERC20.at(addr).transfer(...)` is NOT this syntax and is left alone: it is the raw
 * ABI call, the escape hatch for a caller who wants exactly that, and it is not `SafeERC20`.
 *
 * RECOGNITION IS DISJOINT BY CONSTRUCTION, not by priority ordering: a symbol write or read needs
 * `<Sym>` as the member chain's HEAD with a REWRITABLE_METHODS member under a CALL parent; the
 * balance sugar needs `<Sym>` (or `balance`) as the MEMBER with a non-call, non-lvalue parent and a
 * HOLDER as the object. A token symbol can never satisfy both shapes for the same node, so the site
 * lists never overlap. `USDC.balanceOf(x)` is the read's (and `token-registry.ts`'s module-eval
 * guard -- no registry symbol may equal a REWRITABLE_METHODS name -- keeps that permanent); `x.USDC`
 * is the sugar's, and so is `USDC.WETH`: the WETH the USDC contract holds.
 *
 * `.<Sym>` is always a registered token, even where the chain's native coin has the same symbol
 * (Arc's USDC); the native coin is `.balance`. Its old spelling, `<holder>.<native symbol>`, is
 * refused where it read a holder's coin, naming `.balance` (`pot-sugar.ts`). `.balance` is not
 * reserved: on a value that may have a field of that name (`balance-holder.ts#readsField`) it stays
 * the field.
 *
 * Shadowing-aware on the TOKEN name: where the program binds the name (`let`/`const`, a parameter,
 * an import, ...) in scope at a site, as the compiler scopes it (`lexical-scope.ts`), the site is
 * left un-rewritten: a user who declares `USDC` owns the name there. `Token` is whole-program
 * (`rewriteTokenFactory`). The sugar's HOLDER name is deliberately NOT shadow-checked -- a local
 * variable IS the intended holder -- but for `pot`, which is the Pot (`ctx.self()`) where the
 * program declares no `pot` in scope: `const pot = ctx.self(); pot.USDC` reads the local. `self`,
 * the Pot's old name, is refused where the program declares no `self`.
 *
 * A symbol method outside REWRITABLE_METHODS is left untouched and fails closed at compile. A `Token(...)` call in any position this module cannot lower is REFUSED with an
 * error naming the spellings that work — never passed through as the typed binding, which would
 * quietly be the unchecked write again.
 */
import {
  walk,
  collectDeclaredNames,
  collectPatternNames,
  countDeclarations,
  type AstNode,
} from "./ast-walk.js";
import { shadowed as shadowedAt, walkScoped, type Scope } from "./lexical-scope.js";
import { formatBigint } from "../deposit/format.js";
import { ERC20_IMPORT_LINE } from "../token/evm.js";
import { isChainKey, namedContractKind, resolveNamespace } from "./accessor-index.js";
import {
  holderShapes,
  notAnAddress,
  readsField,
  reservedNameError,
  type HolderShapes,
} from "./balance-holder.js";
import {
  BALANCE_MEMBER,
  nativeSymbolRefusal,
  POT_NAME,
  RETIRED_POT_NAME,
  selfRefusal,
} from "./pot-sugar.js";
import { decomposeMemberChain } from "./protocol-rewrite.js";
import { parseSauce } from "./parse.js";
import { blankLiterals } from "./rs-compile.js";

/**
 * The ERC-20 writes the token syntax offers: each lowers to the `@sauce/token` function of the same
 * name, imported under `local`, with the token as its first argument ahead of `params`.
 */
export const SAFE_WRITES = {
  transfer: { local: "__sauce_transfer", params: ["to", "amount"] },
  approve: { local: "__sauce_approve", params: ["spender", "amount"] },
  transferFrom: { local: "__sauce_transferFrom", params: ["from", "to", "amount"] },
} as const satisfies Record<string, { local: string; params: readonly string[] }>;

export type SafeWrite = keyof typeof SAFE_WRITES;

/** Every method the SYMBOL syntax lowers: the writes, plus the one read it has always offered. */
export const REWRITABLE_METHODS: ReadonlySet<string> = new Set([
  "transfer",
  "approve",
  "transferFrom",
  "balanceOf",
]);

const isSafeWrite = (method: string): method is SafeWrite => Object.hasOwn(SAFE_WRITES, method);

/** The package every write is lowered to. */
const STD_TOKEN = "@sauce/token";

/** What a rewritten source now needs imported. */
export interface TokenImports {
  /** The `@sauce/token` writes it calls, under their `SAFE_WRITES` names. */
  readonly writes: ReadonlySet<SafeWrite>;
  /** Whether it names the typed `IERC20` binding, which the reads keep. */
  readonly erc20: boolean;
}

/**
 * The import lines a rewritten source needs, for the caller to prepend. The order is fixed, so a
 * given program always gets the same text and so the same bytecode.
 */
export function tokenImportLines({ writes, erc20 }: TokenImports): readonly string[] {
  const lines: string[] = [];
  if (erc20) lines.push(ERC20_IMPORT_LINE);
  const used = (Object.keys(SAFE_WRITES) as SafeWrite[]).filter((write) => writes.has(write));
  if (used.length > 0) {
    const names = used.map((write) => `${write} as ${SAFE_WRITES[write].local}`).join(", ");
    lines.push(`import { ${names} } from "${STD_TOKEN}";`);
  }

  return lines;
}

/** The token symbols the rewrites recognise: the registry-resolved `symbol -> address` map, or a
 *  bare set of symbols. Every rewrite emits the symbol itself, which the compile's defines resolve,
 *  so the two forms rewrite alike. */
export type TokenSymbols = ReadonlyMap<string, bigint> | ReadonlySet<string>;

export interface TokenRewriteResult extends TokenImports {
  readonly source: string;
  /** True if at least one site was rewritten -- tells the caller to prepend `tokenImportLines`. */
  readonly rewrote: boolean;
  /** Count of `<Sym>.<method>(...)` call sites rewritten. */
  readonly memberSites: number;
  /** Count of `<holder>.<Sym>` balance-sugar sites rewritten. */
  readonly balanceSites: number;
}

export interface Splice {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/** Splice from the end backward so earlier offsets stay valid. The ranges never overlap: a write
 *  only replaces the text BEFORE its first argument, so a site nested inside the arguments is
 *  spliced independently. */
export function applySplices(source: string, splices: readonly Splice[]): string {
  let out = source;
  for (const site of [...splices].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, site.start) + site.replacement + out.slice(site.end);
  }

  return out;
}

/** A child node the node's type guarantees is there (`id` on a declarator, `left` on an
 *  assignment, ...). */
function child(node: AstNode, key: string): AstNode {
  return node[key] as AstNode;
}

/** A `<object>.<method>(...)` call, taken apart. */
export interface MethodCall {
  readonly call: AstNode;
  readonly callee: AstNode;
  readonly object: AstNode;
  readonly method: string;
}

/** `<object>.<method>(...)`, non-computed and non-optional, or `undefined` for any other node. */
export function methodCall(node: AstNode): MethodCall | undefined {
  if (node.type !== "CallExpression" || (node as { optional?: boolean }).optional) return undefined;
  const callee = (node as { callee?: AstNode }).callee;
  if (!callee || callee.type !== "MemberExpression") return undefined;
  if ((callee as { computed?: boolean }).computed) return undefined;
  if ((callee as { optional?: boolean }).optional) return undefined;
  const object = (callee as { object?: AstNode }).object;
  const property = (callee as { property?: AstNode }).property;
  if (!object || property?.type !== "Identifier") return undefined;

  return {
    call: node,
    callee,
    object,
    method: (property as unknown as { name: string }).name,
  };
}

/**
 * `node`, an argument of `call`, with the parentheses around it, which the parser leaves out of its
 * range, and never the call's own. `code` is the source with its comments blanked
 * (`blankLiterals`), so none is read as a parenthesis.
 */
export function argumentRange(
  code: string,
  call: AstNode,
  node: AstNode,
): { readonly start: number; readonly end: number } {
  const opens: number[] = [];
  for (let i = node.start - 1; i >= 0 && /[\s(]/.test(code[i]!); i--) {
    if (code[i] === "(") opens.push(i);
  }
  // Before the call's first argument, the furthest is the call's own.
  if (((call as { arguments?: AstNode[] }).arguments ?? [])[0] === node) opens.pop();
  let end = node.end;
  // Up to the call's own closing parenthesis, its last character.
  for (let i = node.end; i < call.end - 1 && /[\s)]/.test(code[i]!); i++) {
    if (code[i] === ")") end = i + 1;
  }

  return { start: opens.at(-1) ?? node.start, end };
}

/** Every call that is a whole statement on its own — the only place a write can stand. */
export function statementCalls(program: AstNode): ReadonlySet<AstNode> {
  const calls = new Set<AstNode>();
  walk(program, (n) => {
    if (n.type === "ExpressionStatement") calls.add(child(n, "expression"));
  });

  return calls;
}

/**
 * A write's arguments, checked against the ERC-20 signature so a wrong count is reported in the
 * terms the caller wrote rather than as the library function's arity.
 *
 * Also refuses a write whose result is read. The typed call returned the ABI's `bool`; a SafeERC20
 * write returns nothing, because it reverts the program unless the token accepted it — there is no
 * `false` left to report. Left to the compiler, this would fail on a `: void` function the caller
 * never wrote.
 */
function writeArguments(
  call: AstNode,
  method: SafeWrite,
  receiver: string,
  statements: ReadonlySet<AstNode>,
): readonly AstNode[] {
  const spelling = `\`${receiver}.${method}(...)\``;
  if (!statements.has(call)) {
    throw new Error(
      `${spelling} returns nothing, so its result cannot be used: a token write has SafeERC20 ` +
        "semantics and reverts the program unless the token accepted it. Call it as a statement.",
    );
  }
  const args = (call as { arguments?: AstNode[] }).arguments ?? [];
  const { params } = SAFE_WRITES[method];
  if (args.length !== params.length || args.some((arg) => arg.type === "SpreadElement")) {
    throw new Error(
      `${spelling} takes ${params.length} arguments (${params.join(", ")}), got ${args.length}.`,
    );
  }

  return args;
}

/** A name the lowering imports under is the SDK's; a program that declares it cannot also get it. */
function assertLocalsFree(declared: ReadonlySet<string>, writes: ReadonlySet<SafeWrite>): void {
  for (const write of writes) {
    const { local } = SAFE_WRITES[write];
    if (declared.has(local)) {
      throw new Error(
        `\`${local}\` is reserved: a token's \`.${write}(...)\` is lowered to \`${STD_TOKEN}\`'s ` +
          `\`${write}\`, imported under that name. Rename your \`${local}\`.`,
      );
    }
  }
}

/**
 * `<receiver>.<write>(a, b)` -> `<local>(<receiver>, a, b)`, for a receiver that is a name: from the
 * call's own start, which a parenthesized callee's parentheses are inside, to its first argument
 * with its own (`argumentRange`). `code` is the source blanked.
 */
function nameWriteSplice(
  site: MethodCall,
  name: string,
  statements: ReadonlySet<AstNode>,
  code: string,
): Splice {
  const method = site.method as SafeWrite;
  const [first] = writeArguments(site.call, method, name, statements);

  return {
    start: site.call.start,
    end: argumentRange(code, site.call, first!).start,
    replacement: `${SAFE_WRITES[method].local}(${name}, `,
  };
}

// -- <Sym>.<method>(...) in CALL position --------------------------------------------------------

/** The symbol call sites, split by what they lower to: `writes` records each `@sauce/token` write
 *  used, and `reads` counts the sites left on the typed `IERC20` binding. */
function collectMemberCallSites(
  program: AstNode,
  tokens: TokenSymbols,
  writes: Set<SafeWrite>,
  source: string,
): { sites: Splice[]; reads: number } {
  const sites: Splice[] = [];
  const statements = statementCalls(program);
  let code: string | undefined;
  let reads = 0;
  walkScoped(program, (n, here) => {
    const site = methodCall(n);
    if (!site || site.object.type !== "Identifier") return;
    const symbol = (site.object as unknown as { name: string }).name;
    if (!tokens.has(symbol)) return;
    if (shadowedAt(here, symbol, site.object.start)) return;
    if (!REWRITABLE_METHODS.has(site.method)) return;
    if (isSafeWrite(site.method)) {
      sites.push(nameWriteSplice(site, symbol, statements, (code ??= blankLiterals(source))));
      writes.add(site.method);
      return;
    }
    sites.push({
      start: site.callee.start,
      end: site.callee.end,
      replacement: `IERC20.at(${symbol}).${site.method}`,
    });
    reads++;
  });
  return { sites, reads };
}

// -- balance sugar: <holder>.<Sym> in VALUE position -----------------------------------------------

const HEX_ADDRESS_LITERAL_RE = /^0x[0-9a-fA-F]{40}n?$/;

/** By node identity: every node that must never be claimed as a balance-sugar candidate because it
 *  sits in one of the five excluded parent roles -- a call/new callee, the object of an outer member
 *  chain, anywhere inside an assignment's left-hand subtree, or an update expression's operand. */
export function collectValuePositionExclusions(program: AstNode): ReadonlySet<AstNode> {
  const excluded = new Set<AstNode>();
  walk(program, (n) => {
    if (n.type === "CallExpression" || n.type === "NewExpression") {
      const callee = (n as { callee?: AstNode }).callee;
      if (callee) excluded.add(callee);
    }
    if (n.type === "MemberExpression") {
      const object = (n as { object?: AstNode }).object;
      if (object) excluded.add(object);
    }
    if (n.type === "AssignmentExpression") {
      const left = (n as { left?: AstNode }).left;
      if (left) walk(left, (m) => excluded.add(m));
    }
    if (n.type === "UpdateExpression") {
      const argument = (n as { argument?: AstNode }).argument;
      if (argument) excluded.add(argument);
    }
  });
  return excluded;
}

/** A balance read's holder, as the rewrite emits it. */
type Holder =
  /** The Pot: `pot`, while the program declares no `pot` of its own, or `ctx.self()`. */
  | { readonly kind: "pot" }
  /** An address written out, in the exact value of its raw text. */
  | { readonly kind: "literal"; readonly value: string }
  /** Any other address-valued expression, left in place for the passes after this one. */
  | { readonly kind: "expression"; readonly node: AstNode };

/** A contract bound to an address — `X.at(a)`, `X.view(a)`, `X.lib(a)` — whose address is the
 *  holder: the balance is `a`'s. */
const BINDINGS: ReadonlySet<string> = new Set(["at", "view", "lib"]);

/** What a holder resolution reads besides the node: the program's names and the rewrite's. */
interface HolderScope {
  readonly tokens: TokenSymbols;
  readonly shadowed: ReadonlySet<string>;
  /** The names the compile binds beside the source (a define, a contract binding, an ambient
   *  module's export): a `pot` or `self` among them is the caller's value, never the Pot. */
  readonly bound: ReadonlySet<string>;
  /** The names the program's imports bind, and of them those an ABI (a `.json` module) gives. */
  readonly imported: ReadonlySet<string>;
  readonly abis: ReadonlySet<string>;
  /** The names the program binds to a value: a local, a parameter, a function. */
  readonly values: ReadonlySet<string>;
  readonly shapes: HolderShapes;
  readonly source: string;
}

/** `ctx.self()`, with `ctx` the language's. */
function isCtxSelf(node: AstNode, shadowed: ReadonlySet<string>): boolean {
  const site = methodCall(node);

  return (
    site !== undefined &&
    site.method === "self" &&
    site.object.type === "Identifier" &&
    (site.object as unknown as { name: string }).name === "ctx" &&
    !shadowed.has("ctx") &&
    ((node as { arguments?: AstNode[] }).arguments ?? []).length === 0
  );
}

/**
 * Whether `node` names a contract type, whose `.at(…)`, `.view(…)` and `.lib(…)` bind it to an
 * address: a registry contract or interface (`UniswapV3.Pool`, `Base.UniswapV3.Factory`), an ABI
 * imported from a `.json` module, or a name the program does not declare (a caller's `contracts`
 * binding, a declared `interface`). A value is not one — a bound contract, a call's result, or any
 * name the program binds to a value, an import of the same name included — and keeping its call
 * whole is the safe side: a contract type kept whole is refused by the compile, never miscompiled.
 */
function isContractType(node: AstNode, scope: HolderScope): boolean {
  if (node.type === "Identifier") {
    const name = (node as unknown as { name: string }).name;
    // A name the program binds to a value anywhere — a local, a parameter, a function — is that
    // value, an import of the same name shadowed; an import is a contract type only from an ABI.
    if (scope.values.has(name)) return false;
    return scope.imported.has(name) ? scope.abis.has(name) : true;
  }
  const chain = decomposeMemberChain(node);
  return (
    chain !== undefined &&
    registryRoot(chain.head, scope.shadowed) &&
    namedContractKind(chain.head, chain.path) !== undefined
  );
}

/** A registry root the program has not declared itself: a chain key or a protocol namespace. */
function registryRoot(name: string, shadowed: ReadonlySet<string>): boolean {
  return !shadowed.has(name) && (isChainKey(name) || resolveNamespace(name) !== undefined);
}

/** `pot` or `self` as `node` reads it where neither the program (in scope there) nor the compile
 *  binds it: the Pot, or its retired name. Decided before any holder shape, which is by name and
 *  whole-program: a helper's own `pot` record is not this one. */
function freePotName(
  node: AstNode,
  scope: HolderScope,
  here: Scope | undefined,
): string | undefined {
  if (node.type !== "Identifier") return undefined;
  const name = (node as unknown as { name: string }).name;
  return (name === POT_NAME || name === RETIRED_POT_NAME) &&
    !shadowedAt(here, name, node.start) &&
    !scope.bound.has(name)
    ? name
    : undefined;
}

/**
 * The holder in `<holder>.<name>`, or `undefined` where the member is not the shorthand's to read:
 * a chain's or a protocol's own member (`Base.USDC`, `Maker.Dai`), which the accessor pass owns,
 * and, for `balance`, a field (`readsField`: a record's, or a contract call's result's).
 * Any address-valued holder takes it — `pot`, `ctx.self()`, a variable, an address written out, a
 * protocol contract (`UniswapV4.PoolManager`), a contract bound to an address (`X.at(a)`, whose
 * address is the holder), a call that returns an address, a token's own contract (`WETH.balance`).
 * Refused, by name: `self` (the Pot is `pot`), an interface that has no address, and, for a token,
 * a holder the program says is a record or a list.
 */
function resolveHolder(
  member: AstNode,
  name: string,
  kind: "token" | "balance",
  scope: HolderScope,
  /** The names the program declares where `member` is read. */
  here: Scope | undefined,
): Holder | undefined {
  const object = member.object as AstNode;
  const spelled = `\`${scope.source.slice(member.start, member.end)}\``;
  const text = scope.source.slice(object.start, object.end);
  const refuse = (why: string): Error => new Error(`${spelled}: ${why}`);
  const free = freePotName(object, scope, here);
  if (free === RETIRED_POT_NAME) {
    throw selfRefusal(
      scope.source.slice(member.start, member.end),
      `${POT_NAME}.${kind === "token" ? name : BALANCE_MEMBER}`,
    );
  }
  if (free === POT_NAME) return { kind: "pot" };
  const what = notAnAddress(object, scope.shapes);
  if (what !== undefined) {
    if (kind === "balance") return undefined;
    throw reservedNameError(spelled, text, what, name);
  }
  // A value whose type the text does not show may be a struct with a field of the name.
  const field = kind === "balance" && readsField(object, scope.shapes);
  switch (object.type) {
    case "Identifier": {
      const holder = (object as unknown as { name: string }).name;
      // Reserved defensively -- no longer a compiler namespace root (address.* was dropped for
      // gated ctx.*), but a bare `address` holder is still excluded rather than re-opened.
      if (holder === "address" && !scope.shadowed.has("address")) return undefined;
      if (registryRoot(holder, scope.shadowed)) return undefined;
      if (field) return undefined;
      // A token's own contract is a holder like any other: `WETH.balance` is the ETH the WETH
      // contract holds, `USDC.WETH` the WETH the USDC contract does. The symbol is its address's define.
      return { kind: "expression", node: object };
    }
    case "Literal": {
      const raw = scope.source.slice(object.start, object.end);
      if (!HEX_ADDRESS_LITERAL_RE.test(raw)) {
        throw refuse(`a balance's holder is an address, and \`${raw}\` is not one.`);
      }
      // Read from the literal's own RAW source text, never `.value` -- a 20-byte hex literal's
      // `.value` is a lossy float64 round-trip (the same literal.raw-vs-Number() trap this repo's
      // CLAUDE.md documents for the compiler's own const-eval fix).
      return { kind: "literal", value: formatBigint(BigInt(raw.replace(/n$/, ""))) };
    }
    case "MemberExpression": {
      const chain = decomposeMemberChain(object);
      if (chain === undefined || !registryRoot(chain.head, scope.shadowed)) {
        // `p.to.balance`: a field of a record whose declaration types it, else what `field` says.
        return field ? undefined : { kind: "expression", node: object };
      }
      // `<Ns>.<Contract>` or `<Chain>.<Ns>.<Contract>`: a contract's address, which the accessor
      // pass resolves (or refuses: an ambiguous alias, a contract not on the chain). A bare
      // namespace or a chain's token is the accessor pass's own member, and so is a contract the
      // registry names by the whole path, `balance` included.
      const segments = isChainKey(chain.head) ? chain.path : [chain.head, ...chain.path];
      if (segments.length < 2) return undefined;
      if (namedContractKind(chain.head, [...chain.path, name]) !== undefined) return undefined;
      if (namedContractKind(chain.head, chain.path) === "interface") {
        throw refuse(
          `\`${text}\` is an interface, with no address of its own: give it the address, ` +
            `\`${text}(<address>).${name}\`.`,
        );
      }
      return { kind: "expression", node: object };
    }
    case "CallExpression": {
      if (isCtxSelf(object, scope.shadowed)) return { kind: "pot" };
      const args = (object as { arguments?: AstNode[] }).arguments ?? [];
      const callee = object.callee as AstNode;
      const site = methodCall(object);
      // `X.at(<address>)` binds a contract to an address only where `X` is a contract type; on a
      // contract already bound, `.at(…)` is one of its own methods, whose result is the holder.
      const bound =
        site !== undefined && BINDINGS.has(site.method)
          ? isContractType(site.object, scope)
          : (() => {
              // `<Ns>.<Interface>(<address>)`, the same binding as `.at(<address>)`.
              const chain = decomposeMemberChain(callee);
              return (
                chain !== undefined &&
                registryRoot(chain.head, scope.shadowed) &&
                namedContractKind(chain.head, chain.path) === "interface"
              );
            })();
      if (bound && args.length === 1 && args[0]!.type !== "SpreadElement") {
        return { kind: "expression", node: args[0]! };
      }
      if (field) return undefined;
      return { kind: "expression", node: object };
    }
    default:
      return field ? undefined : { kind: "expression", node: object };
  }
}

/** The chain's native coin, whose old spelling `<holder>.<symbol>` is refused, naming `.balance`. */
export interface NativeCoin {
  readonly symbol: string;
  /** The chain's slug, for a message. */
  readonly chain: string;
}

/** The splices a balance read lowers to, `before` its holder and `after` it, or all of it. */
function balanceSplices(
  member: AstNode,
  holder: Holder,
  read: (holder: string) => string,
): Splice[] {
  if (holder.kind !== "expression") {
    return [
      {
        start: member.start,
        end: member.end,
        replacement: read(holder.kind === "pot" ? "ctx.self()" : holder.value),
      },
    ];
  }
  // The holder stays where it is, so a read inside it is lowered on its own.
  const [before, after] = read("\u0000").split("\u0000") as [string, string];

  return [
    { start: member.start, end: holder.node.start, replacement: before },
    { start: holder.node.end, end: member.end, replacement: after },
  ];
}

function collectBalanceSites(
  program: AstNode,
  tokens: TokenSymbols,
  shadowed: ReadonlySet<string>,
  bound: ReadonlySet<string>,
  excluded: ReadonlySet<AstNode>,
  source: string,
  native: NativeCoin | undefined,
): { readonly sites: Splice[]; readonly count: number; readonly tokenReads: number } {
  const sites: Splice[] = [];
  let count = 0;
  let tokenReads = 0;
  // Each import's local names, and how many times each name is imported: a name bound more often
  // than that is bound to a value too.
  const imported = new Map<string, number>();
  const abis = new Set<string>();
  walk(program, (n) => {
    if (n.type !== "ImportDeclaration") return;
    const from = (n.source as { value?: unknown } | undefined)?.value;
    for (const specifier of (n as { specifiers?: AstNode[] }).specifiers ?? []) {
      collectPatternNames(specifier.local, {
        add: (name: string) => {
          imported.set(name, (imported.get(name) ?? 0) + 1);
          if (typeof from === "string" && from.endsWith(".json")) abis.add(name);
        },
      });
    }
  });
  const values = new Set(
    [...countDeclarations(program)]
      .filter(([name, count]) => count > (imported.get(name) ?? 0))
      .map(([name]) => name),
  );
  const scope: HolderScope = {
    tokens,
    shadowed,
    bound,
    imported: new Set(imported.keys()),
    abis,
    values,
    shapes: holderShapes(program),
    source,
  };
  walkScoped(program, (n, here) => {
    if (n.type !== "MemberExpression") return;
    if ((n as { computed?: boolean }).computed) return;
    if (excluded.has(n)) return;
    const property = (n as { property?: AstNode }).property;
    if (!property || property.type !== "Identifier") return;
    const name = (property as unknown as { name: string }).name;
    const site = source.slice(n.start, n.end);
    // `.<SYMBOL>` is always a registered token: on Arc, whose native coin is USDC, `pot.USDC` is the
    // token, and the coin is `pot.balance`.
    if (tokens.has(name)) {
      if (shadowedAt(here, name, n.start)) return;
      const holder = resolveHolder(n, name, "token", scope, here);
      if (holder === undefined) return;
      // The symbol, not its address: exactly what `<Sym>.balanceOf(<holder>)` lowers to, so the two
      // spellings are one program under any value the compile gives the symbol, a define included.
      sites.push(...balanceSplices(n, holder, (at) => `IERC20.at(${name}).balanceOf(${at})`));
      count++;
      tokenReads++;
      return;
    }
    // A member, never a name the program binds: `const balance = …` leaves `pot.balance` alone.
    if (name === BALANCE_MEMBER) {
      const holder = resolveHolder(n, name, "balance", scope, here);
      if (holder === undefined) return;
      // The Pot's native balance is the executing contract's own; any other holder's is read at it.
      sites.push(
        ...(holder.kind === "pot"
          ? [{ start: n.start, end: n.end, replacement: "ctx.selfBalance()" }]
          : balanceSplices(n, holder, (at) => `ctx.balance(${at})`)),
      );
      count++;
      return;
    }
    // `<holder>.ETH`, the native coin's old spelling, refused where a holder's balance was read:
    // on a record or a list it is the field it says.
    if (native === undefined || name !== native.symbol || shadowedAt(here, name, n.start)) return;
    const object = n.object as AstNode;
    const free = freePotName(object, scope, here) !== undefined;
    if (!free && notAnAddress(object, scope.shapes) !== undefined) return;
    const balance = resolveHolder(n, name, "balance", scope, here);
    if (balance === undefined && resolveHolder(n, name, "token", scope, here) === undefined) {
      return;
    }
    // The holder as written, its parentheses with it: `(c ? a : b).ETH` is `(c ? a : b).balance`.
    const holder = source.slice(n.start, (n.property as AstNode).start).replace(/\s*\??\.\s*$/, "");
    throw nativeSymbolRefusal(
      site,
      name,
      native.chain,
      balance === undefined
        ? `ctx.balance(${holder})`
        : `${balance.kind === "pot" ? POT_NAME : holder}.${BALANCE_MEMBER}`,
    );
  });
  return { sites, count, tokenReads };
}

// -- Token(addr): the wrapper, in call-receiver and binding position ------------------------------

/** The DSL's global token WRAPPER name. */
export const TOKEN_FACTORY_NAME = "Token";

export interface TokenFactoryResult extends TokenImports {
  readonly source: string;
  readonly rewrote: boolean;
  /** Count of `Token(...)` calls rewritten. */
  readonly sites: number;
}

export function isFactoryCall(node: AstNode): boolean {
  if (node.type !== "CallExpression" || (node as { optional?: boolean }).optional) return false;
  const callee = (node as { callee?: AstNode }).callee;

  return (
    callee?.type === "Identifier" &&
    (callee as unknown as { name: string }).name === TOKEN_FACTORY_NAME
  );
}

/** The single address argument of a `Token(...)` call. */
export function factoryArgument(call: AstNode): AstNode {
  const args = (call as { arguments?: AstNode[] }).arguments ?? [];
  if (args.length !== 1 || args[0]!.type === "SpreadElement") {
    throw new Error(
      `\`${TOKEN_FACTORY_NAME}(...)\` takes one argument, the token's address; got ${args.length}.`,
    );
  }

  return args[0]!;
}

/** The refusal for a `Token(...)` this module cannot lower, naming the spellings that work. */
function refuseFactory(what: string): Error {
  return new Error(
    `${what}. \`${TOKEN_FACTORY_NAME}(addr)\` is supported as the receiver of a call ` +
      `(\`${TOKEN_FACTORY_NAME}(addr).transfer(to, amount)\`) or bound once to a local that is only ` +
      `ever called (\`const t = ${TOKEN_FACTORY_NAME}(addr); t.approve(spender, amount)\`). Those, ` +
      `\`<SYMBOL>.transfer(...)\` and \`${STD_TOKEN}\`'s \`transfer(token, to, amount)\` are the ` +
      "token writes with SafeERC20 semantics; `IERC20.at(addr).transfer(...)` is the raw, " +
      "unchecked ABI call.",
  );
}

/**
 * The `t.<method>(...)` calls of `const t = Token(...)`, or a refusal when `t` is anything other
 * than one binding used only that way.
 *
 * The conditions are what make replacing the binding's VALUE with the address sound: declared
 * exactly once in the whole program (so every `t` is this `t`), never assigned, and never read
 * except as a call receiver (so nothing sees the value change from a contract binding to an
 * address). Whole-program, like the shadow rule, rather than scope-exact: over-refusing is an error
 * a caller can act on, while under-refusing would lower a call on some other `t`.
 */
export function bindingCalls(
  program: AstNode,
  declarator: AstNode,
  name: string,
  declarations: ReadonlyMap<string, number>,
  refuse: (what: string) => Error = refuseFactory,
): ReadonlyArray<MethodCall> {
  const at = `\`${name} = ${TOKEN_FACTORY_NAME}(...)\``;
  if ((declarations.get(name) ?? 0) !== 1) {
    throw refuse(`${at}: \`${name}\` is declared more than once`);
  }

  const receivers = new Map<AstNode, MethodCall>();
  // Identifiers that are a NAME rather than a read of the variable: the declaration itself, a
  // member property (`x.t`), and a non-shorthand object key (`{ t: 1 }`).
  const names = new Set<AstNode>([child(declarator, "id")]);
  const assigned = new Set<AstNode>();
  walk(program, (n) => {
    const site = methodCall(n);
    if (site?.object.type === "Identifier" && (site.object as { name?: string }).name === name) {
      receivers.set(site.object, site);
    }
    if (n.type === "MemberExpression" && !(n as { computed?: boolean }).computed) {
      names.add(child(n, "property"));
    }
    if (n.type === "Property") {
      const { computed, shorthand } = n as { computed?: boolean; shorthand?: boolean };
      if (!computed && !shorthand) names.add(child(n, "key"));
    }
    if (n.type === "AssignmentExpression") walk(child(n, "left"), (m) => assigned.add(m));
    if (n.type === "UpdateExpression") assigned.add(child(n, "argument"));
  });

  walk(program, (n) => {
    if (n.type !== "Identifier" || (n as unknown as { name: string }).name !== name) return;
    if (names.has(n) || receivers.has(n)) return;
    throw refuse(
      assigned.has(n)
        ? `${at}: \`${name}\` is reassigned`
        : `${at}: \`${name}\` is used other than as \`${name}.<method>(...)\``,
    );
  });

  return [...receivers.values()];
}

/**
 * Lowers every `Token(<expr>)` — the DSL's global token WRAPPER, the any-address sibling of the
 * symbol syntax above. It fires on ANY argument (a literal, a variable, an ambient `USDC` define),
 * so it does not depend on the token-symbol map and works on every EVM chain.
 *
 * Two positions are lowered, and the compiler never sees a method call on a `Token(...)` result
 * (which its M1 subset rejects):
 *
 *  - `Token(a).<write>(x, y)` -> `<local>(a, x, y)`, the `@sauce/token` write; `Token(a).<read>(x)`
 *    -> `IERC20.at(a).<read>(x)`.
 *  - `const t = Token(a)` -> `const t = a`, with each `t.<method>(...)` lowered the same way, by
 *    name. The binding now holds the ADDRESS, evaluated once where it was, so a later change to
 *    whatever `a` read cannot reach the calls. See `bindingCalls` for when a binding qualifies.
 *
 * Any other `Token(...)` — an argument, a return value, a reassigned or passed-around binding — is
 * refused rather than left as the typed binding, which would be the unchecked write again.
 *
 * Shadow-safe: a user who binds `Token` anywhere in the program owns the name, and EVERY
 * `Token(...)` is then left untouched — the same whole-program rule the symbol rewrite applies,
 * covering every binding form, `import { Token }` and `class Token` included.
 */
export function rewriteTokenFactory(source: string): TokenFactoryResult {
  const none: TokenFactoryResult = {
    source,
    rewrote: false,
    sites: 0,
    writes: new Set(),
    erc20: false,
  };
  // Cheap bail before parsing: no `Token` token, nothing to do (a mention in a comment/string still
  // parses, but that is rare and the parse is cheap).
  if (!source.includes(TOKEN_FACTORY_NAME)) return none;
  const program = parseSauce(source);
  const declarations = countDeclarations(program);
  if (declarations.has(TOKEN_FACTORY_NAME)) return none;

  const factories = new Set<AstNode>();
  walk(program, (n) => {
    if (isFactoryCall(n)) factories.add(n);
  });
  if (factories.size === 0) return none;

  const splices: Splice[] = [];
  const writes = new Set<SafeWrite>();
  let erc20 = false;
  const lowered = new Set<AstNode>();
  const statements = statementCalls(program);
  const code = blankLiterals(source);

  // `Token(a).<method>(...)`.
  walk(program, (n) => {
    const site = methodCall(n);
    if (!site || !factories.has(site.object)) return;
    const address = factoryArgument(site.object);
    lowered.add(site.object);
    if (isSafeWrite(site.method)) {
      const [first] = writeArguments(
        site.call,
        site.method,
        `${TOKEN_FACTORY_NAME}(...)`,
        statements,
      );
      // `Token(` -> `<local>(` and `).<method>(` -> `, `, leaving the address and the arguments in
      // place so a rewrite inside either splices on its own: from the call's own start, which a
      // parenthesized callee's parentheses are inside, and to the first argument with its own.
      splices.push(
        {
          start: site.call.start,
          end: address.start,
          replacement: `${SAFE_WRITES[site.method].local}(`,
        },
        {
          start: address.end,
          end: argumentRange(code, site.call, first!).start,
          replacement: ", ",
        },
      );
      writes.add(site.method);
      return;
    }
    const callee = child(site.object, "callee");
    splices.push({ start: callee.start, end: callee.end, replacement: "IERC20.at" });
    erc20 = true;
  });

  // `const t = Token(a)`, then only `t.<method>(...)`.
  walk(program, (n) => {
    if (n.type !== "VariableDeclarator") return;
    const init = (n as { init?: AstNode | null }).init;
    if (!init || !factories.has(init)) return;
    const id = child(n, "id");
    if (id.type !== "Identifier") {
      throw refuseFactory(`A \`${TOKEN_FACTORY_NAME}(...)\` is destructured`);
    }
    const name = (id as unknown as { name: string }).name;
    const address = factoryArgument(init);
    const calls = bindingCalls(program, n, name, declarations);
    lowered.add(init);
    splices.push(
      { start: init.start, end: address.start, replacement: "" },
      { start: address.end, end: init.end, replacement: "" },
    );
    for (const site of calls) {
      if (isSafeWrite(site.method)) {
        splices.push(nameWriteSplice(site, name, statements, code));
        writes.add(site.method);
        continue;
      }
      splices.push({
        start: site.object.start,
        end: site.object.end,
        replacement: `IERC20.at(${name})`,
      });
      erc20 = true;
    }
  });

  for (const call of factories) {
    if (!lowered.has(call)) {
      throw refuseFactory(
        `\`${source.slice(call.start, call.end)}\` is used as a value, not called or bound`,
      );
    }
  }
  assertLocalsFree(new Set(declarations.keys()), writes);

  return {
    source: applySplices(source, splices),
    rewrote: true,
    sites: factories.size,
    writes,
    erc20,
  };
}

/**
 * Rewrites every `<Sym>.<method>(...)` call and every `<holder>.<Sym>` value-position read whose
 * `<Sym>` is in `tokens` (and not shadowed anywhere in `source`) — see the module doc for the
 * lowering and the disjointness argument. Purely textual surgery over the ORIGINAL source, driven by
 * parser ranges — never a re-print of the AST, so everything else (formatting, comments, unrelated
 * code) survives byte-for-byte. Prepend `tokenImportLines(result)` before compiling the result.
 * `bound` names what the compile binds beside the source (a define, a contract binding, an ambient
 * module's export): a `pot` or `self` among them is an ordinary holder, never the Pot.
 */
export function rewriteTokenMembers(
  source: string,
  tokens: TokenSymbols,
  native?: NativeCoin,
  bound: ReadonlySet<string> = new Set(),
): TokenRewriteResult {
  const none: TokenRewriteResult = {
    source,
    rewrote: false,
    memberSites: 0,
    balanceSites: 0,
    writes: new Set(),
    erc20: false,
  };
  if (tokens.size === 0 && native === undefined) return none;

  const program = parseSauce(source);
  const shadowed = collectDeclaredNames(program);

  const writes = new Set<SafeWrite>();
  const members = collectMemberCallSites(program, tokens, writes, source);
  const exclusions = collectValuePositionExclusions(program);
  const balances = collectBalanceSites(
    program,
    tokens,
    shadowed,
    bound,
    exclusions,
    source,
    native,
  );

  const allSites = [...members.sites, ...balances.sites];
  if (allSites.length === 0) return none;
  assertLocalsFree(shadowed, writes);

  return {
    source: applySplices(source, allSites),
    rewrote: true,
    memberSites: members.sites.length,
    balanceSites: balances.count,
    writes,
    // A symbol read and a token balance both name the typed binding; a write does not.
    erc20: members.reads > 0 || balances.tokenReads > 0,
  };
}
