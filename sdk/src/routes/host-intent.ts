/**
 * An Eco intent built in TypeScript:
 *
 *   Base.Portal.send({ token: usdcEthereum, amount: 1_010_000n })
 *     .source(Ethereum)
 *     .refundee(owner)
 *     .receive({ token: usdcBase, amount: 1_000_000n })
 *     .fee(kitchenFee)
 *     .then(() => { USDC.transfer(RECIPIENT, 1000000); });
 *
 * is the statement a program would open the intent with, written out as SauceScript and compiled
 * for the source chain, where a Pot cooks it: the Pot pays the reward into the intent's vault and
 * publishes it. The intent is `@sauce/intents`' class, the one every program's intents are, so a
 * TypeScript intent and the same statement in a file are the same program. There is no second
 * encoder and no offline hash: the intent's hash is the one the Portal's `IntentPublished` announces,
 * read from the cook's rehearsal or its receipt (`intents(logs)`).
 *
 * The body is a closure whose text is compiled, never run: it captures no JavaScript value, and
 * what it needs from the host it reads as a define (`.source(chain, { defines })`).
 */
import { bytesToHex, getAddress, type Address, type Hex } from "viem";

import { requireChain, type CanonicalChain, type ChainRef } from "../chains/canonical.js";
import { v12PredictPot, SAUCE_INTENT_POT_SALT } from "../deployments/pot.js";
import { v12EngineAddress } from "../deployments/v12-addresses.js";
import { closureText, isSauceClosure, type SauceBody } from "./closure.js";
import { denormalizeToEvm } from "./encode.js";
import { toBigInt, toUniversalAddress } from "./normalize.js";
import { pascalOfSlug } from "./pascal.js";
import { loggedIntents, type IntentLog, type LoggedIntent } from "./published.js";
import { buildSauceEvmCall, type SauceEvmCall } from "./sauce-calls.js";
import {
  compileSauceProgram,
  type CompiledSauceProgram,
  type SauceProgramOptions,
} from "./sauce-route.js";
import type { AddressInput } from "./types.js";

/** A token's address, as the host spells it or as a SauceScript value does. */
export type PortalAddress = AddressInput | bigint;

/** A token and an amount. */
export interface PortalTokenAmount {
  readonly token: PortalAddress;
  readonly amount: bigint | number | string;
}

/** One thing `send` pays: a token and an amount, or native coin as `{ native: amount }`. */
export type PortalRewardItem = PortalTokenAmount | { readonly native: bigint | number | string };

/** What `send` takes as one argument: an item, or a list of them. */
export type PortalReward = PortalRewardItem | readonly PortalRewardItem[];

/** What `receive` takes as one argument: a token the solver delivers, or a list of them. */
export type PortalDelivery = PortalTokenAmount | readonly PortalTokenAmount[];

/** A chain, as a reference or as a chain export (`Ethereum`). */
export type PortalChain = ChainRef | { readonly chain: CanonicalChain };

/** The reward's steps, after `send(...)`: each modifier at most once, in any order. */
export interface PortalSendSteps<Used extends string> {
  /** The chain the reward is escrowed on, where the intent is published and the program is
   *  compiled, with that compile's options: defines the body reads, the intents' defaults (the
   *  Kitchen fee as `intents.executionFee`, the Portals), tokens. Required: a TypeScript intent runs
   *  on no chain to default it to. */
  source(chain: PortalChain, options?: SauceProgramOptions): PortalSent<Used | "source">;
  /** Who may reclaim an unearned reward, the reward's `creator` on the Portal. Required, as on
   *  every intent. */
  refundee(address: PortalAddress): PortalSent<Used | "refundee">;
  /** From when an unproven reward may be refunded, Unix seconds. Defaults to the route's deadline
   *  plus `DEFAULT_REFUND_WINDOW`. */
  deadline(seconds: bigint | number): PortalSent<Used | "deadline">;
  /** The source chain's prover. Defaults to the registry's for the pair. */
  prover(address: PortalAddress): PortalSent<Used | "prover">;
  /** What the solver delivers on the destination, each token an argument or one list of them.
   *  `.receive()` for nothing. */
  receive(...delivery: readonly PortalDelivery[]): PortalReceived;
}

/** An intent with its reward: the reward's modifiers not given yet, then `receive`. */
export type PortalSent<Used extends string = never> = Omit<PortalSendSteps<Used>, Used>;

/** The route's steps, after `receive(...)`: each modifier at most once, in any order. */
export interface PortalReceiveSteps<Used extends string> {
  /** The last second the intent may be filled, Unix seconds. Defaults to `DEFAULT_FILL_WINDOW`
   *  past when the cook publishes it. */
  deadline(seconds: bigint | number): PortalReceived<Used | "deadline">;
  /** The route's salt: two otherwise identical intents are distinct with distinct salts. Defaults
   *  to 32 random bytes, picked when it compiles. */
  salt(salt: Hex | bigint): PortalReceived<Used | "salt">;
  /** The destination Kitchen's fee, in wei, which the body's cook pays: read it with
   *  `destinationExecutionFee()`. Else `intents.executionFee` in `.source(chain, options)`. */
  fee(wei: bigint | number): PortalReceived<Used | "fee">;
  /** The body that runs on the destination: an arrow function, or the statements of one. */
  then(body: SauceBody): PortalOpened;
}

/** An intent waiting for its body: the route's modifiers not given yet, then `then`. Its `then`
 *  is the intent's, not a promise's: `await` on it is refused. */
export type PortalReceived<Used extends string = never> = Omit<PortalReceiveSteps<Used>, Used>;

/** The Pot a cook runs on: its address, or its owner and salt (zero by default). */
export type PotTarget = AddressInput | { readonly owner: AddressInput; readonly salt?: Hex };

/** An intent built in TypeScript: the program that opens it, and its cook. */
export interface HostIntent {
  /** The program, as SauceScript: the statement that opens the intent. */
  readonly source: string;
  /** It, compiled for the source chain. */
  readonly program: CompiledSauceProgram;
  /**
   * The cook that publishes the intent from `target`'s Pot on the source chain: `Pot.cook(engine,
   * program)`, sent by the Pot's owner, `value` the source Kitchen's fee. The Pot pays the reward
   * into the intent's vault, so it must hold it (send it there first, or have `sauce run --fund`
   * pull it in the same cook), and must be deployed (`sauceEvmDeployPotCall`).
   */
  cook(target: PotTarget, value: bigint | number): SauceEvmCall;
  /** The intents `logs` show the source chain's Portal publishing — the cook's rehearsal's or its
   *  receipt's — each rebuilt from `IntentPublished` and held to the hash it announces. */
  intents(logs: readonly IntentLog[]): readonly LoggedIntent[];
}

/**
 * The built intent, and inside a typed closure, the handler of its body: `.then(() => { … })
 * .catch((e) => { … })` in a program, where the compiler builds the two as one program. On the host
 * `.catch(...)` is refused: write the intent in the program a Pot runs.
 */
export type PortalOpened = HostIntent & {
  /** What runs on the destination in the body's place when the body reverts, `e` what it reverted
   *  with: written in a program, never called on the host. */
  catch(handler: (e: PortalCaughtBytes) => void): void;
};

/**
 * What a handler's `e` is in a typed closure: SauceScript `bytes`, the shape
 * `source-globals.generated.ts`'s `SauceBytes` has, written out so this module declares no globals.
 */
export interface PortalCaughtBytes {
  readonly length: bigint;
  [index: number]: bigint;
  slice(start: bigint, end: bigint): PortalCaughtBytes;
  toBe(): bigint;
  toLe(): bigint;
}

/** A chain's Portal, opening an intent whose body runs on that chain. */
export interface ChainPortal {
  /** The reward the creator pays, each item an argument or one list of them: tokens, and native
   *  coin as `{ native: amount }`. */
  send(...reward: readonly PortalReward[]): PortalSent;
}

/** Items given as arguments, any of them a list of items. */
const itemsOf = <T>(given: readonly (T | readonly T[])[]): readonly T[] =>
  given.flatMap((item) => (Array.isArray(item) ? (item as readonly T[]) : [item as T]));

const isNative = (value: unknown): boolean =>
  typeof value === "function" && Function.prototype.toString.call(value).includes("[native code]");

/** A chain export (`Ethereum`, carrying `.chain`) rather than a reference. */
function isChainExport(value: PortalChain): value is { readonly chain: CanonicalChain } {
  return (
    (typeof value === "object" || typeof value === "function") && value !== null && "chain" in value
  );
}

/** An address the host spells any way, as an EVM address. */
const evmAddress = (address: AddressInput): Address =>
  getAddress(denormalizeToEvm(toUniversalAddress(address)));

/** An address as SauceScript writes it: a hex literal. */
const addressLiteral = (address: PortalAddress): string =>
  typeof address === "bigint"
    ? `0x${address.toString(16).padStart(40, "0")}`
    : evmAddress(address).toLowerCase();

/** A whole number as SauceScript writes it: plainly. */
const integer = (value: bigint | number | string): string => toBigInt(value).toString();

/** A token amount, or native coin, as a SauceScript item. */
function itemLiteral(item: PortalRewardItem): string {
  return "native" in item
    ? `{ native: ${integer(item.native)} }`
    : `{ token: ${addressLiteral(item.token)}, amount: ${integer(item.amount)} }`;
}

/**
 * The Portal of `chain`: `send(reward).source(chain).refundee(address)[.deadline().prover()]
 * .receive(delivery)[.deadline().salt().fee()].then(body)` writes the statement a program opens
 * that intent with, compiles it for the source chain, and returns the program and its cook.
 */
export function chainPortal(chain: ChainRef): ChainPortal {
  const destination = requireChain(chain);
  const name = `${pascalOfSlug(destination.slug)}.Portal`;
  const once = (stage: Map<string, unknown>, step: string, value: unknown, after: string) => {
    if (stage.has(step)) {
      throw new TypeError(`${name}: \`.${step}(...)\` is given twice after \`.${after}(...)\``);
    }
    stage.set(step, value);
  };

  return {
    send: (...reward) => {
      const rewardSteps = new Map<string, unknown>();
      let options: SauceProgramOptions = {};
      const sent = {
        source: (value: PortalChain, given?: SauceProgramOptions) => {
          once(rewardSteps, "source", value, "send");
          options = given ?? {};
          return sent;
        },
        refundee: (value: PortalAddress) => (once(rewardSteps, "refundee", value, "send"), sent),
        deadline: (value: bigint | number) => (once(rewardSteps, "deadline", value, "send"), sent),
        prover: (value: PortalAddress) => (once(rewardSteps, "prover", value, "send"), sent),
        receive: (...delivery: readonly PortalDelivery[]) => {
          const routeSteps = new Map<string, unknown>();
          const received = {
            deadline: (value: bigint | number) => (
              once(routeSteps, "deadline", value, "receive"),
              received
            ),
            salt: (value: Hex | bigint) => (once(routeSteps, "salt", value, "receive"), received),
            fee: (value: bigint | number) => (once(routeSteps, "fee", value, "receive"), received),
            // Not `then(body)`: a promise's resolution calls it with two native functions, and that
            // call has to be told apart from the intent's own.
            then(...args: unknown[]): PortalOpened {
              const [body] = args;
              if (args.length !== 1 || isNative(body)) {
                throw new TypeError(
                  `${name}.send(...).receive(...) is not a promise: \`.then(...)\` takes the ` +
                    "intent's body, `.then(() => { … })`, and returns the intent. It was called " +
                    "as a promise's `then` — by `await`, or by returning it from an async " +
                    "function — which would build nothing. Call `.then(() => { … })` and use the " +
                    "intent it returns.",
                );
              }
              const built = hostIntent(destination, name, {
                reward: itemsOf(reward),
                rewardSteps,
                delivery: itemsOf(delivery),
                routeSteps,
                body: body as SauceBody,
                options,
              });
              return Object.defineProperty(built, "catch", {
                value: () => {
                  throw new TypeError(
                    `${name}...then(body).catch(handler) handles a body inside a program, where ` +
                      "the compiler builds the two as one: open the intent in the program a Pot " +
                      "runs.",
                  );
                },
              }) as PortalOpened;
            },
          };
          return received;
        },
      };
      return sent as unknown as PortalSent;
    },
  };
}

/** `chainPortal`'s `then`: the statement written out, compiled for the source chain. */
function hostIntent(
  destination: CanonicalChain,
  name: string,
  given: {
    readonly reward: readonly PortalRewardItem[];
    readonly rewardSteps: ReadonlyMap<string, unknown>;
    readonly delivery: readonly PortalTokenAmount[];
    readonly routeSteps: ReadonlyMap<string, unknown>;
    readonly body: SauceBody;
    readonly options: SauceProgramOptions;
  },
): HostIntent {
  const { rewardSteps, routeSteps } = given;
  const sourceRef = rewardSteps.get("source") as PortalChain | undefined;
  if (sourceRef === undefined) {
    throw new TypeError(
      `${name}: give \`.source(...)\` after \`.send(...)\`: the chain the reward is escrowed on, ` +
        "where the intent is published and the program that opens it is compiled",
    );
  }
  const source = requireChain(isChainExport(sourceRef) ? sourceRef.chain : sourceRef);
  if (source.kind !== "evm") {
    throw new TypeError(
      `${name}: an intent is published from an EVM chain, through its eco-routes Portal, and ` +
        `${source.slug} is not one`,
    );
  }

  const steps = (entries: readonly (readonly [string, string | undefined])[]): string =>
    entries
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
      .map(([step, value]) => `\n  .${step}(${value})`)
      .join("");
  const optional = <T>(
    map: ReadonlyMap<string, unknown>,
    step: string,
    as: (value: T) => string,
  ) => (map.has(step) ? as(map.get(step) as T) : undefined);
  const salt = (value: Hex | bigint): string =>
    typeof value === "bigint" ? `0x${value.toString(16).padStart(64, "0")}` : value;
  const body = isSauceClosure(given.body) ? closureText(given.body) : `() => {\n${given.body}\n}`;

  const text =
    `${pascalOfSlug(destination.slug)}.Portal.send(${given.reward.map(itemLiteral).join(", ")})` +
    steps([
      ["refundee", optional(rewardSteps, "refundee", addressLiteral)],
      ["deadline", optional(rewardSteps, "deadline", integer)],
      ["prover", optional(rewardSteps, "prover", addressLiteral)],
    ]) +
    `\n  .receive(${given.delivery.map(itemLiteral).join(", ")})` +
    steps([
      ["deadline", optional(routeSteps, "deadline", integer)],
      ["salt", optional(routeSteps, "salt", salt)],
      ["fee", optional(routeSteps, "fee", integer)],
    ]) +
    `\n  .then(${body});\n`;
  const program = compileSauceProgram(source, text, given.options);
  const portal = given.options.intents?.sourcePortal;

  return {
    source: text,
    program,
    cook: (target, value) =>
      buildSauceEvmCall({
        pot: potOf(target),
        engine: given.options.intents?.engine ?? (v12EngineAddress() as Hex),
        program: bytesToHex(program.bytecode),
        value: toBigInt(value),
      }),
    intents: (logs) =>
      loggedIntents(source, logs, portal === undefined ? undefined : evmAddress(portal)),
  };
}

/** The Pot `target` names. */
function potOf(target: PotTarget): Address {
  if (typeof target === "object" && target !== null && "owner" in target) {
    return getAddress(
      v12PredictPot(evmAddress(target.owner), target.salt ?? SAUCE_INTENT_POT_SALT),
    );
  }

  return evmAddress(target as AddressInput);
}
