import type { Address } from '@solana/kit';
export declare const TOKEN_PROGRAM: Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;
export declare const TOKEN_2022_PROGRAM: Address<"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb">;
export declare const ASSOCIATED_TOKEN_PROGRAM: Address<"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL">;
export declare const SYSTEM_PROGRAM: Address<"11111111111111111111111111111111">;
export declare const SCALE_AMM_PROGRAM_ID: Address<"SCALEwAvEK5gtkdHiFzXfPgtk2YwJxPDzaV3aDmR7tA">;
export declare const SCALE_VMM_PROGRAM_ID: Address<"SCALEWoRSpVZpMRqHEcDfNvBh3nUSe34jDr9r689gLa">;
/** Anchor global instruction discriminators (sha256("global:<name>")[0..8]). */
export declare const BUY_DISCRIMINATOR: Uint8Array<ArrayBuffer>;
export declare const SELL_DISCRIMINATOR: Uint8Array<ArrayBuffer>;
export declare const FEE_BENEFICIARY_SLOTS = 5;
export declare function readUintLE(data: Uint8Array, offset: number, width: number): bigint;
export declare function pubkeyAt(data: Uint8Array, offset: number): Address;
export interface FeeBeneficiary {
    wallet: Address;
    shareBps: number;
}
/** Reads all FEE_BENEFICIARY_SLOTS entries unconditionally (inactive slots are zero-inited). */
export declare function readFeeBeneficiaries(data: Uint8Array, offset: number): FeeBeneficiary[];
/** The literal ASCII seed both programs' PlatformConfig PDA uses (seeds=["config"]). */
export declare const CONFIG_SEED: Uint8Array<ArrayBuffer>;
/** The literal ASCII seed scale_amm's own (non-VMM-migrated) Pool PDA uses (seeds=["pool", owner, mint_a, mint_b]). */
export declare const POOL_SEED: Uint8Array<ArrayBuffer>;
declare function pda(seeds: (Address | Uint8Array)[], programAddress: Address): Promise<Address>;
/** Associated Token Account address: PDA([owner, tokenProgram, mint], ASSOCIATED_TOKEN_PROGRAM). */
export declare function ata(owner: Address, mint: Address, tokenProgram: Address): Promise<Address>;
export { pda };
/**
 * Which token program serves this mint, from its account data alone — the SAME
 * detection + gate the sauce-sdk pumpswap adapter uses (a classic layout is exactly 82
 * bytes; an extensionless token-2022 mint is indistinguishable from it, but neither Scale
 * program is known to interact with such a mint in practice, so this stays conservative
 * like pumpswap's own copy). A TransferFeeConfig extension makes real wire amounts
 * diverge from the quote (a portion of every transfer is withheld by the mint itself), so
 * such mints are rejected rather than mis-quoted.
 */
export declare function detectTokenProgram(mint: Address, data: Uint8Array): Address;
/** CurveType::ConstantProduct — the only variant this adapter supports (see module doc). */
export declare const CURVE_CONSTANT_PRODUCT = 0;
export type ScaleDirection = 'aToB' | 'bToA';
export interface ScaleCurveState {
    reservesA: bigint;
    reservesB: bigint;
    shift: bigint;
    platformFeeBps: bigint;
    shareBps: readonly bigint[];
}
/** TS mirror of the `qScaleCurve` SauceScript helper — see module doc for the derivation. */
export declare function computeScaleQuote(state: ScaleCurveState, amountIn: bigint, direction: ScaleDirection): bigint;
/** Effective (reserveIn, reserveOut) for the relative-depth filter — the VIRTUAL reserves the curve above actually prices against. */
export declare function scaleDepthReserves(state: ScaleCurveState, direction: ScaleDirection): {
    reserveIn: bigint;
    reserveOut: bigint;
};
/** Continuous-oracle fee model (measurement only). */
export declare function scaleContinuousFees(state: ScaleCurveState, direction: ScaleDirection): {
    gammaPpm: bigint;
    muPpm: bigint;
};
/**
 * The shared quote-curve helper, deduped BY NAME across both scale-amm and scale-vmm
 * (byte-identical source — the
 * two programs' math is identical, only account layouts differ). `dir` is 0 for
 * aToB (buy: fee on input) and nonzero for bToA (sell: fee on gross output).
 */
export declare const SCALE_CURVE_HELPER_NAME = "qScaleCurve";
export declare const SCALE_CURVE_HELPER_SOURCE: string;
//# sourceMappingURL=scale-common.d.ts.map