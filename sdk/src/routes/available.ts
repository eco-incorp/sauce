/**
 * `available(<name>)` — whether the chain a program is compiled for has a registry contract or
 * token, decided at compile time. One program can then use a venue only where the chain has it:
 *
 *   if (available(UniswapV3.Factory)) { pool = UniswapV3.Factory.getPool(USDC, WETH, 500n); }
 *
 * `<name>` is a contract reference — `UniswapV3.Factory`, a family's `Uniswap.UniversalRouter`, a
 * chain-qualified `Arbitrum.UniswapV3.Factory` — or a token symbol, `USDC`. A name the registry
 * does not know at all, on any chain, is an error rather than `false`, so a typo cannot quietly
 * drop a branch; so is an interface, which no chain deploys, and an ambiguous family name.
 *
 * HOW IT IS DECIDED. By the compiler, from the chain's host (`host.ts`): every name some chain has
 * is declared on each chain, as its value where the chain has it and as zero where it does not, and
 * comparing a name with zero is a comparison the compiler decides while it compiles — leaving out,
 * names and all, the branch it rules out (an `if`, `?:`, `&&`, `||`, and the rest of a function
 * after a decided guard that returns). So `available(X)` is exactly `0n != X`, and that is what the
 * compiler is given: the call's own characters, with `available(` written as the comparison and
 * the name left where it was, so every position in the program is the one its author wrote. A
 * closure body is the same text, compiled in its own chain's scope, so there it means that chain.
 *
 * A program that declares its own `available` keeps it, untouched.
 */
import type { CanonicalChain } from "../chains/canonical.js";
import { collectDeclaredNames, walk, type AstNode } from "./ast-walk.js";
import { isChainKey, resolveNamespace } from "./accessor-index.js";
import { parseSauce, parseSauceExpression } from "./parse.js";
import { resolveContractReference } from "./protocol-names.js";
import { registryTokenSymbols } from "./token-registry.js";

const NAME = "available";
/** What `available` becomes: as long as the word, so nothing after it moves. */
const COMPARISON = "(0n !=   ";

function fail(message: string): never {
  throw new Error(`available(): ${message}`);
}

/** `a.b.c` -> ["a", "b", "c"]; anything but a plain member chain of identifiers -> undefined. */
function memberPath(node: AstNode): string[] | undefined {
  if (node.type === "Identifier") return [(node as unknown as { name: string }).name];
  if (node.type !== "MemberExpression" || (node as { computed?: boolean }).computed)
    return undefined;
  const object = memberPath((node as { object?: AstNode }).object!);
  const property = (node as { property?: AstNode }).property!;
  if (object === undefined || property.type !== "Identifier") return undefined;
  return [...object, (property as unknown as { name: string }).name];
}

/** Refuses an `available(...)` that names nothing the registry has, or nothing a chain deploys. */
function check(
  call: AstNode,
  source: string,
  chain: CanonicalChain,
  tokens: ReadonlyMap<string, bigint>,
): void {
  const args = (call as { arguments?: AstNode[] }).arguments ?? [];
  const shown = source.slice(call.start, call.end);
  if (args.length !== 1) fail(`'${shown}' takes one name: a contract or a token symbol`);
  const path = memberPath(args[0]!);
  if (path === undefined) {
    fail(
      `'${shown}' takes a registry name — '<Protocol>.<Contract>' or a token symbol — not an expression`,
    );
  }
  const [head, ...rest] = path;
  if (rest.length === 0) {
    if (tokens.has(head!) || registryTokenSymbols().has(head!)) return;
    if (resolveNamespace(head!) !== undefined) {
      fail(`'${shown}' names a protocol; name one of its contracts: '${head}.<Contract>'`);
    }
    fail(`'${head}' is not a contract or token in the registry`);
  }
  if (!isChainKey(head!) && resolveNamespace(head!) === undefined) {
    fail(`'${path.join(".")}' is not a contract or token in the registry`);
  }
  if (rest.length !== (isChainKey(head!) ? 2 : 1)) {
    fail(
      `'${shown}' -- expected available(<Protocol>.<Contract>) or available(<Chain>.<Protocol>.<Contract>)`,
    );
  }
  const reference = resolveContractReference(head!, rest, chain, undefined, `'${shown}'`, "");
  if (reference.descriptor.kind === "interface") {
    fail(
      `${reference.protocol}.${reference.contract} is an interface — no chain deploys it, so there is ` +
        "nothing to check; it is called at an address the program supplies",
    );
  }
}

/**
 * `source` with every `available(<name>)` written as `0n != <name>`, after checking each names
 * something the registry has. `tokens` is the chain's resolved token map (`resolveTokenMap`).
 * `entry` says what `source` is, as the compiler is told: a module, or one closure.
 */
export function availableAsComparison(
  source: string,
  chain: CanonicalChain,
  tokens: ReadonlyMap<string, bigint>,
  entry: "module" | "closure" = "module",
): string {
  if (!source.includes(NAME)) return source;
  const program = entry === "closure" ? parseSauceExpression(source) : parseSauce(source);
  if (collectDeclaredNames(program).has(NAME)) return source;

  const calls: AstNode[] = [];
  walk(program, (node) => {
    const callee = (node as { callee?: AstNode }).callee;
    if (
      node.type === "CallExpression" &&
      callee?.type === "Identifier" &&
      (callee as unknown as { name: string }).name === NAME
    ) {
      calls.push(node);
    }
  });
  if (calls.length === 0) return source;

  // Every call is checked, dead branch or not, so a typo anywhere fails.
  const text = source.split("");
  for (const call of calls) {
    check(call, source, chain, tokens);
    const callee = (call as { callee?: AstNode }).callee!;
    // `available` becomes `(0n !=  `, and the call's own `(` a space: its `)` closes the comparison.
    text.splice(callee.start, NAME.length, ...COMPARISON);
    const open = source.indexOf("(", callee.end);
    text[open] = " ";
  }

  return text.join("");
}
