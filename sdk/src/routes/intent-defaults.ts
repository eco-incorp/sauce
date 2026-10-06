import type { CanonicalChain } from "../chains/canonical.js";
import type { EcoRoutesSelector } from "../protocols/eco-routes/lookup.js";
import type { IntentFundVia } from "./portal.js";
import type { AddressInput } from "./types.js";

/**
 * What an intent a program opens takes when it does not say: Eco's own defaults, as its solver
 * quotes an intent and its Portal app publishes one.
 */

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

/**
 * What every intent a program opens takes when it does not name its own, and what the SDK cannot
 * look up: the defaults a compile hands `@sauce/intents` (`SauceCompileOptions.intents`). Each
 * modifier an intent is written with wins over its field here.
 */
export interface IntentDefaults extends EcoRoutesSelector {
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
  /** Route salt, for every intent that names none with `.salt(...)`. Left out: 32 random bytes,
   *  picked once per compile ({@link randomSalt}). */
  readonly salt?: `0x${string}`;
  /** How the program funds the reward: `"transfer"` (default) pays the vault then `publish`es;
   *  `"publishAndFund"` approves the Portal and calls `publishAndFund`. */
  readonly fundVia?: IntentFundVia;
  /** Passed to `publishAndFund` (`fundVia: "publishAndFund"` only). Default `false`. */
  readonly allowPartial?: boolean;
  /** Overrides the destination Pot a body cooks on. */
  readonly pot?: AddressInput;
  /** The interpreter that Pot cooks on. Defaults to the released engine address. */
  readonly engine?: AddressInput;
  /** The destination Kitchen's current execution fee, in wei, paid on every cook: one for every
   *  destination, or each destination's own. Required for an intent whose body is a program, unless
   *  it is given `.fee(...)`: it is read from the chain and it changes. */
  readonly executionFee?: bigint | ((destination: CanonicalChain) => bigint | undefined);
}

/** {@link IntentDefaults}, by its earlier name. */
export type IntentSugarDefaults = IntentDefaults;
