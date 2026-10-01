/**
 * CANONICAL CHAIN REGISTRY — identity only, additive, zero runtime coupling.
 *
 * `chains` (./index.ts) is EVM-only and has no `slug`. It does not answer the plain question "what
 * is this chain called, and what kind of VM does it run" for the full union — including the EVM
 * chains and Solana, which have no `chains` entry at all.
 *
 * This module is a flat, hand-maintained data table answering exactly that question, for both EVM
 * and SVM chains in ONE numeric id space. It carries no nativeCurrency / blockExplorerUrls /
 * testnet — those already live on `chains` for the ids that have them; a consumer needing that
 * data still goes through `getChain(id)`, which returns `undefined` for a chain `chains` lacks.
 *
 * Deliberately NOT wired to `../deployments/` or `../protocols/` — no import cycle, no runtime
 * coupling. It answers "what is this chain called", an IDENTITY question, and says nothing about
 * whether Sauce is deployed there: the release addresses are chain-independent, so that is a
 * question for the chain itself.
 *
 * MAINTENANCE NOTE: this table is hand-maintained, not derived. A chain added to `chains`
 * (./index.ts) fails `test/chains-canonical.test.ts` until a matching entry is added here — that is
 * the intended fail-closed behavior, not a test to relax.
 */

export type ChainKind = "evm" | "svm";

/**
 * Identity-only record for one chain: what it is called and what kind of VM it
 * runs. Deliberately NOT a superset of `Chain` (../core/types.js) — see the
 * module doc comment above for why.
 */
export interface CanonicalChain {
  /** Numeric chain id. EVM chain id, or the eco-routes SVM id for Solana. */
  readonly id: number;
  /** Stable lowercase kebab-case key. */
  readonly slug: string;
  /** Canonical display name. For every id present in `chains`, this is byte-identical to `chains[id].name`. */
  readonly name: string;
  readonly kind: ChainKind;
  /** Additional accepted spellings. Matched case- and punctuation-insensitively, same as `slug` and `name`. */
  readonly aliases: readonly string[];
}

export const CANONICAL_CHAINS = [
  // --- EVM, present in `chains` ---
  { id: 1, slug: "ethereum", name: "Ethereum", kind: "evm", aliases: ["mainnet", "eth"] },
  { id: 10, slug: "optimism", name: "Optimism", kind: "evm", aliases: ["op", "op-mainnet"] },
  {
    id: 56,
    slug: "bsc",
    name: "BNB Chain",
    kind: "evm",
    aliases: ["bnb", "binance-smart-chain", "bnb-smart-chain"],
  },
  { id: 137, slug: "polygon", name: "Polygon", kind: "evm", aliases: ["matic", "polygon-pos"] },
  { id: 8453, slug: "base", name: "Base", kind: "evm", aliases: [] },
  { id: 42161, slug: "arbitrum", name: "Arbitrum One", kind: "evm", aliases: ["arb"] },
  { id: 42220, slug: "celo", name: "Celo", kind: "evm", aliases: [] },

  { id: 25, slug: "cronos", name: "Cronos", kind: "evm", aliases: ["cro"] },
  { id: 100, slug: "gnosis", name: "Gnosis", kind: "evm", aliases: ["xdai", "gnosis-chain"] },
  { id: 122, slug: "fuse", name: "Fuse", kind: "evm", aliases: [] },
  { id: 169, slug: "manta", name: "Manta Pacific", kind: "evm", aliases: [] },
  { id: 204, slug: "opbnb", name: "opBNB", kind: "evm", aliases: [] },
  {
    id: 250,
    slug: "fantom",
    name: "Fantom",
    kind: "evm",
    aliases: ["ftm", "opera", "fantom-opera"],
  },
  { id: 288, slug: "boba", name: "Boba", kind: "evm", aliases: ["boba-network"] },
  { id: 324, slug: "zksync", name: "zkSync Era", kind: "evm", aliases: [] },
  { id: 369, slug: "pulsechain", name: "PulseChain", kind: "evm", aliases: ["pls"] },
  {
    id: 1088,
    slug: "metis",
    name: "Metis",
    kind: "evm",
    aliases: ["andromeda", "metis-andromeda"],
  },
  { id: 1116, slug: "core", name: "Core", kind: "evm", aliases: ["coredao", "core-dao"] },
  { id: 1284, slug: "moonbeam", name: "Moonbeam", kind: "evm", aliases: [] },
  { id: 1329, slug: "sei", name: "Sei", kind: "evm", aliases: ["sei-evm"] },
  { id: 2222, slug: "kava", name: "Kava", kind: "evm", aliases: ["kava-evm"] },
  { id: 5000, slug: "mantle", name: "Mantle", kind: "evm", aliases: [] },
  // Circle's Arc. The released engine, router and Kitchen from V12Deployments.json have code on Arc
  // (measured 2026-09-28), but no intent Pot is deployed there yet.
  { id: 5042, slug: "arc", name: "Arc", kind: "evm", aliases: ["arc-mainnet", "arc-network"] },
  { id: 7000, slug: "zetachain", name: "ZetaChain", kind: "evm", aliases: ["zeta"] },
  { id: 8217, slug: "klaytn", name: "Klaytn", kind: "evm", aliases: ["kaia"] },
  { id: 9001, slug: "evmos", name: "Evmos", kind: "evm", aliases: [] },
  { id: 34443, slug: "mode", name: "Mode", kind: "evm", aliases: [] },
  { id: 43114, slug: "avalanche", name: "Avalanche C-Chain", kind: "evm", aliases: ["avax"] },
  { id: 59144, slug: "linea", name: "Linea", kind: "evm", aliases: [] },
  { id: 80094, slug: "berachain", name: "Berachain", kind: "evm", aliases: ["bera"] },
  { id: 81457, slug: "blast", name: "Blast", kind: "evm", aliases: [] },
  { id: 534352, slug: "scroll", name: "Scroll", kind: "evm", aliases: [] },
  { id: 7777777, slug: "zora", name: "Zora", kind: "evm", aliases: [] },
  { id: 1313161554, slug: "aurora", name: "Aurora", kind: "evm", aliases: [] },

  // --- EVM, NOT in `chains` ---
  { id: 130, slug: "unichain", name: "Unichain", kind: "evm", aliases: [] },
  { id: 143, slug: "monad", name: "Monad", kind: "evm", aliases: [] },
  { id: 146, slug: "sonic", name: "Sonic", kind: "evm", aliases: [] },
  { id: 2020, slug: "ronin", name: "Ronin", kind: "evm", aliases: [] },
  { id: 9745, slug: "plasma", name: "Plasma", kind: "evm", aliases: [] },
  { id: 57073, slug: "ink", name: "Ink", kind: "evm", aliases: [] },

  // --- SVM (1) ---
  {
    id: 1399811149,
    slug: "solana",
    name: "Solana",
    kind: "svm",
    aliases: ["sol", "mainnet-beta", "solana-mainnet"],
  },
] as const satisfies readonly CanonicalChain[];

/** The literal slug union — what the fluent accessor and route shortcuts key their builder types off. */
export type ChainSlug = (typeof CANONICAL_CHAINS)[number]["slug"];

/** Widened alias for ordinary iteration/mapping. */
export const canonicalChains: readonly CanonicalChain[] = CANONICAL_CHAINS;

const byId = new Map<number, CanonicalChain>(canonicalChains.map((c) => [c.id, c]));

const bySlug = new Map<string, CanonicalChain>(canonicalChains.map((c) => [c.slug, c]));

/** The ONE normalizer: lowercased, trimmed, punctuation/whitespace stripped. */
export function normalizeChainKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const byAlias = new Map<string, CanonicalChain>();
for (const c of canonicalChains) {
  byAlias.set(normalizeChainKey(c.slug), c);
  byAlias.set(normalizeChainKey(c.name), c);
  for (const alias of c.aliases) {
    byAlias.set(normalizeChainKey(alias), c);
  }
}

/** O(1) lookup by numeric chain id. */
export function chainById(id: number): CanonicalChain | undefined {
  return byId.get(id);
}

/** Exact slug match only (no normalization) — for callers that already hold a canonical slug. */
export function chainBySlug(slug: string): CanonicalChain | undefined {
  return bySlug.get(slug);
}

/** Normalized lookup across slug + name + aliases — resolves a human/legacy chain-name string. */
export function chainByAlias(nameOrAlias: string): CanonicalChain | undefined {
  return byAlias.get(normalizeChainKey(nameOrAlias));
}

/** Anything resolvable to a chain: a numeric id, a native-`bigint` id (eco-routes uses these), a
 *  slug/name/alias string, or an already-resolved `CanonicalChain`. */
export type ChainRef = number | bigint | string | CanonicalChain;

/** Unified front door: number/bigint -> chainById, string -> chainBySlug then chainByAlias, CanonicalChain -> identity. */
export function resolveChain(ref: ChainRef): CanonicalChain | undefined {
  if (typeof ref === "number") return chainById(ref);
  // eco-routes chain ids are natively bigint (e.g. Solana 1399811149n); accept
  // them here so an svm id resolves to its svm record instead of falling
  // through to the object case and silently mis-classifying as evm downstream.
  if (typeof ref === "bigint") {
    return ref >= 0n && ref <= BigInt(Number.MAX_SAFE_INTEGER) ? chainById(Number(ref)) : undefined;
  }
  if (typeof ref === "string") return chainBySlug(ref) ?? chainByAlias(ref);
  return typeof ref === "object" && ref !== null ? ref : undefined;
}

/** `resolveChain` or throw, naming the known set. */
export function requireChain(ref: ChainRef): CanonicalChain {
  const found = resolveChain(ref);
  if (found === undefined) {
    const known = canonicalChains.map((c) => c.slug).join(", ");
    throw new Error(`Unknown chain '${String(ref)}' (known slugs: ${known})`);
  }
  return found;
}

/** Resolves `ref` then tests `kind === 'evm'`. False for an unresolvable ref. */
export function isEvm(ref: ChainRef): boolean {
  return resolveChain(ref)?.kind === "evm";
}

/** Resolves `ref` then tests `kind === 'svm'`. False for an unresolvable ref. */
export function isSvm(ref: ChainRef): boolean {
  return resolveChain(ref)?.kind === "svm";
}

/** Narrowing guard for a value already resolved. */
export function isEvmChain(c: CanonicalChain): c is CanonicalChain & { kind: "evm" } {
  return c.kind === "evm";
}

/** Narrowing guard for a value already resolved. */
export function isSvmChain(c: CanonicalChain): c is CanonicalChain & { kind: "svm" } {
  return c.kind === "svm";
}

/** Every EVM chain, id-ascending. */
export function evmChains(): CanonicalChain[] {
  return canonicalChains
    .filter(isEvmChain)
    .slice()
    .sort((a, b) => a.id - b.id);
}

/** Every SVM chain, id-ascending. */
export function svmChains(): CanonicalChain[] {
  return canonicalChains
    .filter(isSvmChain)
    .slice()
    .sort((a, b) => a.id - b.id);
}

/** Every slug, id-ascending — for building the fluent accessor's key set. */
export function canonicalChainSlugs(): ChainSlug[] {
  return CANONICAL_CHAINS.slice()
    .sort((a, b) => a.id - b.id)
    .map((c) => c.slug);
}
