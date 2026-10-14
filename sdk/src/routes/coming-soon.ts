/**
 * Opening an intent is coming soon, as `<Chain>.hop({ send, receive, refundee }).then(() => { … })`.
 *
 * The source-rewrite intent DSL is gone, and its successor waits on the compiler that folds it. Until
 * then every place that used to open an intent says so in ONE sentence, each with its own site and
 * with what acts on an intent that already exists from there:
 *
 * - a program's source, `<Chain>.hop(…)` or the earlier `<Chain>(() => { … })` ({@link
 *   refuseIntentSyntax}, the first thing a route or program compile does, so every front end gets it);
 * - `sauce intent publish`, and the MCP tool `sauce_intent_publish`;
 * - TypeScript: calling a chain export (`Base(…)`, `Base.route(…)`), `routes.openRoute(…)` and the
 *   actions package's `programIntent(…)`.
 *
 * Everything that acts on an intent once it exists — the Portal's calls, the hashes, the vault, and
 * the `sauce intent` lifecycle — is unaffected.
 */
import { collectDeclaredNames, walk, type AstNode } from "./ast-walk.js";
import { parseSauce } from "./parse.js";

/** How an intent will be opened. */
export const HOP_SYNTAX = "`<Chain>.hop({ send, receive, refundee }).then(() => { … })`";

/** What acts on an intent that already exists, said where no front end is known. */
export const EXISTING_INTENTS =
  "an intent that already exists can be filled, proven, claimed, refunded and cancelled";

/** {@link EXISTING_INTENTS} for TypeScript: the routes helpers that do it. */
export const EXISTING_INTENTS_TS =
  "the routes Portal helpers act on intents that already exist (`intentFromPublished`, " +
  "`fulfillTx`, `proveTx`, `withdrawTx`, `refundTx`, `cancelTx`)";

/** The one refusal: `site` is what was asked for, `today` what acts on an existing intent there. */
export function intentsComingSoon(site: string, today: string = EXISTING_INTENTS): string {
  return (
    `${site}: opening an intent is coming soon. It will be written ${HOP_SYNTAX}; until then, ` +
    `${today}.`
  );
}

/** Thrown wherever an intent used to be opened. `site` names what was asked for. */
export class IntentsComingSoonError extends Error {
  readonly code = "intents-coming-soon";

  constructor(
    readonly site: string,
    today: string = EXISTING_INTENTS,
  ) {
    super(intentsComingSoon(site, today));
    this.name = "IntentsComingSoonError";
  }
}

/**
 * `routes.openRoute(…)`: opened an intent from a route body. Opening an intent is coming soon.
 *
 * @deprecated Opening an intent is coming soon, written
 *   `<Chain>.hop({ send, receive, refundee }).then(() => { … })`. Throws
 *   {@link IntentsComingSoonError}.
 */
export function openRoute(..._args: unknown[]): never {
  throw new IntentsComingSoonError("`routes.openRoute(…)`", EXISTING_INTENTS_TS);
}

/** A chain export called (`Base(…)`) or its `.route(…)`: what each used to open. */
export function chainCallComingSoon(name: string, member?: "route"): never {
  throw new IntentsComingSoonError(
    member === undefined ? `\`${name}(…)\`` : `\`${name}.${member}(…)\``,
    EXISTING_INTENTS_TS,
  );
}

/** Per set of chain names, the text check a source must pass before it is worth parsing. */
const hints = new WeakMap<ReadonlyMap<string, unknown>, RegExp>();

/**
 * Refuses a program that opens an intent, before any rewrite or the compiler reads it: a call of
 * `<Chain>.hop(…)`, or of a chain itself, `<Chain>(…)`, the form the removed DSL rewrote. Without
 * this, the first gives the protocol-accessor rewrite's "expected `<Chain>.<Protocol>…`" and the
 * second the compiler's "calling anything other than a plain function name".
 *
 * `chains` is every chain name a program may write (`sauce-route.ts#chainAccessorNames`). A name the
 * program binds itself is its own, as every rewrite treats one. A source the parser refuses is left
 * to the compiler, which reports it with its own position. A program that only names a chain's
 * contracts (`Ethereum.UniswapV3.Factory`) never reaches the parser: the text check needs a chain
 * name followed by `(` or `.hop(`.
 */
export function refuseIntentSyntax(source: string, chains: ReadonlyMap<string, unknown>): void {
  let hint = hints.get(chains);
  if (hint === undefined) {
    hint = new RegExp(`\\b(?:${[...chains.keys()].join("|")})\\s*(?:\\.\\s*hop\\s*)?\\(`);
    hints.set(chains, hint);
  }
  if (!hint.test(source)) return;

  let program: AstNode;
  try {
    program = parseSauce(source);
  } catch {
    return;
  }
  const own = collectDeclaredNames(program);
  const isChain = (node: unknown): node is AstNode & { name: string } =>
    (node as AstNode | undefined)?.type === "Identifier" &&
    chains.has((node as { name: string }).name) &&
    !own.has((node as { name: string }).name);
  let found: { site: string; start: number } | undefined;
  walk(program, (node) => {
    if (found !== undefined || node.type !== "CallExpression") return;
    const callee = node.callee as AstNode & {
      object?: unknown;
      property?: { type: string; name?: string };
      computed?: boolean;
    };
    if (isChain(callee)) {
      found = { site: `\`${callee.name}(…)\``, start: node.start };
    } else if (
      callee.type === "MemberExpression" &&
      callee.computed !== true &&
      isChain(callee.object) &&
      callee.property?.type === "Identifier" &&
      callee.property.name === "hop"
    ) {
      found = { site: `\`${callee.object.name}.hop(…)\``, start: node.start };
    }
  });
  if (found === undefined) return;
  const line = source.slice(0, found.start).split("\n").length;

  throw new IntentsComingSoonError(`${found.site} at line ${line}`);
}
