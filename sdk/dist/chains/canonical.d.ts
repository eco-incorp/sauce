/**
 * CANONICAL CHAIN REGISTRY — identity only, additive, zero runtime coupling.
 *
 * `chains` (./index.ts) is EVM-only and has no `slug`; `../deployments/` knows
 * chain SLUGS but only for the 12 chains in the v12 deploy record, and only
 * gated on whether the stack is LIVE there. Neither answers the plain question
 * "what is this chain called, and what kind of VM does it run" for the full
 * union — including the 5 v12-only EVM chains and Solana, which have no
 * `chains` entry at all.
 *
 * This module is a flat, hand-maintained data table answering exactly that
 * question, for both EVM and SVM chains in ONE numeric id space. It carries no
 * rpcUrls / nativeCurrency / blockExplorerUrls / testnet — those already live on
 * `chains` for the ids that have them; a consumer needing that data still goes
 * through `getChain(id)`, which returns `undefined` for the 5 v12-only EVM
 * chains and for Solana.
 *
 * Deliberately NOT wired to `../deployments/` or `../protocols/` — no import
 * cycle, no runtime coupling. `v12ChainSlug`/`v12LiveChainSlugs` answer
 * "can I cook here", a LIVENESS question; this module answers "what is this
 * chain called", an IDENTITY question. Ronin (2020) is registered here even
 * though its v12 deploy failed — see `test/chains-canonical.test.ts` for the
 * pinned proof that the two layers are intentionally decoupled.
 *
 * MAINTENANCE NOTE: this table is hand-maintained, not derived. A chain added
 * to `chains` (./index.ts) or to `V12_EVM_CHAINS` (../deployments/v12.generated.ts,
 * rewritten by `sync-engine-artifacts` on every engine repin) will fail
 * `test/chains-canonical.test.ts` until a matching entry is added here — that is
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
    /** Stable lowercase kebab-case key. For the 12 chains in the v12 deploy record this IS that record's `name`. */
    readonly slug: string;
    /** Canonical display name. For every id present in `chains`, this is byte-identical to `chains[id].name`. */
    readonly name: string;
    readonly kind: ChainKind;
    /** Additional accepted spellings. Matched case- and punctuation-insensitively, same as `slug` and `name`. */
    readonly aliases: readonly string[];
}
export declare const CANONICAL_CHAINS: readonly [{
    readonly id: 1;
    readonly slug: "ethereum";
    readonly name: "Ethereum";
    readonly kind: "evm";
    readonly aliases: readonly ["mainnet", "eth"];
}, {
    readonly id: 10;
    readonly slug: "optimism";
    readonly name: "Optimism";
    readonly kind: "evm";
    readonly aliases: readonly ["op", "op-mainnet"];
}, {
    readonly id: 56;
    readonly slug: "bsc";
    readonly name: "BNB Chain";
    readonly kind: "evm";
    readonly aliases: readonly ["bnb", "binance-smart-chain", "bnb-smart-chain"];
}, {
    readonly id: 137;
    readonly slug: "polygon";
    readonly name: "Polygon";
    readonly kind: "evm";
    readonly aliases: readonly ["matic", "polygon-pos"];
}, {
    readonly id: 8453;
    readonly slug: "base";
    readonly name: "Base";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 42161;
    readonly slug: "arbitrum";
    readonly name: "Arbitrum One";
    readonly kind: "evm";
    readonly aliases: readonly ["arb"];
}, {
    readonly id: 42220;
    readonly slug: "celo";
    readonly name: "Celo";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 25;
    readonly slug: "cronos";
    readonly name: "Cronos";
    readonly kind: "evm";
    readonly aliases: readonly ["cro"];
}, {
    readonly id: 100;
    readonly slug: "gnosis";
    readonly name: "Gnosis";
    readonly kind: "evm";
    readonly aliases: readonly ["xdai", "gnosis-chain"];
}, {
    readonly id: 122;
    readonly slug: "fuse";
    readonly name: "Fuse";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 169;
    readonly slug: "manta";
    readonly name: "Manta Pacific";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 204;
    readonly slug: "opbnb";
    readonly name: "opBNB";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 250;
    readonly slug: "fantom";
    readonly name: "Fantom";
    readonly kind: "evm";
    readonly aliases: readonly ["ftm", "opera", "fantom-opera"];
}, {
    readonly id: 288;
    readonly slug: "boba";
    readonly name: "Boba";
    readonly kind: "evm";
    readonly aliases: readonly ["boba-network"];
}, {
    readonly id: 324;
    readonly slug: "zksync";
    readonly name: "zkSync Era";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 369;
    readonly slug: "pulsechain";
    readonly name: "PulseChain";
    readonly kind: "evm";
    readonly aliases: readonly ["pls"];
}, {
    readonly id: 1088;
    readonly slug: "metis";
    readonly name: "Metis";
    readonly kind: "evm";
    readonly aliases: readonly ["andromeda", "metis-andromeda"];
}, {
    readonly id: 1116;
    readonly slug: "core";
    readonly name: "Core";
    readonly kind: "evm";
    readonly aliases: readonly ["coredao", "core-dao"];
}, {
    readonly id: 1284;
    readonly slug: "moonbeam";
    readonly name: "Moonbeam";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 1329;
    readonly slug: "sei";
    readonly name: "Sei";
    readonly kind: "evm";
    readonly aliases: readonly ["sei-evm"];
}, {
    readonly id: 2222;
    readonly slug: "kava";
    readonly name: "Kava";
    readonly kind: "evm";
    readonly aliases: readonly ["kava-evm"];
}, {
    readonly id: 5000;
    readonly slug: "mantle";
    readonly name: "Mantle";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 7000;
    readonly slug: "zetachain";
    readonly name: "ZetaChain";
    readonly kind: "evm";
    readonly aliases: readonly ["zeta"];
}, {
    readonly id: 8217;
    readonly slug: "klaytn";
    readonly name: "Klaytn";
    readonly kind: "evm";
    readonly aliases: readonly ["kaia"];
}, {
    readonly id: 9001;
    readonly slug: "evmos";
    readonly name: "Evmos";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 34443;
    readonly slug: "mode";
    readonly name: "Mode";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 43114;
    readonly slug: "avalanche";
    readonly name: "Avalanche C-Chain";
    readonly kind: "evm";
    readonly aliases: readonly ["avax"];
}, {
    readonly id: 59144;
    readonly slug: "linea";
    readonly name: "Linea";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 80094;
    readonly slug: "berachain";
    readonly name: "Berachain";
    readonly kind: "evm";
    readonly aliases: readonly ["bera"];
}, {
    readonly id: 81457;
    readonly slug: "blast";
    readonly name: "Blast";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 534352;
    readonly slug: "scroll";
    readonly name: "Scroll";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 7777777;
    readonly slug: "zora";
    readonly name: "Zora";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 1313161554;
    readonly slug: "aurora";
    readonly name: "Aurora";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 130;
    readonly slug: "unichain";
    readonly name: "Unichain";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 146;
    readonly slug: "sonic";
    readonly name: "Sonic";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 2020;
    readonly slug: "ronin";
    readonly name: "Ronin";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 9745;
    readonly slug: "plasma";
    readonly name: "Plasma";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 57073;
    readonly slug: "ink";
    readonly name: "Ink";
    readonly kind: "evm";
    readonly aliases: readonly [];
}, {
    readonly id: 1399811149;
    readonly slug: "solana";
    readonly name: "Solana";
    readonly kind: "svm";
    readonly aliases: readonly ["sol", "mainnet-beta", "solana-mainnet"];
}];
/** The literal slug union — what the fluent accessor and route shortcuts key their builder types off. */
export type ChainSlug = (typeof CANONICAL_CHAINS)[number]["slug"];
/** Widened alias for ordinary iteration/mapping. */
export declare const canonicalChains: readonly CanonicalChain[];
/** The ONE normalizer: lowercased, trimmed, punctuation/whitespace stripped. */
export declare function normalizeChainKey(input: string): string;
/** O(1) lookup by numeric chain id. */
export declare function chainById(id: number): CanonicalChain | undefined;
/** Exact slug match only (no normalization) — for callers that already hold a canonical slug. */
export declare function chainBySlug(slug: string): CanonicalChain | undefined;
/** Normalized lookup across slug + name + aliases — resolves a human/legacy chain-name string. */
export declare function chainByAlias(nameOrAlias: string): CanonicalChain | undefined;
/** Anything resolvable to a chain: a numeric id, a native-`bigint` id (eco-routes uses these), a
 *  slug/name/alias string, or an already-resolved `CanonicalChain`. */
export type ChainRef = number | bigint | string | CanonicalChain;
/** Unified front door: number/bigint -> chainById, string -> chainBySlug then chainByAlias, CanonicalChain -> identity. */
export declare function resolveChain(ref: ChainRef): CanonicalChain | undefined;
/** `resolveChain` or throw, mirroring `requireV12Deployment`'s existing throw-with-the-known-set style. */
export declare function requireChain(ref: ChainRef): CanonicalChain;
/** Resolves `ref` then tests `kind === 'evm'`. False for an unresolvable ref. */
export declare function isEvm(ref: ChainRef): boolean;
/** Resolves `ref` then tests `kind === 'svm'`. False for an unresolvable ref. */
export declare function isSvm(ref: ChainRef): boolean;
/** Narrowing guard for a value already resolved. */
export declare function isEvmChain(c: CanonicalChain): c is CanonicalChain & {
    kind: "evm";
};
/** Narrowing guard for a value already resolved. */
export declare function isSvmChain(c: CanonicalChain): c is CanonicalChain & {
    kind: "svm";
};
/** Every EVM chain, id-ascending. */
export declare function evmChains(): CanonicalChain[];
/** Every SVM chain, id-ascending. */
export declare function svmChains(): CanonicalChain[];
/** Every slug, id-ascending — for building the fluent accessor's key set. */
export declare function canonicalChainSlugs(): ChainSlug[];
//# sourceMappingURL=canonical.d.ts.map