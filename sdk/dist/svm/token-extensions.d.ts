import type { Address } from '@solana/kit';
/** Basis-points denominator (spl-token-2022 ONE_IN_BASIS_POINTS). */
export declare const ONE_IN_BASIS_POINTS = 10000n;
export declare const EXT_UNINITIALIZED = 0;
export declare const EXT_TRANSFER_FEE_CONFIG = 1;
export declare const EXT_CONFIDENTIAL_TRANSFER_MINT = 4;
export declare const EXT_DEFAULT_ACCOUNT_STATE = 6;
export declare const EXT_MEMO_TRANSFER = 8;
export declare const EXT_NON_TRANSFERABLE = 9;
export declare const EXT_PERMANENT_DELEGATE = 12;
export declare const EXT_TRANSFER_HOOK = 14;
/** One transfer-fee schedule, valid from `epoch` onward until superseded. */
export interface TransferFee {
    epoch: bigint;
    maximumFee: bigint;
    transferFeeBasisPoints: number;
}
/**
 * A mint's TransferFeeConfig: the older and newer fee schedules. A caller picks
 * the one effective at the current epoch (see `getEpochFee`) — the config
 * carries both so a quote computed near an epoch boundary stays exact.
 */
export interface TransferFeeConfig {
    olderTransferFee: TransferFee;
    newerTransferFee: TransferFee;
}
/** A mint's TransferHook extension (non-nil program only). */
export interface TransferHookInfo {
    programId: Address;
    /**
     * The hook's ExtraAccountMetaList PDA (["extra-account-metas", mint] under
     * `programId`). Requires an async PDA derivation, so this sync parser leaves
     * it undefined; the caller derives it when building the swap.
     */
    extraAccountMetaListPda?: Address;
}
/** Parsed mint extensions relevant to routing. */
export interface MintExtensions {
    /** Present iff a TransferFeeConfig extension is set (fee may still be zero). */
    transferFee?: TransferFeeConfig;
    /** Present iff a TransferHook extension with a non-nil program is set. */
    transferHook?: TransferHookInfo;
    /**
     * HARD un-routable reasons: a plain `transferChecked` into a fresh recipient
     * ATA genuinely fails or the received amount is unusable. Empty for a routable
     * mint. Only NonTransferable and DefaultAccountState=frozen qualify — see the
     * `advisories` note for why PermanentDelegate / ConfidentialTransfer do NOT.
     */
    blocking: string[];
    /**
     * Present-but-routable trust flags. These extensions are carried by the
     * flagship tradeable Token-2022 stablecoins (PYUSD, USDG both set
     * PermanentDelegate AND ConfidentialTransferMint) yet transfer normally on
     * every Solana DEX — so they must NOT self-drop the pool (doing so defeats the
     * entire point of T22 support). They are surfaced here for a caller that wants
     * to gate on trust policy, but routing treats them as safe. Verified against
     * live mainnet mint bytes (see test/svm/fixtures/token-2022/real-mints.json):
     * a ConfidentialTransferMint enables confidential transfers as an OPT-IN per
     * account, leaving plain transfers intact; a PermanentDelegate is a
     * clawback/compliance authority, not a transfer gate.
     */
    advisories: string[];
}
/**
 * Parse the Token-2022 TLV extension region of a mint. Returns
 * `{ blocking: [] }` for a legacy 82-byte mint (or any non-T22 shape). For a
 * Token-2022 mint, recognizes TransferFeeConfig and TransferHook (returned as
 * structured fields) plus the un-routable set (NonTransferable,
 * PermanentDelegate, ConfidentialTransferMint, MemoTransfer-required, and
 * DefaultAccountState frozen), each pushed as a reason string into `blocking`.
 */
export declare function parseMintExtensions(mintData: Uint8Array): MintExtensions;
/** The TransferFee active at `epoch`: newer if epoch >= newer.epoch, else older. */
export declare function getEpochFee(cfg: TransferFeeConfig, epoch: bigint): TransferFee;
/**
 * The transfer fee withheld from `amount` under `cfg` at `epoch`, EXACTLY as
 * spl-token-2022 computes it: 0 when bps or amount is 0, else
 * min(maximum_fee, ceil(amount * bps / 10_000)).
 */
export declare function calcTransferFee(amount: bigint, cfg: TransferFeeConfig, epoch: bigint): bigint;
/** The amount the recipient actually receives: `amount - calcTransferFee(...)`. */
export declare function netTransferAmount(amount: bigint, cfg: TransferFeeConfig, epoch: bigint): bigint;
//# sourceMappingURL=token-extensions.d.ts.map