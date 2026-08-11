/**
 * ERC20 token member rewrite — `USDC.transfer(to, amount)` -> `IERC20.at(USDC).transfer(to, amount)`.
 *
 * A TOKEN-ONLY acorn source rewrite: a member call `<Sym>.transfer(a,b)` / `.approve(a,b)` /
 * `.balanceOf(a)` where `<Sym>` is a name in the chain's ambient TOKEN map is rewritten to
 * `IERC20.at(<Sym>).<method>(...)`, with `token/evm.ts`'s `ERC20_IMPORT_LINE` prepended and
 * `token/source.ts`'s `TOKEN_BASE_DIRS` unioned into `baseDirs` by the caller — byte-identical to
 * what the landed `Token` emitter already produces, so nothing NEW reaches the compiler.
 *
 * Shadowing-aware, CONSERVATIVELY: SauceScript shares scope across `if`/`while`/bare-block bodies
 * (the real compiler's `processIfStatement`/`processWhileStatement` never push a new scope — see
 * this repo's CLAUDE.md's repeated shadow-fix notes), so a name first `let`/`const`-declared inside
 * a branch is NOT block-scoped away once the branch ends. Rather than re-deriving that exact
 * position-sensitive rule, this pass is deliberately coarser and still sound: if a name anywhere in
 * the WHOLE program is `let`/`const`-declared or is a function parameter, EVERY occurrence of that
 * name anywhere in the program is left un-rewritten (fails closed to "don't rewrite" rather than
 * risking a rewrite of what could be a genuinely shadowed local at that point).
 *
 * A method name outside the three-op allowlist is left completely untouched — it will fail closed
 * at compile (an ordinary `undefined variable`/property-shaped compile error), not a new failure
 * mode this pass introduces.
 */
import * as acorn from "acorn";
import { walk, collectDeclaredNames, type AstNode } from "./ast-walk.js";

const REWRITABLE_METHODS: ReadonlySet<string> = new Set(["transfer", "approve", "balanceOf"]);

export interface TokenRewriteResult {
  readonly source: string;
  /** True if at least one call site was rewritten -- tells the caller whether to prepend the
   *  ERC20 import line and union in `TOKEN_BASE_DIRS`. */
  readonly rewrote: boolean;
}

interface RewriteSite {
  readonly start: number;
  readonly end: number;
  readonly symbol: string;
  readonly method: string;
}

function collectRewriteSites(program: AstNode, tokenSymbols: ReadonlySet<string>, shadowed: ReadonlySet<string>): RewriteSite[] {
  const sites: RewriteSite[] = [];
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
    if (!tokenSymbols.has(symbol)) return;
    if (shadowed.has(symbol)) return;
    if (!REWRITABLE_METHODS.has(method)) return;
    sites.push({ start: callee.start, end: callee.end, symbol, method });
  });
  return sites;
}

/**
 * Rewrites every `<Sym>.transfer/.approve/.balanceOf(...)` call whose `<Sym>` is in `tokenSymbols`
 * (and not shadowed anywhere in `source`) into `IERC20.at(<Sym>).<method>(...)`. Purely textual
 * surgery over the ORIGINAL source, driven by acorn ranges — never a re-print of the AST, so
 * everything else (formatting, comments, unrelated code) survives byte-for-byte.
 */
export function rewriteTokenMembers(source: string, tokenSymbols: ReadonlySet<string>): TokenRewriteResult {
  if (tokenSymbols.size === 0) {
    return { source, rewrote: false };
  }

  const program = acorn.parse(source, { ecmaVersion: "latest" }) as unknown as AstNode;
  const shadowed = collectDeclaredNames(program);
  const sites = collectRewriteSites(program, tokenSymbols, shadowed);

  if (sites.length === 0) {
    return { source, rewrote: false };
  }

  // Splice from the end backward so earlier offsets stay valid.
  const ordered = [...sites].sort((a, b) => b.start - a.start);
  let out = source;
  for (const site of ordered) {
    const replacement = `IERC20.at(${site.symbol}).${site.method}`;
    out = out.slice(0, site.start) + replacement + out.slice(site.end);
  }
  return { source: out, rewrote: true };
}
