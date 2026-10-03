/**
 * `<Chain>.Portal.send(…).receive(…).then(() => { … })` — an Eco intent opened from inside a Sauce
 * program, built on the compiler's host API rather than on the program's text.
 *
 * ```js
 * function main(owner: Address) {
 *   const amount = USDC.balanceOf(ctx.self());
 *   Arbitrum.Portal.send({ token: USDC, amount })
 *     .refundee(owner)
 *     .receive({ token: USDC, amount: (amount * 99) / 100 })
 *     .then(() => {
 *       USDC.transfer(RECIPIENT, (amount * 99) / 100);
 *     });
 * }
 * ```
 *
 * THE SYNTAX IS A TABLE. `intent-syntax.ts#INTENT_STAGES` lists every stage of the chain, the
 * methods each has, what each takes and returns, and the option a modifier sets; each stage is a
 * host type of that name here, and each parameter's `kind` is what the compiler is told of it.
 *
 * WHAT THE COMPILER IS TOLD. `<Chain>.Portal` is a constant of the `Portal` type, its value the
 * destination's chain id. `send` (the reward, paid here) and `receive` (what the solver delivers
 * there) make records, each taking any number of items as arguments of its own (`rest`) — a token
 * amount or a list of them, and for the reward the native coin. After each, its stage's modifiers —
 * `refundee`, `deadline` and `prover` after `send`, `deadline`, `salt` and `fee` after `receive` —
 * return the record they are called on, so the chain is one record of everything in it, which the
 * compiler shows `nested` and `bind` call by call, each by its callee (`Sent.deadline` is not
 * `Received.deadline`). `receive`'s items are evaluated here but named on the destination
 * (`scope: "nested"`, its scope picked from the record's chain). `receive` is required, `.receive()`
 * naming nothing. `then` takes a PROGRAM: its closure is compiled as a program of its own in the
 * scope `nested` returns for that chain — the destination's names, its target, its own intents —
 * and what it reads of the enclosing program reaches it as entry arguments. A closure of nothing
 * but token `transfer`/`approve` calls is RECORDED instead: there is no program, only the calls,
 * which become the route's own. `.before(() => { … })` and `.after(() => { … })`, any number of
 * each among the route's modifiers, are HOOKS: closures that are only ever recorded, their calls
 * the route's around the body's, and refused when the compiler had to compile one instead. Each is
 * a part of the record, so their order survives; their names resolve on the destination, and a
 * Solana destination is refused before one is read. `.catch((e) => { … })` after it HANDLES the
 * body: the compiler builds the two as one program, `try { <body> } catch (e) { <handler> }`. The
 * chain's last record is bound at its site, so the compiler hands `bind` what it knows there — the
 * chain, the reward, the delivery, the modifiers, the hooks, the program or the recorded calls —
 * and calls `@sauce/intents` with what `bind` returns. A chain that stops before `receive` or
 * `then` is refused in the table's words.
 *
 * WHAT `bind` DOES. It builds the intent: the route's calls (the `before` hooks' calls, then each
 * recorded write or the delivered tokens' transfers into the Pot then its `cook`, then the `after`
 * hooks'), the reward, the deadlines, the creator, the prover, the Portals on both sides. A value
 * known only while the enclosing program runs is a sentinel in the encoding, and each place it
 * lands is a SPLICE, so the program writes the value there when it runs. No source is generated
 * and nothing is parsed.
 *
 * WHAT IS LEFT OUT, as Eco's Portal app fills it: the route's deadline five minutes past when the
 * intent opens, the reward's seven days past the route's (`intent-defaults.ts`), the registry's
 * prover, a random salt. An intent opens when the compile says (`openedAt`), which makes those
 * deadlines known when it is built; else when the program opening it runs, and `@sauce/intents`
 * writes them from the block's time (a STAMP). The refundee, the reward's `creator`, has no
 * default but one: the wallet that publishes a top-level intent itself (`publisher`). Every intent
 * a program opens names its own, since the Pot it runs on may be shared and a refund there could go
 * to anyone.
 *
 * WHICH CHAIN A NAME MEANS. The body and the delivery are the destination's, the reward and the
 * modifiers the enclosing chain's, where it is escrowed. That is the compiler's scoping now: the
 * body compiles in the destination's scope, the delivery is a `nested` value, and the rest
 * ordinary ones.
 */
import type {
  BoundArgument,
  CallSite,
  Declaration,
  HostType,
  Param,
  ProgramOptions,
  ProgramReport,
  ProgramSite,
  RecordedCall,
  Signature,
  View,
} from "sauce-compiler";
import { bytesToHex, encodeFunctionData, hexToBytes, type Hex } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { ERC20ABI } from "../protocols/erc20/abis.js";
import {
  ecoRoutesPortal,
  ecoRoutesProver,
  type EcoRoutesSelector,
} from "../protocols/eco-routes/lookup.js";
import { denormalizeToEvm } from "./encode.js";
import { rewardAssetsConflict } from "./intent.js";
import { resolveIntentPot } from "./intent-pot.js";
import { normalizeReward, normalizeRoute, toUniversalAddress } from "./normalize.js";
import {
  INTENT_FUND_VIA,
  intentVaultAddressCall,
  publishAndFundTx,
  publishTx,
  type IntentFundVia,
} from "./portal.js";
import { buildSauceEvmCall } from "./sauce-calls.js";
import { DEFAULT_FILL_WINDOW, DEFAULT_REFUND_WINDOW, randomSalt } from "./intent-defaults.js";
import {
  INTENT_STAGES,
  REWARD_MODIFIERS,
  ROUTE_HOOKS,
  ROUTE_MODIFIERS,
  type IntentMethod,
  type IntentParam,
  type IntentStage,
  type RouteHook,
} from "./intent-syntax.js";
import type { AddressInput, Intent } from "./types.js";

/** What every intent a program opens takes when it does not name its own, and what the SDK cannot
 *  look up. Each modifier an intent is written with wins over its field here. */
export interface IntentSugarDefaults {
  /** The route's deadline, absolute Unix seconds, for every intent the program opens at any depth.
   *  Left out: {@link DEFAULT_FILL_WINDOW} past when the intent opens. */
  readonly deadline?: bigint;
  /** The reward's deadline. Left out: the route's deadline plus {@link DEFAULT_REFUND_WINDOW}. */
  readonly rewardDeadline?: bigint;
  /** When the program's own intents open, Unix seconds: the default deadlines count from it, so
   *  they are fixed when the file compiles, as a wallet that publishes them needs. A level below
   *  opens when its parent's body runs, at the block's time; so does every level when this is left
   *  out. */
  readonly openedAt?: bigint;
  /**
   * The wallet that publishes the program's top-level intents itself, as `sauce intent publish`
   * does: the creator of each one that names none, as Eco's Portal app makes the publishing wallet
   * the creator. It is never the creator of an intent a body opens, and a level below drops it:
   * every intent a program opens names its own `.refundee(...)`, since the Pot it runs on may be
   * shared and a refund there could go to anyone.
   */
  readonly publisher?: AddressInput;
  /** Defaults to the prover the deployment registry records for this source/destination pair. */
  readonly prover?: AddressInput;
  /** Overrides the source-chain Portal the program publishes through. */
  readonly sourcePortal?: AddressInput;
  /** Overrides the destination-chain Portal recorded in the child's route. */
  readonly destinationPortal?: AddressInput;
  /** Route salt, for every intent that names none with `.salt(...)`. Left out: 32 random bytes per
   *  intent, picked as it is built (`intent-defaults.ts#randomSalt`). */
  readonly salt?: Hex;
  /** How the program funds the reward: `"transfer"` (default) pays the vault then `publish`es;
   *  `"publishAndFund"` approves the Portal and calls `publishAndFund`. */
  readonly fundVia?: IntentFundVia;
  /** Passed to `publishAndFund` (`fundVia: "publishAndFund"` only). Default `false`. */
  readonly allowPartial?: boolean;
  /** Overrides the destination Pot a cook-based child runs on. */
  readonly pot?: AddressInput;
  /** The interpreter that Pot cooks on. Defaults to the released engine address. */
  readonly engine?: AddressInput;
  /** The destination Kitchen's current execution fee, in wei, paid on every cook: one for every
   *  destination, or each destination's own. Required for a cook-based child, unless it is given
   *  `.fee(...)`: it is read from the chain and it changes. */
  readonly executionFee?: bigint | ((destination: CanonicalChain) => bigint | undefined);
}

export interface LoweredIntent {
  /** The child as encoded, with a sentinel wherever a run-time value belongs. */
  readonly intent: Intent;
  /** What the program supplies as it runs, in first-seen order: each value of the enclosing program
   *  spliced into it, then a deadline written from the block's time. None: it is fixed now. */
  readonly captures: readonly string[];
  /** Each sentinel the encoded child carries, and the local whose value replaces it on chain. */
  readonly sentinels: readonly { readonly sentinel: bigint; readonly capture: string }[];
  readonly destination: CanonicalChain;
  /** How the program funds it: by transfer to its vault then `publish`, or `publishAndFund`. */
  readonly fundVia: IntentFundVia;
}

/** One level of intents: a program on `source`, opening intents to other chains. */
export interface IntentLevel {
  readonly source: CanonicalChain;
  /** Chain accessor name (`Base`) -> chain. Only these names open an intent. */
  readonly chains: ReadonlyMap<string, CanonicalChain>;
  readonly defaults: Partial<IntentSugarDefaults> & EcoRoutesSelector;
  /** The options a body on `destination` compiles with: its names, target, defines, intents. */
  readonly programOn: (destination: CanonicalChain) => ProgramOptions;
  /** Every intent this level lowers, in the order the compiler binds them. */
  readonly lowered: LoweredIntent[];
}

class SugarError extends Error {}

const fail = (message: string): never => {
  throw new SugarError(`intent sugar: ${message}`);
};

const INTENTS = "@sauce/intents";

/** Where a chain of calls stops short, in the table's words. */
const unfinished = (stage: "Sent" | "Received", written: string): string =>
  `\`<Chain>.Portal.${written}\` ${INTENT_STAGES[stage].unfinished.replace("{destination}", "its destination")}`;

/** The refusal of a chain that skips what the solver delivers. */
const NEEDS_A_DELIVERY = unfinished("Sent", "send(...)");

/** The hook a program argument's site is, `Received.before` or `Received.after`; else nothing. */
const hookOf = (callee: string): RouteHook | undefined =>
  ROUTE_HOOKS.find((hook) => callee === `Received.${hook}`);

/** Why a hook the compiler could not record is refused: it is calls, never a program. */
const hookNotRecorded = (hook: RouteHook): string =>
  `\`.${hook}(...)\` records calls for the Portal's Executor to make, and is never compiled: ` +
  "each of its statements must be a call of a token, `USDC.approve(spender, amount)` or " +
  "`Token(address).transfer(to, amount)`, whose arguments are literals, names or variables of " +
  "the program. Compute a value before the intent opens, and pass the variable.";

/** One of a route's calls, as the Executor makes it. */
type RouteCall = { target: Hex; data: Hex; value: bigint };

/** Why an intent with no `.refundee(...)` is refused: no default is safe for one a program
 *  opens. */
const UNNAMED_CREATOR =
  "an intent opened by a program needs `.refundee(<address>)` after `.send(...)`: the address an " +
  "unfilled intent's reward is refunded to. The Pot a program runs on may be shared, so a refund " +
  "there is one anyone can take: name the owner, or an address the program is given " +
  "(`.refundee(refundTo)`). Only a top-level intent a wallet publishes itself (`sauce intent " +
  "publish`, or `intents.publisher` in the compile options) takes that wallet as its creator.";

/**
 * One sentinel per run-time value of a site. TWENTY bytes, so the same sentinel is a legal
 * `uint256` and a legal `address` when viem encodes the call; the trailing index keeps them apart.
 */
const CAPTURE_TAG = "5acecab7";
const sentinelOf = (id: number): bigint =>
  BigInt(`0x${CAPTURE_TAG}${"00".repeat(14)}${id.toString(16).padStart(4, "0")}`);

/**
 * The sentinel a deadline occupies, which is a `uint64`: eight bytes, the tag, zeros, an index —
 * a run-time value's (`runtime`) or a stamp's. In the payload either is one left-padded word, which
 * is what the splice or the stamp writes.
 */
const DEADLINE_TAG = "5aced1";
const deadlineSentinelOf = (id: number): bigint =>
  BigInt(`0x${DEADLINE_TAG}${"00".repeat(3)}${id.toString(16).padStart(4, "0")}`);

const addressHex = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;
const wordOf = (value: bigint): Uint8Array =>
  hexToBytes(`0x${value.toString(16).padStart(64, "0")}`);

/** A value of a site: known now, or one of its run-time values. */
type Value = { readonly literal: bigint } | { readonly runtime: number; readonly name?: string };

/** A deadline: a value, or a STAMP `@sauce/intents` writes as the program runs — the block's time,
 *  or the route's deadline, plus `seconds`. */
type Deadline =
  Value | { readonly stamp: number; readonly from: "now" | "route"; readonly seconds: bigint };

/** Where a stage begins, as a refusal names it: after the step of another stage that returns
 *  it. */
function stageEntry(stage: IntentStage): string {
  for (const [from, spec] of Object.entries(INTENT_STAGES)) {
    if (from === stage) continue;
    for (const [name, method] of Object.entries(
      spec.methods as Readonly<Record<string, IntentMethod>>,
    )) {
      if (method.returns === stage && method.option === undefined) return `after \`.${name}(...)\``;
    }
  }
  return "on a chain's `Portal`";
}

/**
 * A step an intent's stage does not have — an old name after `send`, say — reported with the
 * steps that stage takes, from the compiler's own diagnostic (`HostMethodUnknown`, which names the
 * stage's host type and the method).
 */
export function intentStepError(cause: unknown): Error | undefined {
  const diagnostics =
    (cause as { diagnostics?: readonly { code?: string; message?: string }[] } | undefined)
      ?.diagnostics ?? [];
  for (const { code, message } of diagnostics) {
    if (code !== "HostMethodUnknown") continue;
    const [, stage, method] = /^`(\w+)` has no method `(\w+)`$/.exec(message ?? "") ?? [];
    if (stage === undefined || !Object.hasOwn(INTENT_STAGES, stage)) continue;
    const steps = Object.keys(INTENT_STAGES[stage as IntentStage].methods).map(
      (name) => `\`.${name}(...)\``,
    );
    const takes =
      steps.length === 0
        ? "nothing follows it"
        : steps.length === 1
          ? `its one step is ${steps[0]}`
          : `its steps are ${steps.slice(0, -1).join(", ")} and ${steps.at(-1)}`;

    return new Error(
      `compileSauceRoute: \`.${method}(...)\` is not a step ${stageEntry(stage as IntentStage)}: ` +
        `${takes}. The compiler reported: ${message}`,
      { cause },
    );
  }

  return undefined;
}

/** The declarations, types and callbacks that open intents from a program on `level.source`. */
export function intentHost(level: IntentLevel): {
  readonly declare: (name: string) => Declaration | undefined;
  readonly types: Record<string, HostType>;
  readonly hostModules: string[];
  readonly nested: (site: ProgramSite) => ProgramOptions;
  readonly bind: (site: CallSite) => BoundArgument[];
} {
  const fundVia = requireFundVia(level.defaults);
  const publish = {
    module: INTENTS,
    export: fundVia === "transfer" ? "publish" : "publishAndFund",
  };
  const types = intentTypes(publish);
  const byId = new Map([...level.chains.values()].map((chain) => [BigInt(chain.id), chain]));

  const declare = (name: string): Declaration | undefined => {
    const [accessor, member, ...rest] = name.split(".");
    if (member !== "Portal" || rest.length > 0) return undefined;
    const chain = level.chains.get(accessor!);
    if (chain === undefined) return undefined;

    return { kind: "constant", value: String(chain.id), type: "Portal" };
  };

  /** The chain a record's intent goes to: the `Portal` its first call was made on. */
  const destinationOf = (record: View | undefined, what: string): CanonicalChain => {
    const portal = recordOf(record, what).receiver;
    const chain =
      portal !== undefined && "constant" in portal ? byId.get(BigInt(portal.constant)) : undefined;

    return chain ?? fail(`${what} does not start from a chain's \`Portal\``);
  };

  const nested = (site: ProgramSite): ProgramOptions => {
    if (site.callee === "Sent.then") return fail(NEEDS_A_DELIVERY);
    const destination = destinationOf(site.receiver, `\`${site.callee}\``);
    const hook = hookOf(site.callee);
    // Refused before its closure is read: a Solana route call carries accounts a recorded call
    // has nowhere to name.
    if (hook !== undefined && destination.kind !== "evm") {
      return fail(
        `\`.${hook}(...)\` adds calls the Portal's Executor makes on an EVM destination; ` +
          `${destination.slug}'s route calls name their accounts, which a hook has nowhere to give`,
      );
    }

    return level.programOn(destination);
  };

  const bind = (site: CallSite): BoundArgument[] => {
    if (site.callee !== "Opened" && site.callee !== "Caught") {
      return fail(`'${site.callee}' is not an intent's publication`);
    }

    return bindIntent(level, destinationOf(site.receiver, "the intent"), fundVia, site);
  };

  return { declare, types, hostModules: [INTENTS], nested, bind };
}

/** What each kind of parameter the table names tells the compiler. */
function hostParam(param: IntentParam): Param {
  switch (param.kind) {
    case "value":
      return { kind: "value" };
    case "nested":
      return { kind: "value", scope: "nested" };
    case "program":
      // A body of nothing but token writes is recorded: its calls become the route's own.
      return { kind: "program", record: true };
    case "handler":
      return { kind: "handler" };
    case "hook":
      // Recorded too, and only that: a hook the compiler had to compile is refused (`bind`).
      return { kind: "program", record: true };
  }
}

/**
 * The host types of an intent: one per stage of `INTENT_STAGES`, each method as the table writes
 * it. An opened intent ends where its publication is called (`publish`), a chain that stops short
 * is refused in the table's words, and `then` straight after `send` is declared only to be refused
 * so (`nested`), where the compiler would otherwise call it a method the type does not have.
 */
function intentTypes(publish: { readonly module: string; readonly export: string }) {
  const stages = INTENT_STAGES as unknown as Readonly<
    Record<IntentStage, { readonly methods: Readonly<Record<string, IntentMethod>> }>
  >;
  const methodsOf = (stage: IntentStage): Record<string, Signature> =>
    Object.fromEntries(
      Object.entries(stages[stage].methods).map(([name, method]) => [
        name,
        {
          params: method.params.map(hostParam),
          ...(method.params.some((param) => param.rest === true) ? { rest: true } : {}),
          returns: method.returns,
        } satisfies Signature,
      ]),
    );
  const ending = { calls: publish, site: true };
  const types: Record<string, HostType> = {
    Portal: { of: "Uint256", methods: methodsOf("Portal") },
    Sent: {
      methods: { ...methodsOf("Sent"), then: methodsOf("Received").then! },
      ending: { refused: NEEDS_A_DELIVERY },
    },
    Received: {
      methods: methodsOf("Received"),
      ending: { refused: unfinished("Received", "send(...).receive(...)") },
    },
    Opened: { methods: methodsOf("Opened"), ending },
    Caught: { ending },
  };

  return types;
}

/** The publication's arguments, for `@sauce/intents#publish` or `#publishAndFund`: the record a
 *  chain built — its `Portal`, the reward and its modifiers, the delivery and the route's, then the
 *  body. */
function bindIntent(
  level: IntentLevel,
  destination: CanonicalChain,
  fundVia: IntentFundVia,
  site: CallSite,
): BoundArgument[] {
  const { defaults, source } = level;
  // Every run-time value of the site is one sentinel, wherever it lands.
  const runtimes = new Map<number, string | undefined>();
  const valueOf = (view: View | undefined, what: string): Value => {
    // Every value of an intent is a word it encodes as a number or an address: a comparison's
    // `true` is neither.
    if (view !== undefined && "type" in view && view.type === "bool") {
      return fail(`${what} is a \`bool\`: an intent's values are amounts, addresses and seconds`);
    }
    if (view !== undefined && "constant" in view) return { literal: BigInt(view.constant) };
    if (view !== undefined && "runtime" in view) {
      // A local is named by its name; a value computed in place, by what it is in the intent.
      const name = view.name ?? runtimes.get(view.runtime) ?? what;
      runtimes.set(view.runtime, name);
      return { runtime: view.runtime, name };
    }
    return fail(`${what} must be a value: a literal, a define or a variable of the program`);
  };
  const sentinelFor = (value: Value): bigint =>
    "literal" in value ? value.literal : sentinelOf(value.runtime);

  // Each call of the chain, by its callee: `Sent.deadline` is the reward's, `Received.deadline`
  // the route's. A modifier is given at most once.
  const { parts } = recordOf(site.receiver, "the intent");
  const argumentsOf = (callee: string) => parts.find((part) => part.callee === callee)?.args;
  for (const [stage, after, modifiers] of [
    ["Sent", "send", REWARD_MODIFIERS],
    ["Received", "receive", ROUTE_MODIFIERS],
  ] as const) {
    for (const modifier of modifiers) {
      const given = parts.filter((part) => part.callee === `${stage}.${modifier}`).length;
      if (given > 1)
        fail(`\`.${modifier}(...)\` is given twice after \`.${after}(...)\`: give it once`);
    }
  }
  const modifier = (callee: string, what: string): Value | undefined => {
    const args = argumentsOf(callee);
    return args === undefined ? undefined : valueOf(args[0], what);
  };
  const body = argumentsOf("Received.then")?.[0];
  const rewardItems = argumentsOf("Portal.send") ?? fail("`.send(...)` names the reward");
  // `.receive()` names nothing: a token-only body's delivery is then what its transfers move.
  const deliveryItems = argumentsOf("Sent.receive") ?? [];
  const explicitDelivery =
    deliveryItems.length === 0
      ? undefined
      : tokenList(deliveryItems, { part: "delivery", chain: destination }, valueOf).tokens;

  // The reward's creator: named, or, for a top-level intent a wallet publishes itself, that
  // wallet. Refused before anything is built for the body when it is neither.
  const creator = modifier("Sent.refundee", "`.refundee(...)`");
  if (creator === undefined && defaults.publisher === undefined) fail(UNNAMED_CREATOR);
  // The Kitchen fee the body's cook pays on this intent's destination: `.fee(...)`, else the
  // compile's for that destination. A fee is in the route's encoding and in the call's value, so
  // it is known when the intent is built.
  const feeValue = modifier("Received.fee", "`.fee(...)`");
  if (feeValue !== undefined && !("literal" in feeValue)) {
    fail(
      "`.fee(...)` is the destination Kitchen's fee, which the intent is built with: a literal or " +
        "a compile-time value, not a value the program computes as it runs",
    );
  }
  // Asked for only where a cook pays it: a body that is a program.
  const feeFor = (): bigint | undefined =>
    feeValue !== undefined && "literal" in feeValue
      ? feeValue.literal
      : typeof defaults.executionFee === "function"
        ? defaults.executionFee(destination)
        : defaults.executionFee;

  const destinationPortal = defaults.destinationPortal ?? ecoRoutesPortal(destination, defaults);
  const derivedDelivery: { token: bigint; amount: Value }[] = [];
  const tokenCall = (target: bigint, method: "transfer" | "approve", args: readonly Value[]) => ({
    target: addressHex(target),
    data: encodeFunctionData({
      abi: ERC20ABI,
      functionName: method,
      args: [addressHex(sentinelFor(args[0]!)), sentinelFor(args[1]!)] as never,
    }),
    value: 0n,
  });

  // Recorded calls — a body of token writes, or a hook — are the route's own calls, run by the
  // Portal's Executor: not a program, so the Executor's checks rather than SafeERC20's. Every
  // approve is reset to zero first, for a token (USDT) that refuses to move a standing allowance:
  // one Executor runs every intent on a chain. What each transfer moves is the delivery when
  // `.receive()` names none, since it is the Executor's to spend.
  const recordedCalls = (recorded: readonly RecordedCall[]): RouteCall[] =>
    recorded.flatMap((call) => {
      const method = call.callee.split(".")[1];
      if (method !== "transfer" && method !== "approve") {
        return fail(`\`.${method}(...)\` cannot become a route call`);
      }
      const token = valueOf(call.receiver, "a token");
      if (!("literal" in token)) {
        return fail(
          "a token address must be known when the intent is built, not captured at run time",
        );
      }
      const args = call.args.map((arg, i) =>
        valueOf(arg, `argument ${i + 1} of \`.${method}(...)\``),
      );
      if (method === "transfer" && explicitDelivery === undefined) {
        derivedDelivery.push({ token: token.literal, amount: args[1]! });
      }
      const amount = args[1]!;
      const reset =
        method === "approve" && !("literal" in amount && amount.literal === 0n)
          ? [tokenCall(token.literal, "approve", [args[0]!, { literal: 0n }])]
          : [];

      return [...reset, tokenCall(token.literal, method, args)];
    });
  // Each hook's calls, its closures in the order written: recorded, never compiled.
  const hookCalls = (hook: RouteHook): RouteCall[] =>
    parts
      .filter((part) => part.callee === `Received.${hook}`)
      .flatMap((part) => {
        const [closure] = part.args;
        return closure !== undefined && "recorded" in closure
          ? recordedCalls(closure.recorded)
          : fail(hookNotRecorded(hook));
      });

  const before = hookCalls("before");
  let bodyCalls: RouteCall[];
  if (body !== undefined && "recorded" in body) {
    bodyCalls = recordedCalls(body.recorded);
  } else if (body !== undefined && "program" in body) {
    bodyCalls = programCalls(
      level,
      body.program,
      destinationPortal,
      explicitDelivery,
      feeFor(),
      sentinelFor,
      runtimes,
    );
  } else {
    return fail("an intent's body must be a closure");
  }
  const calls = [...before, ...bodyCalls, ...hookCalls("after")];

  const rewardSpec = tokenList(rewardItems, { part: "reward", chain: source }, valueOf);
  const offersNative =
    rewardSpec.nativeAmount !== undefined &&
    !("literal" in rewardSpec.nativeAmount && rewardSpec.nativeAmount.literal === 0n);
  const conflict = rewardAssetsConflict(
    source.id,
    offersNative,
    rewardSpec.tokens.map((t) => addressHex(t.token)),
  );
  if (conflict !== undefined) fail(conflict);

  // The deadlines, as Eco's Portal app fills them when left out: the route's DEFAULT_FILL_WINDOW
  // past when the intent opens, the reward's DEFAULT_REFUND_WINDOW past the route's. An intent
  // opens when the compile says (`openedAt`), else as the program opening it runs: a STAMP.
  let stamps = 0;
  const stamp = (from: "now" | "route", seconds: bigint): Deadline => ({
    stamp: stamps++,
    from,
    seconds,
  });
  const routeDeadline: Deadline =
    modifier("Received.deadline", "the route's `.deadline(...)`") ??
    (defaults.deadline !== undefined
      ? { literal: defaults.deadline }
      : defaults.openedAt !== undefined
        ? { literal: defaults.openedAt + DEFAULT_FILL_WINDOW }
        : stamp("now", DEFAULT_FILL_WINDOW));
  const rewardDeadline: Deadline =
    modifier("Sent.deadline", "the reward's `.deadline(...)`") ??
    (defaults.rewardDeadline !== undefined
      ? { literal: defaults.rewardDeadline }
      : "literal" in routeDeadline
        ? { literal: routeDeadline.literal + DEFAULT_REFUND_WINDOW }
        : stamp("route", DEFAULT_REFUND_WINDOW));
  const deadlineFor = (deadline: Deadline): bigint =>
    "literal" in deadline
      ? deadline.literal
      : "runtime" in deadline
        ? deadlineSentinelOf(deadline.runtime)
        : deadlineSentinelOf(0x8000 + deadline.stamp);
  const salt = modifier("Received.salt", "`.salt(...)`");
  const prover = modifier("Sent.prover", "`.prover(...)`");

  const child: Intent = {
    destination: BigInt(destination.id),
    sourceChainId: BigInt(source.id),
    route: normalizeRoute({
      salt:
        salt !== undefined
          ? (`0x${sentinelFor(salt).toString(16).padStart(64, "0")}` as Hex)
          : (defaults.salt ?? randomSalt()),
      deadline: deadlineFor(routeDeadline),
      portal: destinationPortal,
      nativeAmount: calls.reduce((sum, call) => sum + call.value, 0n),
      tokens: (explicitDelivery ?? derivedDelivery).map((t) => ({
        token: addressHex(t.token),
        amount: sentinelFor(t.amount),
      })),
      calls,
    }),
    reward: normalizeReward({
      deadline: deadlineFor(rewardDeadline),
      // Never the executing Pot: see `UNNAMED_CREATOR`.
      creator: creator !== undefined ? addressHex(sentinelFor(creator)) : defaults.publisher!,
      prover:
        prover !== undefined
          ? addressHex(sentinelFor(prover))
          : (defaults.prover ?? ecoRoutesProver(source, destination, defaults)),
      nativeAmount:
        rewardSpec.nativeAmount === undefined ? 0n : sentinelFor(rewardSpec.nativeAmount),
      tokens: rewardSpec.tokens.map((t) => ({
        token: addressHex(t.token),
        amount: sentinelFor(t.amount),
      })),
    }),
  };

  const sourcePortal = defaults.sourcePortal ?? ecoRoutesPortal(source, defaults);
  const tx =
    fundVia === "transfer"
      ? publishTx(child, { portal: sourcePortal })
      : publishAndFundTx(child, defaults.allowPartial ?? false, { portal: sourcePortal });
  const data = hexToBytes(tx.data);
  const deadlines = [routeDeadline, rewardDeadline].filter(
    (deadline): deadline is Extract<Value, { runtime: number }> => "runtime" in deadline,
  );
  const dataSplices = splicesIn(data, runtimes, deadlines);

  // Each stamp: where its deadline lands in the publication, where it counts from — the block's
  // time, or the route deadline's place — and the seconds it adds. 96 bytes each, as
  // `@sauce/intents` reads them.
  const placeOf = (deadline: Deadline): number => {
    const word = wordOf(deadlineFor(deadline));
    for (let at = 0; at + 32 <= data.length; at++) {
      if (word.every((byte, k) => data[at + k] === byte)) return at;
    }
    return fail("a deadline landed nowhere in the intent's encoding — a bug in the lowering");
  };
  const stamped = [routeDeadline, rewardDeadline].filter(
    (deadline): deadline is Extract<Deadline, { stamp: number }> => "stamp" in deadline,
  );
  const stampBytes = new Uint8Array(96 * stamped.length);
  stamped.forEach((deadline, i) => {
    stampBytes.set(wordOf(BigInt(placeOf(deadline))), 96 * i);
    // Zero is the block's time: no deadline sits at the selector.
    stampBytes.set(
      wordOf(deadline.from === "now" ? 0n : BigInt(placeOf(routeDeadline))),
      96 * i + 32,
    );
    stampBytes.set(wordOf(deadline.seconds), 96 * i + 64);
  });

  // The reward's entries as `@sauce/intents` reads them: token word, amount word.
  const rewards = new Uint8Array(64 * rewardSpec.tokens.length);
  const rewardSplices: { offset: number; runtime: number }[] = [];
  rewardSpec.tokens.forEach((t, i) => {
    rewards.set(wordOf(t.token), 64 * i);
    rewards.set(wordOf("literal" in t.amount ? t.amount.literal : 0n), 64 * i + 32);
    if ("runtime" in t.amount)
      rewardSplices.push({ offset: 64 * i + 32, runtime: t.amount.runtime });
  });
  const native = rewardSpec.nativeAmount;
  const nativeWord = wordOf(native !== undefined && "literal" in native ? native.literal : 0n);
  const nativeSplices =
    native !== undefined && "runtime" in native ? [{ offset: 0, runtime: native.runtime }] : [];

  const deadlineNames = new Map(
    [routeDeadline, rewardDeadline].flatMap((deadline) =>
      "stamp" in deadline
        ? [
            [
              deadlineSentinelOf(0x8000 + deadline.stamp),
              deadline.from === "now"
                ? `ctx.timestamp() + ${DEFAULT_FILL_WINDOW}`
                : `the route's deadline + ${DEFAULT_REFUND_WINDOW}`,
            ] as const,
          ]
        : "runtime" in deadline
          ? [
              [
                deadlineSentinelOf(deadline.runtime),
                deadline.name ?? `#${deadline.runtime}`,
              ] as const,
            ]
          : [],
    ),
  );
  // Every value the program supplies as it runs, a stamped deadline's included: an intent with none
  // is fixed when it is built.
  const captures = [
    ...new Set([
      ...[...runtimes].map(([id, name]) => name ?? `#${id}`),
      ...[...deadlineNames.values()],
    ]),
  ];
  level.lowered.push({
    intent: child,
    captures,
    sentinels: [
      ...[...runtimes].map(([id, name]) => ({
        sentinel: sentinelOf(id),
        capture: name ?? `#${id}`,
      })),
      ...[...deadlineNames].map(([sentinel, capture]) => ({ sentinel, capture })),
    ],
    destination,
    fundVia,
  });

  const portal = { value: denormalizeToEvm(toUniversalAddress(sourcePortal)), type: "Address" };
  const published = { bytes: data, splices: dataSplices };
  const funded = [
    { bytes: rewards, splices: rewardSplices },
    { bytes: nativeWord, splices: nativeSplices },
    { bytes: stampBytes },
  ];
  if (fundVia === "publishAndFund") return [portal, published, ...funded];

  // `intentVaultAddress` takes `publish`'s arguments exactly, so the library asks it about the very
  // bytes it publishes, with this selector in front. Held, not assumed.
  const query = intentVaultAddressCall(child, { portal: sourcePortal }).data;
  if (query.slice(10) !== tx.data.slice(10)) {
    fail(
      "intentVaultAddress and publish no longer encode the same arguments — the vault read would " +
        "ask about a different intent than the one published",
    );
  }

  return [portal, published, { bytes: hexToBytes(query.slice(0, 10) as Hex) }, ...funded];
}

/**
 * A program body's route calls: the delivered tokens moved from the Executor into the Pot, then the
 * Pot's `cook` of the program, its captures appended as the words its entry reads — each a
 * run-time value of the site, so a sentinel in the encoding.
 */
function programCalls(
  level: IntentLevel,
  program: ProgramReport,
  destinationPortal: AddressInput,
  delivery: readonly { readonly token: bigint; readonly amount: Value }[] | undefined,
  executionFee: bigint | undefined,
  sentinelFor: (value: Value) => bigint,
  runtimes: Map<number, string | undefined>,
): RouteCall[] {
  if (program.target !== "evm") {
    return fail(
      `an intent body on a Solana destination is a program for its Kitchen, which a route call does ` +
        `not issue from here yet`,
    );
  }
  const { pot, engine } = resolveIntentPot(destinationPortal, level.defaults);
  const fee =
    executionFee ??
    fail(
      "the intent runs a program, so its cook must pay that chain's Kitchen fee — give it " +
        "`.fee(...)` after `.receive(...)`, or set `intents.executionFee` " +
        "(`destinationExecutionFee()` reads it)",
    );
  const args = program.captures.map((capture) => {
    runtimes.set(capture.runtime!, capture.name);
    return wordOf(sentinelOf(capture.runtime!));
  });
  const code = new Uint8Array([...program.bytecode, ...args.flatMap((word) => [...word])]);
  const cook = buildSauceEvmCall({ pot, engine, program: bytesToHex(code), value: fee });
  const potAddress = denormalizeToEvm(toUniversalAddress(cook.target)) as Hex;

  return [
    // Delivered tokens land on the Executor; the program runs in the Pot, so move them first.
    ...(delivery ?? []).map((token) => ({
      target: addressHex(token.token),
      data: encodeFunctionData({
        abi: ERC20ABI,
        functionName: "transfer",
        args: [potAddress, sentinelFor(token.amount)] as never,
      }),
      value: 0n,
    })),
    { target: potAddress, data: cook.data, value: fee },
  ];
}

/** Each place a run-time value's sentinel lands in `data`, as a 32-byte big-endian splice. */
function splicesIn(
  data: Uint8Array,
  runtimes: ReadonlyMap<number, string | undefined>,
  deadlines: readonly { readonly runtime: number }[],
): { offset: number; runtime: number }[] {
  const splices: { offset: number; runtime: number }[] = [];
  // A deadline's run-time value lands at its own eight-byte sentinel, any other at its twenty; a
  // value may be both. Each has to land somewhere.
  const sentinels = [
    ...[...runtimes.keys()].map((id) => ({ id, sentinel: sentinelOf(id) })),
    ...deadlines.map((deadline) => ({
      id: deadline.runtime,
      sentinel: deadlineSentinelOf(deadline.runtime),
    })),
  ];
  const landed = new Set<number>();
  for (const { id, sentinel } of sentinels) {
    const word = wordOf(sentinel);
    for (let at = 0; at + 32 <= data.length; at++) {
      if (word.every((byte, k) => data[at + k] === byte)) {
        splices.push({ offset: at, runtime: id });
        landed.add(id);
        at += 31;
      }
    }
  }
  if ([...runtimes.keys()].some((id) => !landed.has(id))) {
    fail(`a run-time value of the intent landed nowhere in its encoding — a bug in the lowering`);
  }
  if (bytesToHex(data).includes(CAPTURE_TAG) && splices.length === 0) {
    fail("a capture sentinel survived into the encoded intent — a bug in the lowering");
  }

  return splices;
}

/** A chain's record: the value its first call was made on, then each call with its arguments. */
function recordOf(
  view: View | undefined,
  what: string,
): Extract<View, { record: unknown }>["record"] {
  if (view === undefined || !("record" in view)) return fail(`${what} is not a chain of calls`);

  return view.record;
}

/** Which token amounts are read: the reward, escrowed on the enclosing chain, or the delivery,
 *  which the solver brings to the destination. */
interface TokenList {
  readonly part: "reward" | "delivery";
  readonly chain: CanonicalChain;
}

const methodOf = (list: TokenList): string =>
  list.part === "reward" ? "`.send(...)`" : "`.receive(...)`";

/**
 * The items of a `.send(...)` or `.receive(...)`, one argument each: a token amount,
 * `{ token, amount }`, or a list of them. The reward may also pay the native coin, once:
 * `{ native: amount }`.
 */
function tokenList(
  items: readonly View[],
  list: TokenList,
  valueOf: (view: View | undefined, what: string) => Value,
): {
  readonly tokens: readonly { readonly token: bigint; readonly amount: Value }[];
  readonly nativeAmount?: Value;
} {
  const amounts =
    `each item ${methodOf(list)} takes is \`{ token, amount }\`` +
    (list.part === "reward" ? ", `{ native: amount }`" : "") +
    ", or a list of token amounts";
  const entries = items.flatMap((item) => ("elements" in item ? item.elements : [item]));
  let nativeAmount: Value | undefined;
  const tokens = entries.flatMap((element) => {
    const entry = "fields" in element ? new Map(element.fields) : fail(amounts);
    if (entry.has("native") && entry.size === 1) {
      if (list.part !== "reward") {
        return fail("`.receive(...)` names tokens: the native coin is paid with `.send(...)`");
      }
      if (nativeAmount !== undefined) return fail("`.send(...)` names its native amount once");
      nativeAmount = valueOf(entry.get("native"), "the native amount");
      return [];
    }
    if (!entry.has("token") || !entry.has("amount") || entry.size !== 2) return fail(amounts);
    const token = valueOf(entry.get("token"), `the ${list.part} token`);
    if (!("literal" in token)) {
      return fail(
        `the ${list.part} token is a variable of the program, known only while it runs, and an ` +
          `intent names its tokens when it is built. Use a symbol ${list.chain.slug} registers.`,
      );
    }

    return [
      {
        token: token.literal,
        amount: valueOf(entry.get("amount"), `the ${list.part} amount`),
      },
    ];
  });
  if (list.part === "reward" && tokens.length === 0 && nativeAmount === undefined) {
    return fail("`.send(...)` must offer something: a token amount, or `{ native: amount }`");
  }

  return { tokens, nativeAmount };
}

/** `defaults.fundVia`, defaulted and checked, refusing an option that belongs to the other mode. */
function requireFundVia(defaults: Partial<IntentSugarDefaults>): IntentFundVia {
  const fundVia = defaults.fundVia ?? "transfer";
  if (!INTENT_FUND_VIA.includes(fundVia)) {
    return fail(
      `\`intents.fundVia\` is '${String(fundVia)}', which is not ` +
        `${INTENT_FUND_VIA.map((via) => `"${via}"`).join(" or ")}`,
    );
  }
  if (fundVia === "transfer" && defaults.allowPartial === true) {
    return fail(
      '`intents.allowPartial` goes with `fundVia: "publishAndFund"`: funding by transfer pays the ' +
        "whole reward into the vault, and `publish` takes no such flag",
    );
  }

  return fundVia;
}

export { SugarError };
