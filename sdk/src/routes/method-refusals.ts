/**
 * How a refusal of a contract's method names the methods it has, and the refusal of a method its
 * ABI has that one chain's deployment does not run: one wording for the names check
 * (`absent-names.ts`), the protocol rewrite's `.at(…)` binding (`protocol-rewrite.ts`) and a
 * returned contract's call (`contract-results.ts`).
 *
 * A registry ABI is the whole of what the deployed contract runs, so it may have a hundred methods:
 * past {@link LISTED} names, a refusal says how many and names the {@link NEAREST} nearest the one
 * written, by the measure a "did you mean" suggestion uses (`unknown-global.ts`).
 */
import { requireChain, type CanonicalChain } from "../chains/canonical.js";
import type { ContractDescriptor } from "../descriptors/types.js";
import { nearestOf } from "./unknown-global.js";

/** Up to this many distinct method names, a refusal lists them all. */
const LISTED = 6;
/** Past {@link LISTED}, how many of the names nearest the one written a refusal names. */
const NEAREST = 5;

/**
 * `(known methods: a, b, c)` for `methods` (their distinct names), or past six of them
 * `(<N> known methods; nearest: a, b, c, d, e)`, the five nearest `written`, nearest first and ties
 * by name. `label` words the short form: `known methods`, or a site's own (`its methods`).
 */
export function methodListing(
  methods: Iterable<string>,
  written: string,
  label = "known methods",
): string {
  const names = [...new Set(methods)];
  if (names.length <= LISTED) return `(${label}: ${names.join(", ")})`;

  return `(${names.length} known methods; nearest: ${nearestOf(written, names, NEAREST).join(", ")})`;
}

/** A list of chains for a message: every one, or the first few and how many more. */
export function listed(slugs: readonly string[]): string {
  return slugs.length <= 8
    ? slugs.join(", ")
    : `${slugs.slice(0, 8).join(", ")} and ${slugs.length - 8} more`;
}

/**
 * Whether `method` is a method of `full`'s ABI that `view`, the contract as one chain's deployment
 * runs it (`descriptorOn`), has none of: the deployment withholds every overload of it.
 */
export function isWithheld(
  full: ContractDescriptor,
  view: ContractDescriptor,
  method: string,
): boolean {
  return (
    view !== full &&
    !view.methods.some((m) => m.name === method) &&
    full.methods.some((m) => m.name === method)
  );
}

/**
 * The refusal of `method`, written `shown`, which `full`'s ABI has and its deployment on `chain`
 * withholds (`isWithheld`), naming the chains whose deployment runs it: one that withholds no
 * overload of it, or with `signature`, that overload.
 */
export function withheldRefusal(
  shown: string,
  method: string,
  full: ContractDescriptor,
  chain: CanonicalChain,
  signature?: string,
): string {
  const signatures =
    signature === undefined
      ? full.methods.filter((m) => m.name === method).map((m) => m.signature)
      : [signature];
  const on = full.chains.filter((slug) => {
    const lacking = full.withheldOn[requireChain(slug).id] ?? [];
    return signatures.some((one) => !lacking.includes(one));
  });

  return (
    `\`${shown}\`: \`${signature ?? method}\` is in ${full.protocol}.${full.contract}'s ABI, but ` +
    `its deployment on ${chain.slug} does not run it (as declared); ` +
    (on.length === 0 ? "no deployment of it does." : `it is on: ${listed(on)}.`)
  );
}
