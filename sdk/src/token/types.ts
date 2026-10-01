/**
 * The universal token interface — types + registry constants. Sibling module to `deposit/`:
 * compiler-free, SauceScript SOURCE emission only. See `sdk/src/token/index.ts` for the
 * module-level overview and `sdk/src/token/source.ts` for the per-target emission seam.
 */

/** A 20-byte EVM address, as an ordinary `0x`-prefixed hex string. */
export type Address = `0x${string}`;

/** Anything the token normalizers accept for an address-shaped field. */
export type AddressInput = Address | bigint;

/**
 * `"evm"` is a target-agnostic alias for the ERC20 arm — the emitted SauceScript text is byte-
 * identical for `"evm"`/`"v1"`/`"v12"` (only `compile()`'s own `target` option, not this module,
 * decides which Huff runtime the text lowers against). `"svm"` selects the SPL Token arm.
 */
export type TokenTarget = "evm" | "v1" | "v12" | "svm";

export type TokenOp = "transfer" | "approve" | "balanceOf";

/** SPL Token TransferChecked instruction discriminant. */
export const SPL_TRANSFER_CHECKED = 12;
/** SPL Token ApproveChecked instruction discriminant. */
export const SPL_APPROVE_CHECKED = 13;
/** Offset of the SPL token account's u64 `amount` field (identical in classic SPL + Token-2022). */
export const SPL_AMOUNT_OFFSET = 64;
/** Offset of the mint's `decimals` byte (identical in the first 82 bytes of both programs' mints). */
export const MINT_DECIMALS_OFFSET = 44;

/**
 * SVM account refs a token op needs, as caller-named strings resolved at EXECUTION time (the same
 * contract `svmSettleRefs` establishes) — never resolved addresses baked into the source. Defaults
 * cover the common single-op case; a multi-op program must pass distinct names per op.
 */
export interface SvmTokenRefs {
  /** The SPL token account being debited (transfer/approve) or read (balanceOf). */
  source: string;
  /** The mint, read on-chain for decimals by `*Checked`. Required for transfer/approve. */
  mint?: string;
  /** The recipient's token account. Required for `transfer`. */
  dest?: string;
  /** The delegate's identity (not an account read — see `svm.ts`). Required for `approve`. */
  delegate?: string;
  /** The signing authority. Defaults to `"owner"`. */
  owner?: string;
  /** The CPI-target account ref (must be attached so the engine can resolve the CPI). Defaults to
   *  `"tokenProgram"`. */
  tokenProgram?: string;
}

/**
 * The SVM CPI target VALUE — a well-known program id by name, or a raw pubkey as a bigint. Always a
 * LITERAL: every account identity a program touches is an attach slot, so a caller-supplied identity
 * belongs in `SvmTokenRefs.tokenProgram` (the ref this value is pinned against), never in the value.
 */
export type SvmTokenProgramInput = "spl" | "token-2022" | bigint;

export interface TokenTransferSpec {
  /** EVM: the ERC20 contract. Required on an EVM target. */
  token?: AddressInput;
  /** EVM: the recipient. Required on an EVM target. */
  to?: AddressInput;
  /**
   * `"balance"` reads the live balance instead. A `number` must be a SAFE integer: past 2^53-1 the
   * double has already been rounded, so pass a bigint.
   */
  amount: bigint | number | "balance";
  /** SVM: the account refs this op touches. Required on `target: "svm"`. */
  svm?: SvmTokenRefs;
  /** SVM: the CPI target value. Defaults to `"spl"`. */
  tokenProgram?: SvmTokenProgramInput;
}

export interface TokenApproveSpec {
  token?: AddressInput;
  /** EVM: the approved spender. Required on an EVM target. */
  spender?: AddressInput;
  /**
   * `"balance"` reads the live balance instead. A `number` must be a SAFE integer: past 2^53-1 the
   * double has already been rounded, so pass a bigint.
   */
  amount: bigint | number | "balance";
  svm?: SvmTokenRefs;
  tokenProgram?: SvmTokenProgramInput;
}

export interface TokenBalanceSpec {
  token?: AddressInput;
  /** EVM: the address whose balance is read, or `"self"`. Required on an EVM target. */
  owner?: AddressInput | "self";
  svm?: Pick<SvmTokenRefs, "source">;
}

export type TokenSpec =
  | ({ op: "transfer" } & TokenTransferSpec)
  | ({ op: "approve" } & TokenApproveSpec)
  | ({ op: "balanceOf" } & TokenBalanceSpec);
