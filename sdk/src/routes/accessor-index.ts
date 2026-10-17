/**
 * Registry-derived name index for the protocol-accessor rewrite (`protocol-rewrite.ts`): which
 * identifiers are "namespace keys" (a protocol's PascalCase key or a family alias) vs "chain keys"
 * (`PascalOf(chain.slug)`), and what each namespace key resolves to.
 *
 * Built once at module eval from `descriptors/registry.ts#DESCRIPTORS` + `chains/canonical.js`'s
 * `canonicalChains` — holds no data of its own. This mirrors the SAME `protocolGroups`/
 * `familyMembers` construction `descriptors/accessors.ts` already does internally for its own lazy
 * accessor tree (not exported there, so this is a second, independently-built index rather than a
 * re-export) — kept in lockstep by construction, since both derive from the identical rule:
 * `PascalOf(protocol slug)` for the canonical key, `PascalOf(-v<N>-stripped stem)` for a family
 * alias.
 *
 * Fails closed at module-eval time (not merely documented) if a namespace key and a chain key ever
 * collide -- shape A/B (namespace-rooted) and shape C/D (chain-rooted) are only unambiguous while
 * that intersection stays empty.
 */
import { canonicalChains, type ChainSlug } from "../chains/canonical.js";
import { DESCRIPTORS } from "../descriptors/registry.js";
import type { ContractDescriptor } from "../descriptors/types.js";
import { pascalOfSlug } from "./builder.js";

export interface ProtocolNamespace {
  readonly kind: "protocol";
  readonly protocol: string;
  readonly contracts: ReadonlyMap<string, ContractDescriptor>;
  /** Set iff the protocol has exactly one deployed contract with an ABI (`kind: "singleton"`) --
   *  shape B's ("<Protocol>.<method>") only source of a default contract. */
  readonly defaultContract?: string;
}

export interface FamilyNamespace {
  readonly kind: "family";
  readonly familyKey: string;
  readonly members: readonly string[];
  /** contract name -> owning protocol slug(s); length > 1 means ambiguous under this family. */
  readonly contractOwners: ReadonlyMap<string, readonly string[]>;
}

export type Namespace = ProtocolNamespace | FamilyNamespace;

/** `"uniswap-v4"` -> `"uniswap"`; a slug with no trailing `-v<N>` yields `undefined`. */
function familyStem(slug: string): string | undefined {
  const m = /^(.+)-v\d+$/.exec(slug);
  return m ? m[1] : undefined;
}

const protocolGroups = new Map<string, ContractDescriptor[]>();
for (const d of DESCRIPTORS) {
  const list = protocolGroups.get(d.protocol);
  if (list) list.push(d);
  else protocolGroups.set(d.protocol, [d]);
}

const NAMESPACES = new Map<string, Namespace>();

for (const [slug, descriptors] of protocolGroups) {
  const key = pascalOfSlug(slug);
  if (NAMESPACES.has(key)) {
    throw new Error(`accessor-index: duplicate protocol namespace '${key}' (from slug '${slug}')`);
  }
  const contracts = new Map<string, ContractDescriptor>();
  for (const d of descriptors) contracts.set(d.contract, d);
  // Shape B's default is the protocol's one singleton: an address-only contract has no methods, and
  // an interface no address, so neither could be the target of a bare `<Protocol>.<method>(...)`.
  // `scripts/gen-source-globals.mjs` declares the same default's methods on the namespace.
  const callable = descriptors.filter((d) => d.kind === "singleton");
  NAMESPACES.set(key, {
    kind: "protocol",
    protocol: slug,
    contracts,
    defaultContract: callable.length === 1 ? callable[0]!.contract : undefined,
  });
}

const familyMembersBySlug = new Map<string, string[]>();
for (const slug of protocolGroups.keys()) {
  const stem = familyStem(slug);
  if (stem === undefined) continue;
  const key = pascalOfSlug(stem);
  const list = familyMembersBySlug.get(key);
  if (list) list.push(slug);
  else familyMembersBySlug.set(key, [slug]);
}

for (const [familyKey, members] of familyMembersBySlug) {
  if (NAMESPACES.has(familyKey)) {
    throw new Error(
      `accessor-index: family alias '${familyKey}' collides with a canonical protocol namespace`,
    );
  }
  const contractOwners = new Map<string, string[]>();
  for (const slug of members) {
    for (const d of protocolGroups.get(slug) ?? []) {
      const owners = contractOwners.get(d.contract);
      if (owners) owners.push(slug);
      else contractOwners.set(d.contract, [slug]);
    }
  }
  NAMESPACES.set(familyKey, { kind: "family", familyKey, members, contractOwners });
}

/** PascalCase chain key -> chain slug. */
const CHAIN_KEYS: ReadonlyMap<string, ChainSlug> = (() => {
  const map = new Map<string, ChainSlug>();
  for (const c of canonicalChains) {
    map.set(pascalOfSlug(c.slug), c.slug as ChainSlug);
  }
  return map;
})();

// Fail closed: measured/asserted disjointness, not assumed (see the module doc).
for (const key of NAMESPACES.keys()) {
  if (CHAIN_KEYS.has(key)) {
    throw new Error(
      `accessor-index: namespace key '${key}' collides with a chain key -- the protocol-accessor ` +
        "rewrite requires these two key sets to be disjoint",
    );
  }
}

export function resolveNamespace(key: string): Namespace | undefined {
  return NAMESPACES.get(key);
}

export function isChainKey(key: string): boolean {
  return CHAIN_KEYS.has(key);
}

export function chainSlugForKey(key: string): ChainSlug | undefined {
  return CHAIN_KEYS.get(key);
}

/** Exposed for tests pinning the registry-derived coverage invariants (M14-style). */
export const NAMESPACE_KEYS: ReadonlySet<string> = new Set(NAMESPACES.keys());
export const CHAIN_KEY_SET: ReadonlySet<string> = new Set(CHAIN_KEYS.keys());

/**
 * The kind of contract `<head>.<path>` names, when it names one directly: `<Ns>.<Contract>` or
 * `<Chain>.<Ns>.<Contract>`, a family alias resolving to its one owner. Undefined for anything
 * else (a method, an unknown name, an ambiguous alias), which the other shapes own.
 */
export function namedContractKind(
  head: string,
  path: readonly string[],
): ContractDescriptor["kind"] | undefined {
  const segments = isChainKey(head) ? path : [head, ...path];
  if (segments.length !== 2) return undefined;
  const [namespace, contract] = segments as [string, string];
  const ns = resolveNamespace(namespace);
  if (ns === undefined) return undefined;
  if (ns.kind === "protocol") return ns.contracts.get(contract)?.kind;
  const owners = ns.contractOwners.get(contract);
  if (owners?.length !== 1) return undefined;
  const member = resolveNamespace(pascalOfSlug(owners[0]!));
  return member?.kind === "protocol" ? member.contracts.get(contract)?.kind : undefined;
}
