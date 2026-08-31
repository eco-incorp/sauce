import type { Address } from '@solana/kit';
import type { AccountLoader, PoolConfig } from '../types.js';
declare const SLUG = "tesserav";
export declare const TESSERAV_PROGRAM_ID: Address<"TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH">;
export declare const TOKEN_PROGRAM: Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;
export declare const OFF_MID = 144;
export declare const MID_SCALE = 1000000000000000n;
export declare const OFF_LADDER_AB = 168;
export declare const AB_STRIDE = 24;
export declare const AB_OFF_PRICE = 0;
export declare const AB_OFF_CUM = 16;
export declare const OFF_LADDER_BA = 640;
export declare const BA_STRIDE = 24;
export declare const BA_OFF_CUM = 0;
export declare const BA_OFF_PRICE = 8;
export declare const TESSERAV_LEVEL_SLOTS = 10;
export declare const PRICE_PPM_DEN = 1000000n;
/** Minimum pool account size this adapter reads from (level 9's last byte + 1). */
export declare const TESSERAV_MIN_POOL_SIZE: number;
export interface TesseraVPoolConfig extends PoolConfig {
    venue: typeof SLUG;
    /** 'aToB' sells mintA for mintB (ix direction byte 1); 'bToA' is the reverse (byte 0). */
    direction: 'aToB' | 'bToA';
    mintA: Address;
    mintB: Address;
    /**
     * The program's GLOBAL vault-authority singleton (TESSERAV_GLOBAL_AUTH) —
     * read-only in the swap ix. NOT a per-pool fact and NOT a PDA/registry (see
     * TESSERAV_GLOBAL_AUTH's doc).
     */
    auth: Address;
    /** Global-per-mint vault for mintA (authority = auth). */
    vaultA: Address;
    /** Global-per-mint vault for mintB (authority = auth). */
    vaultB: Address;
}
/**
 * The TesseraV vault-AUTHORITY — a FIXED GLOBAL SINGLETON, correcting the
 * earlier "per-pool fact" framing. It is one program-owned (owner =
 * TessVdML…), 10240-byte account that is byte-identical as the swap CPI's
 * account[0] across every pool traced (SOL/USDC, cbBTC/USDC, BONK/USDC). It is
 * NOT a PDA of the program under any tried seed, and NOT a mint→vault registry
 * (the 10240 bytes contain none of the mint or vault bytes) — so it is carried
 * as this verified constant, never derived. Verified against live swap-CPI
 * traces (SOL/USDC sig 3p2JFpLN…, cbBTC/USDC sig 4KZPEcyC…, BONK/USDC sig
 * 3JZMZyMy…), all giving account[0] = 8ekCy2….
 */
export declare const TESSERAV_GLOBAL_AUTH: Address<"8ekCy2jHHUbW2yeNGFWYJT9Hm9FW7SvZcZK66dSZCDiF">;
/**
 * Committed global-per-mint vault cache. Each TesseraV vault is a plain
 * keypair-generated legacy-SPL token account that is (a) authority =
 * TESSERAV_GLOBAL_AUTH and (b) GLOBAL PER MINT — one shared vault per token,
 * reused by every pool touching that token (measured: the SOL/USDC and
 * cbBTC/USDC pools share the SAME USDC vault 9t4P5w…). Vaults are stable, so
 * this map is the RPC-free fast path; a mint NOT here resolves through the
 * optional `resolveVault` (getTokenAccountsByOwner) arg of fetchTesseraVConfig
 * — which `pickTesseraVVault` implements — or self-drops. Refresh this map with
 * that same owner-scoped sweep, keyed off TESSERAV_GLOBAL_AUTH. Only vaults
 * verified byte-exactly against a live swap-CPI trace are seeded here.
 */
export declare const TESSERAV_KNOWN_VAULTS: Readonly<Record<string, Address>>;
/**
 * One legacy-SPL token account owned by an authority, as returned by an RPC
 * `getTokenAccountsByOwner(owner, { mint })`. `amount` (the u64 token balance)
 * is optional and consulted ONLY to break a >1 ambiguity (largest wins).
 */
export interface TesseraVOwnedTokenAccount {
    address: Address;
    amount?: bigint;
}
/**
 * Resolver for a global-per-mint TesseraV vault: given the authority and a
 * mint, return the vault address, or null to self-drop when no vault exists
 * yet. A real caller backs this with an RPC
 * `getTokenAccountsByOwner(owner, { mint })` fed through `pickTesseraVVault`.
 * Threaded into fetchTesseraVConfig because the single-account AccountLoader
 * cannot express an owner-scoped scan.
 */
export type TesseraVVaultResolver = (owner: Address, mint: Address) => Promise<Address | null>;
/**
 * Exclude-ATA vault picker — the GENERAL derivation core. Of the legacy-SPL
 * token accounts owned by `owner` for `mint`, drop the canonical
 * ATA(owner, mint, TOKEN_PROGRAM) (observed as a dust account for USDC: the
 * real vault 9t4P5w… alongside its ATA at ~50000) and return the single
 * remainder. 0 remainders → null (the global vault does not exist yet →
 * self-drop). >1 remainders → the largest-balance one when balances are known,
 * else null (ambiguous → self-drop rather than guess) — the caveat the debug
 * flagged for the >1 case.
 */
export declare function pickTesseraVVault(owner: Address, mint: Address, owned: readonly TesseraVOwnedTokenAccount[]): Promise<Address | null>;
/** Level-0 price (ppm of 1e6) for a direction — non-increasing across slots, this adapter ships slot 0 only. */
export declare function level0PriceOffset(direction: 'aToB' | 'bToA'): number;
/** Level-0 capacity, in OUTPUT-token raw units, for a direction. */
export declare function level0CumOffset(direction: 'aToB' | 'bToA'): number;
/**
 * Fetch + gate one TesseraV pool. Read-only against the loader. Gates: wrong
 * owner/size, an unprimed mid (0 — a pool the maker bot has never quoted),
 * and a zero/absent level-0 price or capacity (an empty book for this
 * direction — self-drop, not a revert, at the orchestrator layer).
 */
export declare function fetchTesseraVConfig(load: AccountLoader, pool: Address, direction: 'aToB' | 'bToA', resolveVault?: TesseraVVaultResolver): Promise<TesseraVPoolConfig>;
/** Family facade for the recipe orchestrator (ladder-only — not in the v1 registry). */
export declare const tesserav: {
    slug: string;
    programId: Address<"TessVdML9pBGgG9yGks7o4HewRaXVAMuoVj4x83GLQH">;
    tokenProgram: Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;
    fetchPoolConfig: typeof fetchTesseraVConfig;
};
export {};
//# sourceMappingURL=index.d.ts.map