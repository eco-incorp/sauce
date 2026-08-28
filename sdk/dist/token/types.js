/**
 * The universal token interface — types + registry constants. Sibling module to `swap/` and
 * `deposit/`: compiler-free, SauceScript SOURCE emission only. See `sdk/src/token/index.ts` for the
 * module-level overview and `sdk/src/token/source.ts` for the per-target emission seam.
 */
/** SPL Token TransferChecked instruction discriminant. */
export const SPL_TRANSFER_CHECKED = 12;
/** SPL Token ApproveChecked instruction discriminant. */
export const SPL_APPROVE_CHECKED = 13;
/** Offset of the SPL token account's u64 `amount` field (identical in classic SPL + Token-2022). */
export const SPL_AMOUNT_OFFSET = 64;
/** Offset of the mint's `decimals` byte (identical in the first 82 bytes of both programs' mints). */
export const MINT_DECIMALS_OFFSET = 44;
//# sourceMappingURL=types.js.map