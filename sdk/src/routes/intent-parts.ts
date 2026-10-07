/**
 * Where the parts of a program run that a hop sends to another chain: the body of each intent
 * opened with a chain's `hop` — what follows `await Arbitrum.hop({ … });` in its block, or the
 * argument of `Arbitrum.hop({ … }).then(…)` — its handler, `.catch(…)` after that `.then`, and its
 * config's `receive`, which names the destination's tokens. The handler of a `try` around awaited
 * hops runs on each of their destinations and where the `try` is written. Read from the program's
 * text, for what the compile does not report: which chain a diagnostic, or a name a program reads,
 * is on.
 */
import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import { chainSlugForKey, isChainKey } from "./accessor-index.js";
import { walk, type AstNode } from "./ast-walk.js";
import { parseSauce } from "./parse.js";

/** A source range that runs on another chain: an intent's body or its delivery's items. */
export interface IntentPart {
  readonly chain: CanonicalChain;
  readonly start: number;
  readonly end: number;
  /** It runs where it is written too: a `try`'s handler, for each hop the `try` awaits. */
  readonly alsoHere?: true;
}

/** Every intent part of `program`, an AST of the program's text. */
export function intentParts(program: AstNode): IntentPart[] {
  const parts: IntentPart[] = [];
  walk(program, (node) => {
    // `await X.hop({ … });` and the statements after it in its block.
    const statements =
      node.type === "Program" || node.type === "BlockStatement"
        ? (node.body as AstNode[] | undefined)
        : undefined;
    statements?.forEach((statement, i) => {
      const chain = awaitedHop(statement);
      const rest = statements.slice(i + 1);
      if (chain !== undefined && rest.length > 0) {
        parts.push({ chain, start: rest[0]!.start, end: rest[rest.length - 1]!.end });
      }
    });
    // `try { …; await X.hop({ … }); … } catch { H }`: H runs on each hop's destination, in order,
    // as `.catch` of its body, and where the `try` is written.
    if (node.type === "TryStatement") {
      const handler = (node.handler as AstNode | undefined)?.body as AstNode | undefined;
      const tried = ((node.block as AstNode).body as AstNode[] | undefined) ?? [];
      for (const statement of tried) {
        const chain = awaitedHop(statement);
        if (chain !== undefined && handler !== undefined) {
          parts.push({ chain, start: handler.start, end: handler.end, alsoHere: true });
        }
      }
    }
    if (node.type !== "CallExpression") return;
    const callee = node.callee as AstNode;
    if (callee.type !== "MemberExpression") return;
    const method = (callee.property as AstNode | undefined)?.name;
    // `X.hop({ … receive … })`.
    if (method === "hop") {
      const chain = chainOf(callee.object as AstNode);
      const config = (node.arguments as AstNode[] | undefined)?.[0];
      if (chain === undefined || config?.type !== "ObjectExpression") return;
      for (const field of (config.properties as AstNode[] | undefined) ?? []) {
        const key = field.key as AstNode | undefined;
        if (field.type === "Property" && (key?.name ?? key?.value) === "receive") {
          const value = field.value as AstNode;
          parts.push({ chain, start: value.start, end: value.end });
        }
      }
      return;
    }
    // `X.hop({ … }).then(body)`, and `.catch(handler)` after it, on the same chain.
    if (method !== "then" && method !== "catch") return;
    const hop = callee.object as AstNode;
    const chain =
      method === "then"
        ? hopChain(hop)
        : hop.type === "CallExpression" &&
            ((hop.callee as AstNode).property as AstNode | undefined)?.name === "then"
          ? hopChain((hop.callee as AstNode).object as AstNode)
          : undefined;
    if (chain === undefined) return;
    for (const part of (node.arguments as AstNode[] | undefined) ?? []) {
      parts.push({ chain, start: part.start, end: part.end });
    }
  });

  return parts;
}

/** The chain a chain's name is, `Arbitrum`, or `undefined`. */
function chainOf(node: AstNode): CanonicalChain | undefined {
  return node.type === "Identifier" && isChainKey(node.name as string)
    ? requireChain(chainSlugForKey(node.name as string)!)
    : undefined;
}

/** The chain `statement`, `await X.hop({ … });`, hops to, or `undefined`. */
function awaitedHop(statement: AstNode): CanonicalChain | undefined {
  const awaited = statement.type === "ExpressionStatement" ? statement.expression : undefined;
  if ((awaited as AstNode | undefined)?.type !== "AwaitExpression") return undefined;

  return hopChain((awaited as AstNode).argument as AstNode);
}

/**
 * Every chain path the range `start`..`end` runs on, each from the outermost part around it: one
 * path for a range in bodies alone, and for one in a `try`'s handler, also each path that stops
 * before a hop the `try` awaits. The empty path is the program's own chain.
 */
export function pathsAt(
  parts: readonly IntentPart[],
  start: number,
  end: number,
): CanonicalChain[][] {
  const around = parts
    .map((part, order) => ({ part, order }))
    .filter(({ part }) => part.start <= start && end <= part.end)
    .sort((a, b) => b.part.end - b.part.start - (a.part.end - a.part.start) || a.order - b.order);
  let paths: CanonicalChain[][] = [[]];
  for (const { part } of around) {
    const entered = paths.map((path) => [...path, part.chain]);
    paths = part.alsoHere === true ? [...paths, ...entered] : entered;
  }

  return paths;
}

/** The chain `node`, a call of a chain's `hop`, opens its hop to, or `undefined`. */
function hopChain(node: AstNode | undefined): CanonicalChain | undefined {
  if (node?.type !== "CallExpression") return undefined;
  const callee = node.callee as AstNode;
  if (callee.type !== "MemberExpression") return undefined;

  return (callee.property as AstNode | undefined)?.name === "hop"
    ? chainOf(callee.object as AstNode)
    : undefined;
}

/** The chain the code at `offset` of `source` runs on: the innermost intent body around it, or
 *  `root`. */
export function chainAt(source: string, offset: number, root: CanonicalChain): CanonicalChain {
  let program: AstNode;
  try {
    program = parseSauce(source);
  } catch {
    return root;
  }
  const around = intentParts(program)
    .filter((part) => part.start <= offset && offset < part.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];

  return around?.chain ?? root;
}
