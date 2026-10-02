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
