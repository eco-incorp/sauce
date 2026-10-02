/**
 * `Arbitrum.Portal.send(reward).receive(delivery).then(() => { body })` — an intent opened from
 * inside a program — read off the parser's tree.
 *
 * The expression names an intent's three parts in the order they happen: what the program pays
 * (`send`, the reward, escrowed on the chain the program runs on), what the solver delivers on the
 * destination (`receive`), and what runs there with it (`then`, the body). It means exactly
 * `Arbitrum(() => { body }, { tokens: delivery }).reward({ tokens: reward })`, and
 * `intent-sugar.ts` lowers both through one path; the CLI reads the same parts to tell which chain
 * each name in a file resolves on.
 *
 * Every part is required. An expression that stops early, or names the parts in another order, is
 * refused by name ({@link portalChainProblem}) rather than read as something else.
 */
import { walk, type AstNode } from "./ast-walk.js";

/** A complete `<Chain>.Portal.send(...).receive(...).then(...)`, as the parser read it. */
export interface PortalIntent {
  /** The chain accessor it starts from: `Arbitrum`. */
  readonly chainName: string;
  /** The whole expression: the `.then(...)` call. */
  readonly call: AstNode;
  /** The arguments of each step, as written. */
  readonly send: readonly AstNode[];
  readonly receive: readonly AstNode[];
  readonly then: readonly AstNode[];
}

const name = (node: AstNode | undefined): string | undefined =>
  node?.type === "Identifier" ? (node as unknown as { name: string }).name : undefined;

/** `node` as `<object>.<method>(...)`: the object and the arguments, or `undefined`. */
function methodCall(
  node: AstNode | undefined,
  method: string,
): { readonly object: AstNode; readonly args: readonly AstNode[] } | undefined {
  if (node?.type !== "CallExpression") return undefined;
  const callee = (node as { callee?: AstNode }).callee;
  if (callee?.type !== "MemberExpression" || (callee as { computed?: boolean }).computed) {
    return undefined;
  }
  if (name((callee as { property?: AstNode }).property) !== method) return undefined;

  return {
    object: (callee as { object?: AstNode }).object!,
    args: (node as { arguments?: AstNode[] }).arguments ?? [],
  };
}

/** `node` as `<Identifier>.Portal`: the identifier's name, or `undefined`. */
export function portalOf(node: AstNode | undefined): string | undefined {
  if (node?.type !== "MemberExpression" || (node as { computed?: boolean }).computed) {
    return undefined;
  }
  if (name((node as { property?: AstNode }).property) !== "Portal") return undefined;

  return name((node as { object?: AstNode }).object);
}

/**
 * `node` as a complete `<Identifier>.Portal.send(...).receive(...).then(...)`, or `undefined`.
 * The shape only: whether the identifier is a chain, and what the arguments hold, is the caller's
 * to decide.
 */
export function portalIntent(node: AstNode): PortalIntent | undefined {
  const then = methodCall(node, "then");
  const receive = methodCall(then?.object, "receive");
  const send = methodCall(receive?.object, "send");
  const chainName = portalOf(send?.object);
  if (chainName === undefined) return undefined;

  return { chainName, call: node, send: send!.args, receive: receive!.args, then: then!.args };
}

/**
 * The first `<Chain>.Portal` in `program` that does not open an intent — one that stops before its
 * body, names its parts out of order, or is used as a value — worded for the person who wrote it;
 * `undefined` when every one is a complete statement. `chainSlug` names the chain an identifier
 * accesses, and `undefined` for one that is not a chain.
 */
export function portalChainProblem(
  program: AstNode,
  chainSlug: (name: string) => string | undefined,
): string | undefined {
  // Each node's parent, for the few kinds a chain of calls is built from.
  const parents = new Map<AstNode, AstNode>();
  const portals: { readonly node: AstNode; readonly chainName: string; readonly slug: string }[] =
    [];
  walk(program, (node) => {
    for (const key of ["object", "callee", "expression"]) {
      const child = (node as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object") parents.set(child as AstNode, node);
    }
    const chainName = portalOf(node);
    const slug = chainName === undefined ? undefined : chainSlug(chainName);
    if (chainName !== undefined && slug !== undefined) portals.push({ node, chainName, slug });
  });

  /** The call `<node>.<method>(...)`, when `node` is the object of exactly that. */
  const next = (node: AstNode, method: string): AstNode | undefined => {
    const member = parents.get(node);
    if (member?.type !== "MemberExpression" || (member as { object?: AstNode }).object !== node) {
      return undefined;
    }
    if (name((member as { property?: AstNode }).property) !== method) return undefined;
    const call = parents.get(member);

    return call?.type === "CallExpression" && (call as { callee?: AstNode }).callee === member
      ? call
      : undefined;
  };

  for (const { node, chainName, slug } of portals) {
    const form =
      `\`${chainName}.Portal.send({ token, amount }).receive({ token, amount })` +
      `.then(() => { … })\``;
    const send = next(node, "send");
    if (send === undefined) {
      return (
        `\`${chainName}.Portal\` opens an intent on ${slug}, written ${form}. It starts with ` +
        "`.send(...)`: what this program pays the solver."
      );
    }
    const receive = next(send, "receive");
    if (receive === undefined) {
      return (
        `\`${chainName}.Portal.send(...)\` stops before \`.receive(...)\`. An intent names what ` +
        `the solver delivers on ${slug}, \`.receive({ token, amount })\`, then the body that runs ` +
        `there with it, \`.then(() => { … })\`: ${form}.`
      );
    }
    const then = next(receive, "then");
    if (then === undefined) {
      return (
        `\`${chainName}.Portal.send(...).receive(...)\` has no body. Finish it with ` +
        `\`.then(() => { … })\`: the code that runs on ${slug} with what was received.`
      );
    }
    if (parents.get(then)?.type !== "ExpressionStatement") {
      return (
        `\`${chainName}.Portal.send(...).receive(...).then(...)\` is a statement of its own: it ` +
        "opens the intent and returns nothing to use."
      );
    }
  }

  return undefined;
}
