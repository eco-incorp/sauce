/**
 * Venue-adapter framework for the multi-venue solswap recipe: one adapter per
 * on-chain venue (raydium, pumpswap, orca, saber, meteora, ...) that decodes
 * pool state off-chain, emits the in-VM SauceScript quote fragment, builds the
 * venue's swap CPI, and mirrors the quote math in TS for tests.
 */
import type { Address } from '@solana/kit';
/**
 * RPC-or-fixture account source: address in, raw account data out (null when
 * the account does not exist). fetchPoolConfig takes one of these so LiteSVM
 * fixture tests run without any RPC.
 */
export type AccountLoader = (address: Address) => Promise<Uint8Array | null>;
/**
 * Point-in-time account state keyed by base58 address — what referenceQuote
 * reads instead of the chain.
 */
export type AccountBytesMap = Record<string, Uint8Array>;
/**
 * Base shape of a decoded pool configuration. Each adapter extends it with
 * the venue-specific fields its quote emitter and swap builder need (vault
 * addresses, fee parameters, curve constants, ...) — everything is resolved
 * once, off-chain, by fetchPoolConfig.
 */
export interface PoolConfig {
    /** Slug of the adapter that produced this config. */
    venue: string;
    /** Pool state account address. */
    pool: Address;
}
/**
 * One account attached to the generated program. `ref` is the symbolic
 * account-plan ref used in generated SauceScript; `address` is present when
 * the adapter resolved it from PoolConfig and absent for caller-resolved refs
 * (the user's token accounts / owner from SwapUser).
 */
export interface VenueAccount {
    ref: string;
    address?: Address;
    writable?: boolean;
    signer?: boolean;
    /**
     * quoteRefs only: the account may legitimately NOT EXIST on-chain (e.g. an
     * uninitialized whirlpool TickArray PDA beyond the readable window). The
     * orchestrator's state fetch skips it when missing instead of throwing;
     * the fragment must never read it (a param/live gate decides), though it
     * still rides the transaction account list for the venue CPI.
     */
    optional?: boolean;
}
/**
 * User-side refs for buildSwap. Refs, not addresses: the caller resolves them
 * (resolveAccounts) when sending.
 */
export interface SwapUser {
    /** Ref of the user's output-token account. */
    outAta: string;
    /** Ref of the user's input-token account. */
    inAta: string;
    /** Ref of the user's wallet — token authority, attached as signer. */
    owner: string;
}
/**
 * A ready-to-CPI venue swap: raw instruction data plus its ordered accounts.
 * Venue-level min_out is always 1 — the recipe's post-swap outAta delta check
 * enforces the real bound.
 */
export interface VenueSwap {
    /** CALL target program id, baked into the bytecode. */
    programId: Address;
    /** Raw instruction data, discriminator included. */
    data: Uint8Array;
    /** Ordered exactly as the venue instruction expects. */
    accounts: VenueAccount[];
}
export interface SvmVenueAdapter {
    slug: string;
    kind: 'constant-product' | 'stable' | 'sqrt-price';
    /** Mainnet program id. */
    programId: Address;
    /**
     * Off-chain, once per pool: fetch + decode the pool account (and its
     * config/vault deps), returning everything the emitter and swap builder
     * need. Accepts raw account data via the AccountLoader so LiteSVM fixtures
     * work without RPC. Throws a clear error naming the gate when the pool is
     * out of scope (status bits, curve_type, depeg, transfer-fee extensions).
     */
    fetchPoolConfig(load: AccountLoader, pool: Address): Promise<PoolConfig>;
    /** Accounts to attach READ-ONLY for quoting (refs + resolved addresses from PoolConfig). */
    quoteAccounts(cfg: PoolConfig): VenueAccount[];
    /**
     * SauceScript fragment computing `const q<i> = <amountOut>` for exactIn
     * amountIn (bigint literal baked). May call shared helper functions
     * (declared once by the generator).
     */
    emitQuote(cfg: PoolConfig, i: number, amountIn: bigint): string;
    /**
     * Swap CPI: raw instruction data + ordered account entries; venue-level
     * min_out set to 1 (the post-swap delta check enforces the real bound).
     */
    buildSwap(cfg: PoolConfig, user: SwapUser, amountIn: bigint): VenueSwap;
    /**
     * TS mirror of emitQuote for tests — MUST be independently derived from the
     * venue's quote formula in docs/svm-venues.md, not from reading the emitted
     * SauceScript. `state`
     * carries the accounts emitQuote reads; `now` is the unix timestamp for
     * time-dependent venues (amp ramps, locked-profit decay).
     */
    referenceQuote(cfg: PoolConfig, state: AccountBytesMap, amountIn: bigint, now: bigint): bigint;
}
//# sourceMappingURL=types.d.ts.map