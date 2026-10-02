/**
 * `Arbitrum.Portal.send(reward).receive(delivery).then(() => { body })` — an intent opened from
 * inside a program — read off the parser's tree.
 *
 * The expression names an intent's parts in the order they happen: what the program pays (`send`,
 * the reward, escrowed on the chain the program runs on), what the solver delivers on the
 * destination (`receive`), and what runs there with it (`then`, the body). Each of the first two
 * may be followed by modifiers that set what has a default otherwise:
 *
 * ```js
 * Arbitrum.Portal.send({ token: USDC, amount }).creator(owner).deadline(refundFrom).prover(p)
 *   .receive({ token: USDC, amount }).deadline(fillBy).salt(s).fee(f)
 *   .then(() => { ... });
 * ```
 *
 * The modifiers after `send` are the reward's ({@link REWARD_MODIFIERS}), those after `receive` the
 * route's ({@link ROUTE_MODIFIERS}); within a stage they come in any order, each at most once.
 * `intent-sugar.ts` lowers the expression; the CLI reads the same parts to tell which chain each name
 * in a file resolves on. An expression that stops before its body, takes its steps out of order,
 * repeats or misplaces a modifier, or is used as a value is refused by name
 * ({@link portalChainProblem}) rather than read as something else.
 */
import { walk, type AstNode } from "./ast-walk.js";
import {
  INTENT_STAGES,
  REWARD_MODIFIERS,
  ROUTE_MODIFIERS,
  type RewardModifier,
  type RouteModifier,
} from "./intent-syntax.js";

export { REWARD_MODIFIERS, ROUTE_MODIFIERS, type RewardModifier, type RouteModifier };

/**
 * How long an intent may be filled for, by default: Eco's solver quotes a route deadline five
 * minutes past the quote (`fulfillmentWindowSeconds`, 300 in its production configuration), and
 * Eco's Portal app publishes that deadline as quoted.
 */
export const DEFAULT_FILL_WINDOW = 300n;
/**
 * How long after the route's deadline the reward stays escrowed before an unproven one may be
 * refunded, by default: seven days, the floor Eco's solver holds every reward deadline to
 * (`reward.deadline >= route.deadline + 7 days`), so a shorter one is an intent it does not fill.
 */
export const DEFAULT_REFUND_WINDOW = 604_800n;

/**
 * A route salt for an intent that names none: 32 random bytes, picked when it is built, as Eco's
 * Portal app picks one for every intent. A fixed default would make two otherwise identical intents
 * one hash, which only the first publication could use. The `sauce` command picks one per command
 * and hands it to every compile it makes, so what it rehearses is what it publishes.
 */
export function randomSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);

  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** One call of the chain: its method and its arguments, as written. */
export interface PortalStep {
  readonly method: string;
  readonly args: readonly AstNode[];
  /** The call node. */
  readonly node: AstNode;
}

/** A `<Chain>.Portal.….then(...)` expression, as the parser read it. */
export interface PortalIntent {
  /** The chain accessor it starts from: `Arbitrum`. */
  readonly chainName: string;
  /** The whole expression: the `.then(...)` call. */
  readonly call: AstNode;
  /** Every call from `send` to `then`, in source order. */
  readonly steps: readonly PortalStep[];
  /** The arguments of `send`, `receive` and `then`. */
  readonly send: readonly AstNode[];
  readonly receive: readonly AstNode[];
  readonly then: readonly AstNode[];
  /** Each modifier's argument, by stage; a malformed chain is {@link portalChainProblem}'s. */
  readonly reward: ReadonlyMap<RewardModifier, AstNode>;
  readonly route: ReadonlyMap<RouteModifier, AstNode>;
}

const name = (node: AstNode | undefined): string | undefined =>
  node?.type === "Identifier" ? (node as unknown as { name: string }).name : undefined;

/** `node` as `<object>.<method>(...)`: the object, the method and the arguments, or `undefined`. */
function methodCall(
  node: AstNode | undefined,
): { readonly object: AstNode; readonly method: string; readonly args: AstNode[] } | undefined {
  if (node?.type !== "CallExpression") return undefined;
  const callee = (node as { callee?: AstNode }).callee;
  if (callee?.type !== "MemberExpression" || (callee as { computed?: boolean }).computed) {
    return undefined;
  }
  const method = name((callee as { property?: AstNode }).property);
  if (method === undefined) return undefined;

  return {
    object: (callee as { object?: AstNode }).object!,
    method,
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

/** The calls on `<Identifier>.Portal` that end at `node`, in source order, or `undefined` when
 *  `node` is not the outermost call of such a chain. */
function stepsTo(node: AstNode): { chainName: string; steps: PortalStep[] } | undefined {
  const steps: PortalStep[] = [];
  let current: AstNode | undefined = node;
  for (;;) {
    const call = methodCall(current);
    if (call === undefined) return undefined;
    steps.unshift({ method: call.method, args: call.args, node: current! });
    const chainName = portalOf(call.object);
    if (chainName !== undefined) return { chainName, steps };
    current = call.object;
  }
}

/**
 * `node` as a `<Identifier>.Portal.send(...)…receive(...)….then(...)`, or `undefined`. The shape
 * only: whether the identifier is a chain, what the arguments hold, and whether the modifiers are in
 * their places is the caller's to decide ({@link portalChainProblem} does the last).
 */
export function portalIntent(node: AstNode): PortalIntent | undefined {
  const found = stepsTo(node);
  if (found === undefined) return undefined;
  const { chainName, steps } = found;
  if (steps[0]?.method !== "send" || steps.at(-1)?.method !== "then") return undefined;
  const receiveAt = steps.findIndex((step) => step.method === "receive");
  if (receiveAt < 0) return undefined;
  const reward = new Map<RewardModifier, AstNode>();
  const route = new Map<RouteModifier, AstNode>();
  steps.forEach((step, i) => {
    const [argument] = step.args;
    if (argument === undefined) return;
    if (i > 0 && i < receiveAt && (REWARD_MODIFIERS as readonly string[]).includes(step.method)) {
      reward.set(step.method as RewardModifier, argument);
    }
    if (i > receiveAt && (ROUTE_MODIFIERS as readonly string[]).includes(step.method)) {
      route.set(step.method as RouteModifier, argument);
    }
  });

  return {
    chainName,
    call: node,
    steps,
    send: steps[0].args,
    receive: steps[receiveAt]!.args,
    then: steps.at(-1)!.args,
    reward,
    route,
  };
}

const list = (names: readonly string[]): string => names.map((n) => `\`.${n}(...)\``).join(", ");

/**
 * What is wrong with the calls of one `<chainName>.Portal` chain, as a message for its author;
 * `undefined` when they are an intent: `send`, its modifiers, `receive`, its modifiers, `then`, each
 * modifier once and with one argument.
 */
function stepsProblem(
  chainName: string,
  slug: string,
  methods: readonly string[],
): string | undefined {
  const form = `\`${chainName}.Portal.send({ token, amount }).receive({ token, amount }).then(() => { … })\``;
  if (methods[0] !== "send") {
    return (
      `\`${chainName}.Portal\` opens an intent on ${slug}, written ${form}. It starts with ` +
      "`.send(...)`: what this program pays the solver."
    );
  }
  const receiveAt = methods.indexOf("receive");
  const thenAt = methods.indexOf("then");
  // Where the chain stops, in the table's words.
  const unfinished = (stage: "Sent" | "Received", written: string): string =>
    `\`${chainName}.Portal.${written}\` ${INTENT_STAGES[stage].unfinished.replace("{destination}", slug)}`;
  if (receiveAt < 0) return `${unfinished("Sent", "send(...)")}: ${form}.`;
  if (thenAt < 0) return `${unfinished("Received", "send(...).receive(...)")}.`;
  if (thenAt !== methods.length - 1) {
    return `\`.then(...)\` ends the intent: nothing follows it (\`.${methods[thenAt + 1]}(...)\` does).`;
  }
  if (methods.indexOf("receive", receiveAt + 1) > 0 || methods.indexOf("send", 1) > 0) {
    return `an intent has one \`.send(...)\` and one \`.receive(...)\`, in that order`;
  }
  const stages = [
    { at: [1, receiveAt], after: "send", allowed: REWARD_MODIFIERS, other: ROUTE_MODIFIERS },
    {
      at: [receiveAt + 1, thenAt],
      after: "receive",
      allowed: ROUTE_MODIFIERS,
      other: REWARD_MODIFIERS,
    },
  ] as const;
  for (const stage of stages) {
    const seen = new Set<string>();
    for (const method of methods.slice(stage.at[0], stage.at[1])) {
      if (!(stage.allowed as readonly string[]).includes(method)) {
        return (stage.other as readonly string[]).includes(method)
          ? `\`.${method}(...)\` is not set after \`.${stage.after}(...)\`: after \`.send(...)\` ` +
              `come ${list(REWARD_MODIFIERS)} (the reward's), after \`.receive(...)\` ` +
              `${list(ROUTE_MODIFIERS)} (the route's)`
          : `\`.${method}(...)\` is not a step of an intent. After \`.send(...)\` come ` +
              `${list(REWARD_MODIFIERS)}, after \`.receive(...)\` ${list(ROUTE_MODIFIERS)}`;
      }
      if (seen.has(method)) {
        return `\`.${method}(...)\` is given twice after \`.${stage.after}(...)\`: give it once`;
      }
      seen.add(method);
    }
  }

  return undefined;
}

/**
 * The first `<Chain>.Portal` in `program` that does not open an intent — one that stops before its
 * body, takes its steps out of order, repeats or misplaces a modifier, gives a step other than one
 * argument, or is used as a value — worded for the person who wrote it; `undefined` when every one
 * is a complete statement. `chainSlug` names the chain an identifier accesses, and `undefined` for
 * one that is not a chain.
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

  /** The call `<node>.<method>(...)` when `node` is the object of one: its method and the call. */
  const next = (node: AstNode): { method: string; call: AstNode } | undefined => {
    const member = parents.get(node);
    if (member?.type !== "MemberExpression" || (member as { object?: AstNode }).object !== node) {
      return undefined;
    }
    const method = name((member as { property?: AstNode }).property);
    const call = parents.get(member);
    return method !== undefined &&
      call?.type === "CallExpression" &&
      (call as { callee?: AstNode }).callee === member
      ? { method, call }
      : undefined;
  };

  for (const { node, chainName, slug } of portals) {
    const calls: { method: string; call: AstNode }[] = [];
    for (let step = next(node); step !== undefined; step = next(step.call)) calls.push(step);
    const problem = stepsProblem(
      chainName,
      slug,
      calls.map((call) => call.method),
    );
    if (problem !== undefined) return problem;
    for (const { method, call } of calls) {
      const count = ((call as { arguments?: AstNode[] }).arguments ?? []).length;
      if (count !== 1 && method !== "send" && method !== "receive" && method !== "then") {
        return `\`.${method}(...)\` takes one argument, got ${count}`;
      }
    }
    if (parents.get(calls.at(-1)!.call)?.type !== "ExpressionStatement") {
      return (
        `\`${chainName}.Portal.send(...).receive(...).then(...)\` is a statement of its own: it ` +
        "opens the intent and returns nothing to use."
      );
    }
  }

  return undefined;
}
