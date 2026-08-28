import type { Address } from '@solana/kit';
import type { AccountLoader, PoolConfig } from '../types.js';
declare const SLUG = "alphaq";
export declare const ALPHAQ_PROGRAM_ID: Address<"ALPHAQmeA7bjrVuccPsYPiCvsi428SNwte66Srvs4pHA">;
/** Minimal getProgramAccounts transport for the stats-account join (data included, unlike the
 *  pubkey-only {@link GetProgramAccountsRpc} discovery.ts uses for candidate scans). */
export interface AlphaqStatsRpc {
    getProgramAccounts(program: Address, config: {
        encoding: 'base64';
        filters: {
            dataSize: bigint;
        }[];
    }): {
        send(): Promise<readonly {
            pubkey: Address;
            account: {
                data: [string, string];
            };
        }[]>;
    };
}
/**
 * One-time (idempotent, memoized) live join for markets not yet in
 * {@link ALPHAQ_STATS_ACCOUNTS}. Safe to call repeatedly/concurrently — every
 * call after the first returns the SAME in-flight/completed promise. A
 * failure here never throws past the caller that awaits it losing anything
 * beyond "no new markets discovered this run" — the static table still
 * serves every market known at integration time.
 *
 * NOT auto-wired into `the consuming app SVM discovery module`'s gPA sweep (deliberately —
 * it would add one extra getProgramAccounts call to EVERY discovery sweep for
 * a table that is already complete for every market that exists today). A
 * caller with its own boot sequence (the api, a CLI, a future cron) should
 * invoke this once with a live `getProgramAccounts` transport to pick up any
 * AlphaQ market added after this file was captured.
 */
export declare function primeAlphaqStatsAccounts(rpc: AlphaqStatsRpc): Promise<void>;
/** Test-only: seed the runtime overlay without a real RPC (LiteSVM/jest fixtures). */
export declare function __setAlphaqStatsAccountsForTest(entries: Readonly<Record<string, Address>>): void;
/** Test-only: undo {@link __setAlphaqStatsAccountsForTest} / a completed prime. */
export declare function __resetAlphaqStatsAccountsForTest(): void;
declare function decodeSymbol(data: Uint8Array): string;
export interface AlphaqPoolConfig extends PoolConfig {
    venue: typeof SLUG;
    /** 'AtoB' (default, mintA -> mintB) | 'BtoA'. */
    direction: 'AtoB' | 'BtoA';
    symbol: string;
    mintA: Address;
    mintB: Address;
    vaultA: Address;
    vaultB: Address;
    decimalsA: number;
    decimalsB: number;
    /** The market's 336-byte hot-state companion account — WRITABLE in the swap CPI. */
    statsAccount: Address;
    /**
     * AlphaQ's live oracle price of mintA in mintB, scaled by {@link PRICE_SCALE}
     * (1e10), read from the stats account at {@link OFF_STATS_PRICE}. `1e10`
     * (parity) for a genuine stablecoin pair; the real spot (e.g. ~1.178e10 for
     * syrupUSDC) for a non-stable one. A non-stable pool is priced at this spot;
     * a stablecoin pool keeps the byte-identical parity model and ignores it.
     */
    priceRaw: bigint;
    /**
     * The unix timestamp (seconds) the oracle price was last cranked, read from
     * the stats account at {@link OFF_STATS_PRICE_TS}. The freshness anchor: a
     * non-stable market is only served when this is recent (see
     * {@link MAX_PRICE_AGE_SECONDS}); carried so the recipe fragment can re-check
     * it LIVE at cook time. 0 for a never-cranked market.
     */
    priceTimestamp: bigint;
    /**
     * True iff BOTH mints are in the curated {@link STABLE_MINTS} set. Stable
     * pools keep the original parity quote (byte/lamport-identical, regression-
     * guarded); non-stable pools use the oracle-priced quote. See
     * `fetchAlphaqPoolConfig`.
     */
    isStablePair: boolean;
}
/**
 * Decode a market (672-byte) account. Throws (caller self-drops, per
 * `resolveSvmPoolSpec`'s existing try/catch) on: a size mismatch; a blank
 * symbol; either mint outside the curated `STABLE_MINTS` set (the "SCOPE
 * GATE" — this ladder's quote model is only safe for a genuine stablecoin
 * pair); mismatched decimals (the raw-unit depth comparison's precondition);
 * or a stats account this integration has neither the static table nor a
 * live prime for. A genuinely unknown/out-of-scope/future market is
 * dropped, never crashed on.
 */
export declare function fetchAlphaqPoolConfig(load: AccountLoader, pool: Address, now?: bigint): Promise<AlphaqPoolConfig>;
/**
 * The symmetric constant-product model — see the module doc's "THE ACTUAL
 * MODEL". `D = min(rawA, rawB)` (raw units; safe because
 * `fetchAlphaqPoolConfig` gates decimalsA === decimalsB) is the conservative
 * shared depth, pinning the spot price at parity (minus the haircut) rather
 * than at the market's possibly-skewed raw reserve RATIO — the fix for the
 * favourable-mispricing bug this file's own test caught (see the module
 * doc's "REJECTED FIRST ATTEMPT").
 */
declare function cpQuote(x: bigint, rawA: bigint, rawB: bigint): bigint;
/**
 * The venue quote. For a STABLE pair this is the ORIGINAL parity model,
 * byte/lamport-identical to before (spot pinned at 1:1). For a NON-stable pair
 * it pins the spot at AlphaQ's live oracle price (`priceRaw`/{@link PRICE_SCALE},
 * mintA->mintB) instead: the symmetric constant-product base
 * (`net*D/(D+net)`, D = min raw vault — the same conservative, depth-
 * understating shape) is scaled by the spot, `AtoB` multiplying by the price
 * and `BtoA` dividing by it. Because the base is direction-symmetric and the
 * spot scaling is applied last, the curve passes through the real spot at
 * x->0 (fixing the parity mispricing that made syrupUSDC quote ~1.0 instead of
 * ~0.849 per USDC) while still understating AlphaQ's true (deeper) depth — the
 * safe direction, since the on-chain CPI executes AlphaQ's own pricing and the
 * recipe's post-swap outAta-delta check bounds the fill.
 *
 * `rawA`/`rawB` are the live raw vault balances (mintA/mintB); `direction`
 * is which way the trade goes ('AtoB' spends mintA). `x` is the gross input in
 * the input side's raw units.
 */
declare function alphaqQuote(x: bigint, rawA: bigint, rawB: bigint, priceRaw: bigint, isStablePair: boolean, direction: 'AtoB' | 'BtoA'): bigint;
export { cpQuote as __alphaqCpQuoteForTest, alphaqQuote as __alphaqQuoteForTest, decodeSymbol as __alphaqDecodeSymbolForTest, };
//# sourceMappingURL=index.d.ts.map