/**
 * Where a program opens an intent, read off its syntax: `<Chain>.Portal.send(…).receive(…)
 * .then(() => { … })`, a chain of calls rooted at a chain's `Portal`. What the compiler is told
 * about these names is `routes/intent-host.ts`'s; this only finds them in the text, for the
 * commands that report on a file or check what it does.
 */
import type { AstNode } from "../routes/ast-walk.js";

/** The chain accessor (`Arbitrum`) a call of a chain rooted at `<Chain>.Portal` starts from, or
 *  `undefined` for any other call. */
export function portalRoot(call: AstNode): string | undefined {
  let node: AstNode | undefined = call;
  while (node?.type === "CallExpression") {
    const callee = node.callee as AstNode | undefined;
    if (callee?.type !== "MemberExpression" || callee.computed === true) return undefined;
    node = callee.object as AstNode | undefined;
  }
  const property = node?.property as AstNode | undefined;
  const object = node?.object as AstNode | undefined;
  if (node?.type !== "MemberExpression" || node.computed === true) return undefined;
  if (property?.name !== "Portal" || object?.type !== "Identifier") return undefined;

  return typeof object.name === "string" ? object.name : undefined;
}

/** The chain accessor an `await` statement's intent opens on, `await Arbitrum.Portal.send(…)
 *  .receive(…);`, whose body is every statement after it in its block; `undefined` for any other
 *  statement. */
export function awaitedPortalRoot(statement: AstNode): string | undefined {
  const awaited =
    statement.type === "ExpressionStatement" ? (statement.expression as AstNode) : undefined;
  const call = awaited?.type === "AwaitExpression" ? (awaited.argument as AstNode) : undefined;

  return call?.type === "CallExpression" ? portalRoot(call) : undefined;
}

/** The method a call of such a chain calls (`send`, `receive`, `then`). */
export function portalMethod(call: AstNode): string | undefined {
  const callee = call.callee as AstNode | undefined;
  if (callee?.type !== "MemberExpression" || callee.computed === true) return undefined;
  const name = (callee.property as AstNode | undefined)?.name;

  return typeof name === "string" ? name : undefined;
}
