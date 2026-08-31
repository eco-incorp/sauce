/**
 * ERC20 token member rewrite -- two rewrites sharing one acorn parse, one shadow computation, and
 * one reverse-ordered textual splice over the ORIGINAL source (U4's own technique):
 *
 *   U4  (call position):  `<Sym>.transfer/.approve/.balanceOf(...)`  -> `IERC20.at(<Sym>).<method>(...)`
 *   sugar (value position): `<holder>.<Sym>`                          -> `IERC20.at(<addr>n).balanceOf(<holder>)`
 *
 * `<Sym>` in both is a name in `tokens` (the chain's resolved token-address map -- see
 * `token-registry.ts#resolveTokenMap`, the DEFAULT source; a caller may still pass a bare
 * `ReadonlySet<string>` of symbols with no addresses, which runs U4 only -- see the signature doc).
 *
 * RECOGNITION IS DISJOINT BY CONSTRUCTION, not by priority ordering: U4 needs `<Sym>` as the member
 * chain's HEAD with a REWRITABLE_METHODS member under a CALL parent; the sugar needs `<Sym>` as the
 * MEMBER with a non-call, non-lvalue parent and an authorized HOLDER as the object. A token symbol
 * can never simultaneously satisfy both shapes for the same node, so the two passes' site lists
 * never overlap and can be spliced together with a single reverse-ordered pass. `USDC.balanceOf(x)`
 * is U4's (and `token-registry.ts`'s module-eval guard -- no registry symbol may equal a
 * REWRITABLE_METHODS name -- is what keeps that permanent); `x.USDC` is the sugar's; `USDC.WETH` is
 * neither's (left untouched -- see the sugar's holder-rejection rule below).
 *
 * Shadowing-aware, CONSERVATIVELY, on the TOKEN name only (both rewrites): SauceScript shares scope
 * across `if`/`while`/bare-block bodies (the real compiler's `processIfStatement`/
 * `processWhileStatement` never push a new scope -- see this repo's CLAUDE.md's repeated shadow-fix
 * notes), so a name first `let`/`const`-declared inside a branch is NOT block-scoped away once the
 * branch ends. Rather than re-deriving that exact position-sensitive rule, this pass is
 * deliberately coarser and still sound: if a name anywhere in the WHOLE program is
 * `let`/`const`-declared or is a function parameter, EVERY occurrence of that name anywhere in the
 * program is left un-rewritten. The sugar's HOLDER name is deliberately NOT shadow-checked -- a
 * local variable IS the intended holder.
 *
 * A method name outside the three-op allowlist (U4), or an unresolvable/rejected holder (sugar), is
 * left completely untouched -- it fails closed at compile (an ordinary compile error), never a new
 * failure mode this pass introduces. This is the isolation half of the design: a token symbol in
 * MEMBER position is indistinguishable from an ordinary struct-field read, so this pass does not
 * OWN it and must never clobber a genuine member access.
 */
import * as acorn from "acorn";
import { walk, collectDeclaredNames, type AstNode } from "./ast-walk.js";
import { formatBigint } from "../deposit/format.js";
import { isChainKey, resolveNamespace } from "./accessor-index.js";

export const REWRITABLE_METHODS: ReadonlySet<string> = new Set(["transfer", "approve", "balanceOf"]);

/** Either the full registry-resolved `symbol -> address` map (enables BOTH rewrites), or a bare set
 *  of symbols with no addresses (U4 only -- the sugar has no address to inline, so it yields no
 *  sites; documented, not a silent surprise -- see the module doc). */
export type TokenSymbols = ReadonlyMap<string, bigint> | ReadonlySet<string>;

export interface TokenRewriteResult {
  readonly source: string;
  /** True if at least one site (U4 or sugar) was rewritten -- tells the caller whether to prepend
   *  the ERC20 import line and union in `TOKEN_BASE_DIRS`. */
  readonly rewrote: boolean;
  /** Count of U4 (`<Sym>.transfer/.approve/.balanceOf(...)`) call sites rewritten. */
  readonly memberSites: number;
  /** Count of `<holder>.<Sym>` balance-sugar sites rewritten. */
  readonly balanceSites: number;
}

interface Splice {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

function tokenAddressOf(tokens: TokenSymbols, symbol: string): bigint | undefined {
  return tokens instanceof Map ? tokens.get(symbol) : undefined;
}

// -- U4: <Sym>.transfer/.approve/.balanceOf(...) in CALL position ---------------------------------

function collectMemberCallSites(program: AstNode, tokens: TokenSymbols, shadowed: ReadonlySet<string>): Splice[] {
  const sites: Splice[] = [];
  walk(program, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = (n as { callee?: AstNode }).callee;
    if (!callee || callee.type !== "MemberExpression") return;
    const object = (callee as { object?: AstNode }).object;
    const property = (callee as { property?: AstNode; computed?: boolean }).property;
    const computed = (callee as { computed?: boolean }).computed;
    if (computed) return; // `TOKEN["transfer"]` is out of scope for this narrow rewrite
    if (!object || object.type !== "Identifier") return;
    if (!property || property.type !== "Identifier") return;
    const symbol = (object as unknown as { name: string }).name;
    const method = (property as unknown as { name: string }).name;
    if (!tokens.has(symbol)) return;
    if (shadowed.has(symbol)) return;
    if (!REWRITABLE_METHODS.has(method)) return;
    sites.push({ start: callee.start, end: callee.end, replacement: `IERC20.at(${symbol}).${method}` });
  });
  return sites;
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
function resolveHolder(object: AstNode | undefined, tokens: TokenSymbols, source: string): string | undefined {
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
    sites.push({ start: n.start, end: n.end, replacement: `IERC20.at(${formatBigint(address)}).balanceOf(${holder})` });
  });
  return sites;
}

/**
 * Rewrites every `<Sym>.transfer/.approve/.balanceOf(...)` call (U4) and every `<holder>.<Sym>`
 * value-position read (balance sugar) whose `<Sym>` is in `tokens` (and not shadowed anywhere in
 * `source`) — see the module doc for the full disjointness argument. Purely textual surgery over
 * the ORIGINAL source, driven by acorn ranges — never a re-print of the AST, so everything else
 * (formatting, comments, unrelated code) survives byte-for-byte.
 */
export function rewriteTokenMembers(source: string, tokens: TokenSymbols): TokenRewriteResult {
  if (tokens.size === 0) {
    return { source, rewrote: false, memberSites: 0, balanceSites: 0 };
  }

  // sourceType: "module" -- this pass now runs by DEFAULT (the registry provides addresses even
  // with no caller-supplied tokens), so it must tolerate a source that already carries a leading
  // `import { IERC20 } from "./artifacts/IERC20.json";` line, e.g. `nest.ts#nestedTransferProgram`.
  const program = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" }) as unknown as AstNode;
  const shadowed = collectDeclaredNames(program);

  const memberSites = collectMemberCallSites(program, tokens, shadowed);
  const exclusions = collectValuePositionExclusions(program);
  const balanceSites = collectBalanceSites(program, tokens, shadowed, exclusions, source);

  const allSites = [...memberSites, ...balanceSites];
  if (allSites.length === 0) {
    return { source, rewrote: false, memberSites: 0, balanceSites: 0 };
  }

  // Splice from the end backward so earlier offsets stay valid.
  const ordered = [...allSites].sort((a, b) => b.start - a.start);
  let out = source;
  for (const site of ordered) {
    out = out.slice(0, site.start) + site.replacement + out.slice(site.end);
  }
  return { source: out, rewrote: true, memberSites: memberSites.length, balanceSites: balanceSites.length };
}
