/**
 * `<Chain>.Portal.send(…).receive(…).then(() => { … })` — an Eco intent opened from inside a Sauce
 * program, built on the compiler's host API rather than on the program's text.
 *
 * ```js
 * function main() {
 *   const amount = USDC.balanceOf(ctx.self());
 *   Arbitrum.Portal.send({ token: USDC, amount })
 *     .receive({ token: USDC, amount: (amount * 99n) / 100n })
 *     .then(() => {
 *       USDC.transfer(RECIPIENT, (amount * 99n) / 100n);
 *     });
 * }
 * ```
 *
 * WHAT THE COMPILER IS TOLD. `<Chain>.Portal` is a constant of the `Portal` type, its value the
 * destination's chain id. `send` (the reward, paid here) and `receive` (what the solver delivers
 * there) make records, each taking any number of items as arguments of its own (`rest`) — a token
 * amount or a list of them, and for the reward the native coin — so the chain is one record of
 * everything in it, which the compiler shows `nested` and `bind` call by call. `receive`'s items
 * are evaluated here but named on the destination (`scope: "nested"`, its scope picked from the
 * record's chain). `receive` is required, `.receive()` naming nothing. `then` takes a PROGRAM: its
 * closure is compiled as a program of its own in the scope `nested` returns for that chain — the
 * destination's names, its target, its own intents — and what it reads of the enclosing program
 * reaches it as entry arguments. A closure of nothing but token `transfer`/`approve` calls is
 * RECORDED instead: there is no program, only the calls, which become the route's own. The record
 * `then` makes ends the chain: its type's ending is bound at its site, so the compiler hands `bind`
 * what it knows there — the chain, the reward, the delivery, the program or the recorded calls —
 * and calls `@sauce/intents` with what `bind` returns. A chain that stops before `receive` or
 * `then` is refused in this file's words.
 *
 * WHAT `bind` DOES. It builds the intent exactly as before: the route's calls (each recorded write,
 * or the delivered tokens' transfers into the Pot then its `cook`), the reward, the deadlines, the
 * prover, the Portals on both sides. A value known only while the enclosing program runs is a
 * sentinel in the encoding, and each place it lands is a SPLICE, so the program writes the value
 * there when it runs. No source is generated and nothing is parsed.
 *
 * WHICH CHAIN A NAME MEANS. The body and the delivery are the destination's, the reward the
 * enclosing chain's, where it is escrowed. That is the compiler's scoping now: the body compiles in
 * the destination's scope, the delivery is a `nested` value, and the reward an ordinary one.
 */
import type {
  BoundArgument,
  CallSite,
  Declaration,
  HostType,
  ProgramOptions,
  ProgramReport,
  ProgramSite,
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
import type { AddressInput, Intent } from "./types.js";

/** What a caller must supply because the SDK cannot correctly guess it, plus what it may override. */
export interface IntentSugarDefaults {
  /** Absolute Unix seconds. Required: a deadline is a policy decision, and a wrong one either
   *  strands the reward or makes the intent unfulfillable. */
  readonly deadline: bigint;
  /** Defaults to `route.deadline`. */
  readonly rewardDeadline?: bigint;
  /** Who may reclaim the reward after `rewardDeadline`. No default: see `requireCreator`. */
  readonly creator?: AddressInput;
  /** Defaults to the prover the deployment registry records for this source/destination pair. */
  readonly prover?: AddressInput;
  /** Overrides the source-chain Portal the program publishes through. */
  readonly sourcePortal?: AddressInput;
  /** Overrides the destination-chain Portal recorded in the child's route. */
  readonly destinationPortal?: AddressInput;
  /** Route salt, defaulting to 32 zero bytes. */
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
  /** The destination Kitchen's current execution fee, in wei. Required for a cook-based child. */
  readonly executionFee?: bigint;
}

export interface LoweredIntent {
  /** The child as encoded, with a sentinel wherever a run-time value belongs. */
  readonly intent: Intent;
  /** Enclosing locals spliced into it, in first-seen order. */
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

/** The refusal of a chain that stops before saying what runs on the destination. */
const NEEDS_A_BODY =
  "an intent needs what runs on its destination: end it with `.then(() => { … })`";

/** The refusal of a chain that skips what the solver delivers. */
const NEEDS_A_DELIVERY =
  "an intent names what the solver delivers before its body: `.receive(…)`, or `.receive()` " +
  "for nothing, then `.then(() => { … })`";

/**
 * One sentinel per run-time value of a site. TWENTY bytes, so the same sentinel is a legal
 * `uint256` and a legal `address` when viem encodes the call; the trailing index keeps them apart.
 */
const CAPTURE_TAG = "5acecab7";
const sentinelOf = (id: number): bigint =>
  BigInt(`0x${CAPTURE_TAG}${"00".repeat(14)}${id.toString(16).padStart(4, "0")}`);

const addressHex = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;
const wordOf = (value: bigint): Uint8Array =>
  hexToBytes(`0x${value.toString(16).padStart(64, "0")}`);

/** A value of a site: known now, or one of its run-time values. */
type Value = { readonly literal: bigint } | { readonly runtime: number; readonly name?: string };

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
  const then: Signature = { params: [{ kind: "program", record: true }], returns: "Opened" };
  // `send` and `receive` take any number of items, each an argument of its own.
  const types: Record<string, HostType> = {
    Portal: {
      of: "Uint256",
      methods: { send: { params: [{ kind: "value" }], rest: true, returns: "Sending" } },
    },
    Sending: {
      methods: {
        receive: {
          params: [{ kind: "value", scope: "nested" }],
          rest: true,
          returns: "Receiving",
        },
        // Declared only to be refused in this file's words, where its program would compile.
        then,
      },
      ending: { refused: NEEDS_A_DELIVERY },
    },
    Receiving: { methods: { then }, ending: { refused: NEEDS_A_BODY } },
    // `.catch(() => { … })` handles the body: the compiler builds it as one program,
    // `try { <body> } catch { <handler> }`, which runs on the destination.
    Opened: {
      methods: { catch: { params: [{ kind: "handler" }], returns: "Caught" } },
      ending: { calls: publish, site: true },
    },
    Caught: { ending: { calls: publish, site: true } },
  };
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

  const nested = (site: ProgramSite): ProgramOptions =>
    site.callee === "Sending.then"
      ? fail(NEEDS_A_DELIVERY)
      : level.programOn(destinationOf(site.receiver, `\`${site.callee}\``));

  const bind = (site: CallSite): BoundArgument[] => {
    if (site.callee !== "Opened" && site.callee !== "Caught") {
      return fail(`'${site.callee}' is not an intent's publication`);
    }

    return bindIntent(level, destinationOf(site.receiver, "the intent"), fundVia, site);
  };

  return { declare, types, hostModules: [INTENTS], nested, bind };
}

/** The publication's arguments, for `@sauce/intents#publish` or `#publishAndFund`: the record a
 *  chain built — its `Portal`, the reward, the delivery when it names one, then the body. */
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
    if (view !== undefined && "constant" in view) return { literal: BigInt(view.constant) };
    if (view !== undefined && "runtime" in view) {
      runtimes.set(view.runtime, view.name);
      return { runtime: view.runtime, name: view.name };
    }
    return fail(`${what} must be a value: a literal, a define or a variable of the program`);
  };
  const sentinelFor = (value: Value): bigint =>
    "literal" in value ? value.literal : sentinelOf(value.runtime);

  // Each call of the chain, by the method that made it, wherever it was written.
  const { parts } = recordOf(site.receiver, "the intent");
  const argumentsOf = (method: string) =>
    parts.find((part) => part.callee.endsWith(`.${method}`))?.args;
  const body = argumentsOf("then")?.[0];
  const rewardItems = argumentsOf("send") ?? fail("`.send(...)` names the reward");
  // `.receive()` names nothing: a token-only body's delivery is then what its transfers move.
  const deliveryItems = argumentsOf("receive") ?? [];
  const explicitDelivery =
    deliveryItems.length === 0
      ? undefined
      : tokenList(deliveryItems, { part: "delivery", chain: destination }, valueOf).tokens;

  const destinationPortal = defaults.destinationPortal ?? ecoRoutesPortal(destination, defaults);
  const calls: { target: Hex; data: Hex; value: bigint }[] = [];
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

  if (body !== undefined && "recorded" in body) {
    // A body of token writes is the route's own calls, run by the Portal's Executor — not a
    // program, so the Executor's checks rather than SafeERC20's. Every approve is reset to zero
    // first, for a token (USDT) that refuses to move a standing allowance: one Executor runs every
    // intent on a chain.
    for (const call of body.recorded) {
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
      if (method === "approve" && !("literal" in amount && amount.literal === 0n)) {
        calls.push(tokenCall(token.literal, "approve", [args[0]!, { literal: 0n }]));
      }
      calls.push(tokenCall(token.literal, method, args));
    }
  } else if (body !== undefined && "program" in body) {
    calls.push(
      ...programCalls(
        level,
        body.program,
        destinationPortal,
        explicitDelivery,
        sentinelFor,
        runtimes,
      ),
    );
  } else {
    return fail("an intent's body must be a closure");
  }

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

  const rewardDeadline = defaults.rewardDeadline ?? requireDeadline(defaults);
  const child: Intent = {
    destination: BigInt(destination.id),
    sourceChainId: BigInt(source.id),
    route: normalizeRoute({
      salt: defaults.salt,
      deadline: requireDeadline(defaults),
      portal: destinationPortal,
      nativeAmount: calls.reduce((sum, call) => sum + call.value, 0n),
      tokens: (explicitDelivery ?? derivedDelivery).map((t) => ({
        token: addressHex(t.token),
        amount: sentinelFor(t.amount),
      })),
      calls,
    }),
    reward: normalizeReward({
      deadline: rewardDeadline,
      creator: requireCreator(defaults),
      prover: defaults.prover ?? ecoRoutesProver(source, destination, defaults),
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
  const dataSplices = splicesIn(data, runtimes);

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

  const captures = [...new Set([...runtimes].map(([id, name]) => name ?? `#${id}`))];
  level.lowered.push({
    intent: child,
    captures,
    sentinels: [...runtimes].map(([id, name]) => ({
      sentinel: sentinelOf(id),
      capture: name ?? `#${id}`,
    })),
    destination,
    fundVia,
  });

  const portal = { value: denormalizeToEvm(toUniversalAddress(sourcePortal)), type: "Address" };
  const published = { bytes: data, splices: dataSplices };
  const funded = [
    { bytes: rewards, splices: rewardSplices },
    { bytes: nativeWord, splices: nativeSplices },
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
  sentinelFor: (value: Value) => bigint,
  runtimes: Map<number, string | undefined>,
): { target: Hex; data: Hex; value: bigint }[] {
  if (program.target !== "evm") {
    return fail(
      `an intent body on a Solana destination is a program for its Kitchen, which a route call does ` +
        `not issue from here yet`,
    );
  }
  const { pot, engine } = resolveIntentPot(destinationPortal, level.defaults);
  const fee =
    level.defaults.executionFee ??
    fail(
      "the intent runs a program, so its cook must pay that chain's Kitchen fee — set " +
        "`intents.executionFee` (`destinationExecutionFee()` reads it)",
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
): { offset: number; runtime: number }[] {
  const splices: { offset: number; runtime: number }[] = [];
  for (const id of runtimes.keys()) {
    const word = wordOf(sentinelOf(id));
    let found = 0;
    for (let at = 0; at + 32 <= data.length; at++) {
      if (word.every((byte, k) => data[at + k] === byte)) {
        splices.push({ offset: at, runtime: id });
        found++;
        at += 31;
      }
    }
    if (found === 0) {
      fail(`a run-time value of the intent landed nowhere in its encoding — a bug in the lowering`);
    }
  }
  if (bytesToHex(data).includes(CAPTURE_TAG) && splices.length === 0) {
    fail("a capture sentinel survived into the encoded intent — a bug in the lowering");
  }

  return splices;
}

/** A view's fields by name, refusing anything that is not an object. */
function fieldsOf(view: View | undefined, what: string): Map<string, View> {
  if (view === undefined || !("fields" in view)) return fail(`${what} must be an object`);

  return new Map(view.fields);
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
    const entry = fieldsOf(element, amounts);
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

function requireDeadline(defaults: Partial<IntentSugarDefaults>): bigint {
  if (defaults.deadline === undefined) {
    return fail(
      "the intent needs a `deadline` — the absolute Unix second by which it must be fulfilled. Set " +
        "`IntentOptions.deadline`, or `intents.deadline` in the compile options.",
    );
  }
  return defaults.deadline;
}

/**
 * The reward's creator — who may reclaim it once `rewardDeadline` passes. There is no correct
 * default: the executing Pot is driven by every solver, so a refund there is one anyone can take.
 */
function requireCreator(defaults: Partial<IntentSugarDefaults>): AddressInput {
  if (defaults.creator === undefined) {
    return fail(
      "the reward needs a `creator` — the address that can reclaim it after the deadline. It has no " +
        "safe default: the executing Pot is driven by every solver, so a refund there is a refund " +
        "anyone can take. Set `IntentOptions.creator`, or `intents.creator` in the compile options.",
    );
  }
  return defaults.creator;
}

export { SugarError };
