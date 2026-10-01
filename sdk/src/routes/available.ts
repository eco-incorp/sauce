/**
 * `available(<name>)` — whether the chain a program is compiled for has a registry contract or
 * token, decided at compile time. One program can then use a venue only where the chain has it:
 *
 *   if (available(UniswapV3.Factory)) { pool = UniswapV3.Factory.getPool(USDC, WETH, 500n); }
 *
 * `<name>` is a contract reference — `UniswapV3.Factory`, a family's `Uniswap.UniversalRouter`, a
 * chain-qualified `Arbitrum.UniswapV3.Factory` — or a token symbol, `USDC`. A contract is available
 * where the registry has its address on that chain; a token where the chain's token map (the
 * registry plus the caller's `tokens`) names it. A name the registry does not know at all, on any
 * chain, is an error rather than `false`, so a typo cannot quietly drop a branch; so is an
 * interface, which no chain deploys, and an ambiguous family name.
 *
 * WHY THIS RUNS BEFORE EVERYTHING ELSE. The compiler folds `if (false)` away, but it resolves every
 * name in the dead branch first — so a branch naming a contract the chain lacks would still fail.
 * This pass therefore removes such a branch from the SOURCE before any other pass sees it:
 *   - `if (available(X)) A else B` keeps `if (true) A` or `if (false) {} else B`, which the
 *     compiler folds (a bare block is not in the language, so the statement stays an `if`);
 *   - `available(X) ? a : b` keeps `(a)` or `(b)`;
 *   - `available(X) && e` keeps `(e)` or `false`, and `available(X) || e` keeps `true` or `(e)`;
 *   - `!`, `&&`, `||` over `available(...)` and `true`/`false` fold first.
 * and a decided `if` that always returns or throws — the guard `if (!available(X)) return 0n;` —
 * is replaced by the statements of the branch it takes, and the rest of its statement list goes. Anywhere else, `available(X)` is replaced by `true` or
 * `false`. A branch reached only through a runtime value (`const has = available(X); if (has) ...`)
 * is NOT removed: it is live code.
 *
 * A closure body inside the program (`Arbitrum(() => { ... })`) is left alone: it is compiled for
 * its own chain, and this pass runs again there with that chain's registry.
 */
import * as acorn from "acorn";

import type { CanonicalChain } from "../chains/canonical.js";
import { addressOn } from "../descriptors/query.js";
import { collectDeclaredNames, type AstNode } from "./ast-walk.js";
import { isChainKey, resolveNamespace } from "./accessor-index.js";
import { resolveContractReference } from "./protocol-rewrite.js";
import { TOKEN_REGISTRY } from "./token-registry.js";

export interface AvailabilityResult {
  readonly source: string;
  readonly rewrote: boolean;
  /** How many `available(...)` calls were decided. */
  readonly sites: number;
}

const NAME = "available";

function fail(message: string): never {
  throw new Error(`available(): ${message}`);
}

/** Every token symbol the registry has on any chain: a symbol outside this set is a typo. */
let knownSymbols: ReadonlySet<string> | undefined;
function registrySymbols(): ReadonlySet<string> {
  knownSymbols ??= new Set(
    Object.values(TOKEN_REGISTRY)
      .flat()
      .map((row) => row.symbol),
  );
  return knownSymbols;
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

function decide(
  call: AstNode,
  source: string,
  chain: CanonicalChain,
  tokens: ReadonlyMap<string, bigint>,
): boolean {
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
    if (tokens.has(head!)) return true;
    if (registrySymbols().has(head!)) return false;
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
  return addressOn(reference.descriptor, reference.chain) !== undefined;
}

/** Child nodes of `node` in source order. */
function childrenOf(node: AstNode): AstNode[] {
  const out: AstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && typeof item === "object" && typeof (item as AstNode).type === "string") {
        out.push(item as AstNode);
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const isFunctionExpression = (node: AstNode): boolean =>
  node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";

/**
 * Decides every `available(...)` in `source` for `chain` and removes the branches it rules out.
 * `tokens` is the chain's resolved token map (`resolveTokenMap`). A program that declares its own
 * `available` keeps it, untouched.
 */
export function rewriteAvailability(
  source: string,
  chain: CanonicalChain,
  tokens: ReadonlyMap<string, bigint>,
): AvailabilityResult {
  if (!source.includes(NAME)) return { source, rewrote: false, sites: 0 };
  const program = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
  }) as unknown as AstNode;
  if (collectDeclaredNames(program).has(NAME)) return { source, rewrote: false, sites: 0 };

  // Every call is decided, dead branch or not, so a typo anywhere fails.
  const decided = new Map<AstNode, boolean>();
  const visit = (node: AstNode): void => {
    if (isFunctionExpression(node)) return;
    if (
      node.type === "CallExpression" &&
      (node as { callee?: AstNode }).callee!.type === "Identifier" &&
      ((node as { callee?: AstNode }).callee! as unknown as { name: string }).name === NAME
    ) {
      decided.set(node, decide(node, source, chain, tokens));
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(program);
  if (decided.size === 0) return { source, rewrote: false, sites: 0 };

  /** The value of an expression built from `available(...)`, literals, `!`, `&&`, `||`. */
  const valueOf = (node: AstNode): boolean | undefined => {
    if (decided.has(node)) return decided.get(node);
    if (node.type === "Literal" && typeof (node as { value?: unknown }).value === "boolean") {
      return (node as unknown as { value: boolean }).value;
    }
    if (node.type === "UnaryExpression" && (node as { operator?: string }).operator === "!") {
      const inner = valueOf((node as { argument?: AstNode }).argument!);
      return inner === undefined ? undefined : !inner;
    }
    if (node.type === "LogicalExpression") {
      const { operator, left, right } = node as unknown as {
        operator: string;
        left: AstNode;
        right: AstNode;
      };
      const l = valueOf(left);
      if (operator === "&&") return l === false ? false : l === true ? valueOf(right) : undefined;
      if (operator === "||") return l === true ? true : l === false ? valueOf(right) : undefined;
    }
    return undefined;
  };

  /** Whether control never continues past `node`: it returns or throws on every path that a
   *  decided `available(...)` leaves. */
  const exits = (node: AstNode | null | undefined): boolean => {
    if (node === null || node === undefined) return false;
    if (node.type === "ReturnStatement" || node.type === "ThrowStatement") return true;
    if (node.type === "BlockStatement") {
      return ((node as { body?: AstNode[] }).body ?? []).some(exits);
    }
    if (node.type === "IfStatement") {
      const { test, consequent, alternate } = node as unknown as {
        test: AstNode;
        consequent: AstNode;
        alternate: AstNode | null;
      };
      const taken = valueOf(test);
      if (taken === true) return exits(consequent);
      if (taken === false) return exits(alternate);
      return exits(consequent) && exits(alternate);
    }
    return false;
  };

  /** The branch a decided `if` takes (`null` when it takes an absent `else`). */
  const taken = (node: AstNode): AstNode | null => {
    const { test, consequent, alternate } = node as unknown as {
      test: AstNode;
      consequent: AstNode;
      alternate: AstNode | null;
    };
    return valueOf(test) ? consequent : alternate;
  };

  /** A statement rendered in place of the `if` that held it: a block's statements, unwrapped. */
  const renderInline = (node: AstNode | null): string => {
    if (node === null) return "";
    if (node.type !== "BlockStatement") return render(node);
    const rendered = render(node);
    return rendered.slice(rendered.indexOf("{") + 1, rendered.lastIndexOf("}"));
  };

  const render = (node: AstNode): string => {
    if (isFunctionExpression(node)) return source.slice(node.start, node.end);
    const value = valueOf(node);
    if (value !== undefined && (decided.has(node) || node.type !== "Literal")) return String(value);

    // A statement list: after a decided `if` that always returns or throws (the guard
    // `if (!available(X)) return 0n;`), the rest of the list cannot run, and is removed with it.
    if (node.type === "Program" || node.type === "BlockStatement") {
      const body = (node as { body?: AstNode[] }).body ?? [];
      let out = "";
      let cursor = node.start;
      for (const statement of body) {
        const test = (statement as { test?: AstNode }).test;
        if (statement.type === "IfStatement" && valueOf(test!) !== undefined && exits(statement)) {
          // The branch taken is the list's last word: its statements stand in for the `if`, so the
          // compiler sees every path return (it does not count `if (true) { return … }` as one).
          out += source.slice(cursor, statement.start) + renderInline(taken(statement));
          cursor = body[body.length - 1]!.end;
          break;
        }
        out += source.slice(cursor, statement.start) + render(statement);
        cursor = statement.end;
      }
      return out + source.slice(cursor, node.end);
    }

    if (node.type === "IfStatement") {
      const { test, consequent, alternate } = node as unknown as {
        test: AstNode;
        consequent: AstNode;
        alternate: AstNode | null;
      };
      const taken = valueOf(test);
      if (taken === true) return `if (true) ${render(consequent)}${alternate ? " else {}" : ""}`;
      if (taken === false) {
        return `if (false) {}${alternate ? ` else ${render(alternate)}` : ""}`;
      }
    }
    if (node.type === "ConditionalExpression") {
      const { test, consequent, alternate } = node as unknown as {
        test: AstNode;
        consequent: AstNode;
        alternate: AstNode;
      };
      const taken = valueOf(test);
      if (taken !== undefined) return `(${render(taken ? consequent : alternate)})`;
    }
    if (node.type === "LogicalExpression") {
      const { operator, left, right } = node as unknown as {
        operator: string;
        left: AstNode;
        right: AstNode;
      };
      const l = valueOf(left);
      // The left side decided, the right one not: the right is what remains, or nothing does.
      if (l !== undefined && (operator === "&&" || operator === "||")) {
        if ((operator === "&&") === l) return `(${render(right)})`;
        return String(l);
      }
    }

    let out = "";
    let cursor = node.start;
    for (const child of childrenOf(node)) {
      // A shorthand property's key and value are one span: render it once.
      if (child.start < cursor) continue;
      out += source.slice(cursor, child.start) + render(child);
      cursor = child.end;
    }
    return out + source.slice(cursor, node.end);
  };

  // `render(program)` covers [program.start, program.end); keep anything outside it verbatim.
  const rewritten = source.slice(0, program.start) + render(program) + source.slice(program.end);
  return { source: rewritten, rewrote: true, sites: decided.size };
}
