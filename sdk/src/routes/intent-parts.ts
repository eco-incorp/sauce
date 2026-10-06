/**
 * Where the parts of a program run that an intent sends to another chain: each `.then(...)` body of
 * an intent opened on a chain's `Portal` (`Arbitrum.Portal.send(…)…then(() => { … })`), and the
 * items of its `.receive(...)`, which name the destination's tokens. Read from the program's text,
 * for what the compile does not report: which chain a diagnostic, or a name a program reads, is on.
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
}

/** Every intent part of `program`, an AST of the program's text. */
export function intentParts(program: AstNode): IntentPart[] {
  const parts: IntentPart[] = [];
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as AstNode;
    if (callee.type !== "MemberExpression") return;
    const method = (callee.property as AstNode | undefined)?.name;
    if (method !== "then" && method !== "receive") return;
    const chain = portalChain(callee.object as AstNode);
    if (chain === undefined) return;
    for (const part of (node.arguments as AstNode[] | undefined) ?? []) {
      parts.push({ chain, start: part.start, end: part.end });
    }
  });

  return parts;
}

/** The chain whose `Portal` a chain of calls starts from, or `undefined`. */
function portalChain(node: AstNode): CanonicalChain | undefined {
  let at: AstNode | undefined = node;
  while (at !== undefined) {
    if (at.type === "CallExpression") {
      at = at.callee as AstNode;
    } else if (at.type === "MemberExpression") {
      const object = at.object as AstNode;
      const property = (at.property as AstNode | undefined)?.name;
      if (
        property === "Portal" &&
        object.type === "Identifier" &&
        isChainKey(object.name as string)
      ) {
        return requireChain(chainSlugForKey(object.name as string)!);
      }
      at = object;
    } else {
      return undefined;
    }
  }
  return undefined;
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
