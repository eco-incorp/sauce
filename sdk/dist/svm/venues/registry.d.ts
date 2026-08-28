import type { SvmVenueAdapter } from './types.js';
declare const adaptersTyped: {
    readonly 'raydium-cp-swap': {
        slug: string;
        kind: "constant-product";
        programId: import("@solana/kit").Address<"CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C">;
        fetchPoolConfig(load: import("./types.js").AccountLoader, pool: import("@solana/kit").Address): Promise<import("./index.js").RaydiumCpSwapPoolConfig>;
        quoteAccounts(base: import("./types.js").PoolConfig): import("./types.js").VenueAccount[];
        emitQuote(base: import("./types.js").PoolConfig, i: number, amountIn: bigint): string;
        buildSwap(base: import("./types.js").PoolConfig, user: import("./types.js").SwapUser, amountIn: bigint): import("./types.js").VenueSwap;
        referenceQuote(base: import("./types.js").PoolConfig, state: import("./types.js").AccountBytesMap, amountIn: bigint, now: bigint): bigint;
    };
    readonly 'raydium-amm-v4': SvmVenueAdapter;
    readonly pumpswap: {
        slug: string;
        kind: "constant-product";
        programId: import("@solana/kit").Address<"pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA">;
        fetchPoolConfig(load: import("./types.js").AccountLoader, pool: import("@solana/kit").Address): Promise<import("./index.js").PumpswapPoolConfig>;
        quoteAccounts(cfg: import("./types.js").PoolConfig): import("./types.js").VenueAccount[];
        emitQuote(cfg: import("./types.js").PoolConfig, i: number, amountIn: bigint): string;
        buildSwap(cfg: import("./types.js").PoolConfig, user: import("./types.js").SwapUser, amountIn: bigint): import("./types.js").VenueSwap;
        referenceQuote(cfg: import("./types.js").PoolConfig, state: import("./types.js").AccountBytesMap, amountIn: bigint, _now: bigint): bigint;
    };
    readonly 'orca-legacy-token-swap': {
        slug: string;
        kind: "constant-product";
        programId: import("@solana/kit").Address;
        fetchPoolConfig(load: import("./types.js").AccountLoader, pool: import("@solana/kit").Address): Promise<import("./index.js").OrcaLegacyPoolConfig>;
        quoteAccounts(cfg: import("./index.js").OrcaLegacyPoolConfig): import("./types.js").VenueAccount[];
        emitQuote(cfg: import("./index.js").OrcaLegacyPoolConfig, i: number, amountIn: bigint): string;
        buildSwap(cfg: import("./index.js").OrcaLegacyPoolConfig, user: import("./types.js").SwapUser, amountIn: bigint): import("./types.js").VenueSwap;
        referenceQuote(cfg: import("./index.js").OrcaLegacyPoolConfig, state: import("./types.js").AccountBytesMap, amountIn: bigint, _now: bigint): bigint;
    };
    readonly 'meteora-damm-v2': {
        slug: string;
        kind: "sqrt-price";
        programId: import("@solana/kit").Address<"cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG">;
        fetchPoolConfig(load: import("./types.js").AccountLoader, pool: import("@solana/kit").Address): Promise<import("./index.js").MeteoraDammV2PoolConfig>;
        quoteAccounts(cfg: import("./types.js").PoolConfig): import("./types.js").VenueAccount[];
        emitQuote(cfg: import("./types.js").PoolConfig, i: number, amountIn: bigint): string;
        buildSwap(cfg: import("./types.js").PoolConfig, user: import("./types.js").SwapUser, amountIn: bigint): import("./types.js").VenueSwap;
        referenceQuote(cfg: import("./types.js").PoolConfig, state: import("./types.js").AccountBytesMap, amountIn: bigint, now: bigint): bigint;
    };
    readonly 'saber-stableswap': SvmVenueAdapter;
    readonly 'meteora-damm-v1-stable': SvmVenueAdapter;
    readonly 'meteora-dbc': {
        slug: string;
        kind: "sqrt-price";
        programId: import("@solana/kit").Address<"dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN">;
        fetchPoolConfig(load: import("./types.js").AccountLoader, pool: import("@solana/kit").Address): Promise<import("./index.js").MeteoraDbcPoolConfig>;
        quoteAccounts(cfg: import("./types.js").PoolConfig): import("./types.js").VenueAccount[];
        emitQuote(cfg: import("./types.js").PoolConfig, i: number, amountIn: bigint): string;
        buildSwap(cfg: import("./types.js").PoolConfig, user: import("./types.js").SwapUser, amountIn: bigint): import("./types.js").VenueSwap;
        referenceQuote(cfg: import("./types.js").PoolConfig, state: import("./types.js").AccountBytesMap, amountIn: bigint, now: bigint): bigint;
    };
    readonly 'stabble-stable-swap': SvmVenueAdapter;
    readonly 'stabble-weighted-swap': SvmVenueAdapter;
};
/** The registered venue slugs, as a literal union — what svm/accessors.ts builds its tree from. */
export type RegisteredVenueSlug = keyof typeof adaptersTyped;
/** Known venue slugs, in table order. */
export declare function listVenues(): string[];
/** Looks up a venue adapter by slug; throws listing the known slugs. */
export declare function venueAdapter(slug: string): SvmVenueAdapter;
export {};
//# sourceMappingURL=registry.d.ts.map