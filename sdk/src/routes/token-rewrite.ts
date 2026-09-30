/**
 * ERC-20 token syntax in a route body, lowered before the compiler sees it.
 *
 * Two passes, each one acorn parse and one reverse-ordered textual splice over its input:
 *
 *   `rewriteTokenMembers` — a registry token SYMBOL:
 *     writes (call position):  `<Sym>.transfer/.approve/.transferFrom(...)` -> `@sauce/token`'s function
 *     read (call position):    `<Sym>.balanceOf(...)`                       -> `IERC20.at(<Sym>).balanceOf(...)`
 *     sugar (value position):  `<holder>.<Sym>`                             -> `IERC20.at(<addr>n).balanceOf(<holder>)`
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
 * balance sugar needs `<Sym>` as the MEMBER with a non-call, non-lvalue parent and an authorized
 * HOLDER as the object. A token symbol can never satisfy both shapes for the same node, so the site
 * lists never overlap. `USDC.balanceOf(x)` is the read's (and `token-registry.ts`'s module-eval
 * guard -- no registry symbol may equal a REWRITABLE_METHODS name -- keeps that permanent);
 * `x.USDC` is the sugar's; `USDC.WETH` is neither's (left untouched -- see the holder rule below).
 *
 * Shadowing-aware, CONSERVATIVELY, on the TOKEN name only: if a name anywhere in the WHOLE program
 * is bound (`let`/`const`, a parameter, an import, ...), EVERY occurrence of it is left un-rewritten,
 * rather than re-deriving the compiler's own scoping rules. A user who declares `USDC` or `Token`
 * owns the name. The sugar's HOLDER name is deliberately NOT shadow-checked -- a local variable IS
 * the intended holder.
 *
 * A symbol method outside REWRITABLE_METHODS, or an unresolvable holder, is left untouched and fails
 * closed at compile. A `Token(...)` call in any position this module cannot lower is REFUSED with an
 * error naming the spellings that work — never passed through as the typed binding, which would
 * quietly be the unchecked write again.
 */
import * as acorn from "acorn";
import { walk, collectDeclaredNames, countDeclarations, type AstNode } from "./ast-walk.js";
import { formatBigint } from "../deposit/format.js";
import { ERC20_IMPORT_LINE } from "../token/evm.js";
import { isChainKey, resolveNamespace } from "./accessor-index.js";

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

/** Either the full registry-resolved `symbol -> address` map (enables every rewrite), or a bare set
 *  of symbols with no addresses (the call-position rewrites only -- the sugar has no address to
 *  inline, so it yields no sites). */
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

interface Splice {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

/** Splice from the end backward so earlier offsets stay valid. The ranges never overlap: a write
 *  only replaces the text BEFORE its first argument, so a site nested inside the arguments is
 *  spliced independently. */
function applySplices(source: string, splices: readonly Splice[]): string {
  let out = source;
  for (const site of [...splices].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, site.start) + site.replacement + out.slice(site.end);
  }

  return out;
}

function parse(source: string): AstNode {
  // sourceType "module": a source may already carry its own `import` lines.
  return acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" }) as unknown as AstNode;
}

/** A child node the node's type guarantees is there (`id` on a declarator, `left` on an
 *  assignment, ...). */
function child(node: AstNode, key: string): AstNode {
  return node[key] as AstNode;
}

function tokenAddressOf(tokens: TokenSymbols, symbol: string): bigint | undefined {
  return tokens instanceof Map ? tokens.get(symbol) : undefined;
}

/** A `<object>.<method>(...)` call, taken apart. */
interface MethodCall {
  readonly call: AstNode;
  readonly callee: AstNode;
  readonly object: AstNode;
  readonly method: string;
}

/** `<object>.<method>(...)`, non-computed and non-optional, or `undefined` for any other node. */
function methodCall(node: AstNode): MethodCall | undefined {
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

/** Every call that is a whole statement on its own — the only place a write can stand. */
function statementCalls(program: AstNode): ReadonlySet<AstNode> {
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

/** `<receiver>.<write>(a, b)` -> `<local>(<receiver>, a, b)`, for a receiver that is a name. */
function nameWriteSplice(site: MethodCall, name: string, statements: ReadonlySet<AstNode>): Splice {
  const method = site.method as SafeWrite;
  const [first] = writeArguments(site.call, method, name, statements);

  return {
    start: site.callee.start,
    end: first!.start,
    replacement: `${SAFE_WRITES[method].local}(${name}, `,
  };
}

// -- <Sym>.<method>(...) in CALL position --------------------------------------------------------

/** The symbol call sites, split by what they lower to: `writes` records each `@sauce/token` write
 *  used, and `reads` counts the sites left on the typed `IERC20` binding. */
function collectMemberCallSites(
  program: AstNode,
  tokens: TokenSymbols,
  shadowed: ReadonlySet<string>,
  writes: Set<SafeWrite>,
): { sites: Splice[]; reads: number } {
  const sites: Splice[] = [];
  const statements = statementCalls(program);
  let reads = 0;
  walk(program, (n) => {
    const site = methodCall(n);
    if (!site || site.object.type !== "Identifier") return;
    const symbol = (site.object as unknown as { name: string }).name;
    if (!tokens.has(symbol)) return;
    if (shadowed.has(symbol)) return;
    if (!REWRITABLE_METHODS.has(site.method)) return;
    if (isSafeWrite(site.method)) {
      sites.push(nameWriteSplice(site, symbol, statements));
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
function collectValuePositionExclusions(program: AstNode): ReadonlySet<AstNode> {
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

/** Resolves `object` (the `<holder>` in `<holder>.<Sym>`) to its emitted text, or `undefined` if
 *  `object` is not one of the three authorized holder shapes (or is itself rejected -- an ambiguous
 *  token-symbol holder, a namespace/chain key, or a name reserved by the compiler). */
function resolveHolder(
  object: AstNode | undefined,
  tokens: TokenSymbols,
  source: string,
): string | undefined {
  if (!object) return undefined;
  if (object.type === "Identifier") {
    const name = (object as unknown as { name: string }).name;
    if (name === "self") return "ctx.self()";
    if (name === "address") return undefined; // reserved defensively -- no longer a compiler namespace root (address.* was dropped for gated ctx.*), but a bare `address` holder is still excluded rather than re-opened
    if (tokens.has(name)) return undefined; // ambiguous: USDC.WETH belongs to neither feature
    if (isChainKey(name)) return undefined; // owned by a qualified-token spelling, not this sugar
    if (resolveNamespace(name) !== undefined) return undefined; // owned by the protocol-accessor pass
    return name; // an ordinary program variable, dropped in verbatim
  }
  if (object.type === "Literal") {
    const raw = source.slice(object.start, object.end);
    if (!HEX_ADDRESS_LITERAL_RE.test(raw)) return undefined;
    const hex = raw.endsWith("n") ? raw.slice(0, -1) : raw;
    // Read from the literal's own RAW source text, never `.value` -- a 20-byte hex literal's
    // `.value` is a lossy float64 round-trip (the same literal.raw-vs-Number() trap this repo's
    // CLAUDE.md documents for the compiler's own const-eval fix).
    return formatBigint(BigInt(hex));
  }
  return undefined;
}

function collectBalanceSites(
  program: AstNode,
  tokens: TokenSymbols,
  shadowed: ReadonlySet<string>,
  excluded: ReadonlySet<AstNode>,
  source: string,
): Splice[] {
  const sites: Splice[] = [];
  walk(program, (n) => {
    if (n.type !== "MemberExpression") return;
    if ((n as { computed?: boolean }).computed) return;
    if (excluded.has(n)) return;
    const property = (n as { property?: AstNode }).property;
    if (!property || property.type !== "Identifier") return;
    const symbol = (property as unknown as { name: string }).name;
    if (!tokens.has(symbol)) return;
    if (shadowed.has(symbol)) return;
    const address = tokenAddressOf(tokens, symbol);
    if (address === undefined) return; // Set form: no address to inline, sugar declines
    const holder = resolveHolder((n as { object?: AstNode }).object, tokens, source);
    if (holder === undefined) return;
    sites.push({
      start: n.start,
      end: n.end,
      replacement: `IERC20.at(${formatBigint(address)}).balanceOf(${holder})`,
    });
  });
  return sites;
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

function isFactoryCall(node: AstNode): boolean {
  if (node.type !== "CallExpression" || (node as { optional?: boolean }).optional) return false;
  const callee = (node as { callee?: AstNode }).callee;

  return (
    callee?.type === "Identifier" &&
    (callee as unknown as { name: string }).name === TOKEN_FACTORY_NAME
  );
}

/** The single address argument of a `Token(...)` call. */
function factoryArgument(call: AstNode): AstNode {
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
function bindingCalls(
  program: AstNode,
  declarator: AstNode,
  name: string,
  declarations: ReadonlyMap<string, number>,
): ReadonlyArray<MethodCall> {
  const at = `\`${name} = ${TOKEN_FACTORY_NAME}(...)\``;
  if ((declarations.get(name) ?? 0) !== 1) {
    throw refuseFactory(`${at}: \`${name}\` is declared more than once`);
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
    throw refuseFactory(
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
  const program = parse(source);
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
      // place so a rewrite inside either splices on its own.
      splices.push(
        {
          start: site.object.start,
          end: address.start,
          replacement: `${SAFE_WRITES[site.method].local}(`,
        },
        { start: address.end, end: first!.start, replacement: ", " },
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
        splices.push(nameWriteSplice(site, name, statements));
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
 * acorn ranges — never a re-print of the AST, so everything else (formatting, comments, unrelated
 * code) survives byte-for-byte. Prepend `tokenImportLines(result)` before compiling the result.
 */
export function rewriteTokenMembers(source: string, tokens: TokenSymbols): TokenRewriteResult {
  const none: TokenRewriteResult = {
    source,
    rewrote: false,
    memberSites: 0,
    balanceSites: 0,
    writes: new Set(),
    erc20: false,
  };
  if (tokens.size === 0) return none;

  const program = parse(source);
  const shadowed = collectDeclaredNames(program);

  const writes = new Set<SafeWrite>();
  const members = collectMemberCallSites(program, tokens, shadowed, writes);
  const exclusions = collectValuePositionExclusions(program);
  const balanceSites = collectBalanceSites(program, tokens, shadowed, exclusions, source);

  const allSites = [...members.sites, ...balanceSites];
  if (allSites.length === 0) return none;
  assertLocalsFree(shadowed, writes);

  return {
    source: applySplices(source, allSites),
    rewrote: true,
    memberSites: members.sites.length,
    balanceSites: balanceSites.length,
    writes,
    // A symbol read and the balance sugar both name the typed binding; a write does not.
    erc20: members.reads > 0 || balanceSites.length > 0,
  };
}
