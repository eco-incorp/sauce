/**
 * Token-2022 mint extension parsing + the EXACT spl-token-2022 transfer-fee
 * math. This is the correctness layer every SVM venue adapter reuses: a mint's
 * TransferFee changes the amount actually received, so a venue's referenceQuote
 * must net the fee on BOTH the input-side deposit and the output-side
 * withdrawal for the netted quote to match realized on-chain output; and the
 * un-routable extension set makes a mint un-swappable through a plain
 * TransferChecked, so a venue must drop it.
 *
 * LAYOUT (authoritative sources, cross-checked before finalizing):
 *   - The mint's TLV region begins at byte 166 (82-byte base padded to 165,
 *     then a 1-byte account-type discriminator == 1 for Mint at offset 165).
 *     See ./token-program.ts and the orca-so/whirlpools
 *     `MintWithTransferFeeConfigLayout` proptest fixture
 *     (`82 + 83 + 1 + 2 + 2 + 108`).
 *   - Each TLV entry is: extension_type u16 LE, length u16 LE, then `length`
 *     value bytes. type 0 (Uninitialized) terminates the scan.
 *   - TransferFeeConfig (extension_type 1, length 108) value layout, from
 *     spl-token-2022 `TransferFeeConfig` (repr(C), spl-pod little-endian):
 *       +0   transfer_fee_config_authority  Pubkey (32)
 *       +32  withdraw_withheld_authority     Pubkey (32)
 *       +64  withheld_amount                 u64 LE (8)
 *       +72  older_transfer_fee              TransferFee (18)
 *       +90  newer_transfer_fee              TransferFee (18)
 *     TransferFee (18 bytes): epoch u64 LE (8), maximum_fee u64 LE (8),
 *     transfer_fee_basis_points u16 LE (2).
 *   - TransferHook (extension_type 14) value: authority Pubkey (32),
 *     program_id Pubkey (32) — both OptionalNonZeroPubkey (all-zero == None).
 *
 * FEE FORMULA (spl-token-2022 `TransferFee::calculate_fee` /
 * `TransferFeeConfig::calculate_epoch_fee`, cross-checked):
 *   fee = 0                                      if bps == 0 or amount == 0
 *   fee = min(maximum_fee, ceil(amount * bps / 10_000))   otherwise
 * with the TransferFee active at `epoch` chosen as:
 *   newer_transfer_fee  if epoch >= newer_transfer_fee.epoch
 *   older_transfer_fee  otherwise
 * The recipient receives amount - fee.
 */
import { getAddressDecoder } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from './venues/math.js';
import { T22_TLV_START, isToken2022Mint } from './token-program.js';

/** Basis-points denominator (spl-token-2022 ONE_IN_BASIS_POINTS). */
export const ONE_IN_BASIS_POINTS = 10_000n;

// --- Token-2022 mint ExtensionType discriminants (spl-token-2022 ExtensionType) ---
export const EXT_UNINITIALIZED = 0;
export const EXT_TRANSFER_FEE_CONFIG = 1;
export const EXT_CONFIDENTIAL_TRANSFER_MINT = 4;
export const EXT_DEFAULT_ACCOUNT_STATE = 6;
export const EXT_MEMO_TRANSFER = 8; // account-level extension; recognized defensively
export const EXT_NON_TRANSFERABLE = 9;
export const EXT_PERMANENT_DELEGATE = 12;
export const EXT_TRANSFER_HOOK = 14;

/** DefaultAccountState value 2 == Frozen (0 Uninitialized, 1 Initialized, 2 Frozen). */
const ACCOUNT_STATE_FROZEN = 2;

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
  /** Human-readable reasons the mint is un-routable through a plain transfer. */
  blocking: string[];
}

const addressDecoder = getAddressDecoder();

function isAllZero(data: Uint8Array, offset: number, length: number): boolean {
  for (let i = offset; i < offset + length; i++) {
    if (data[i] !== 0) return false;
  }
  return true;
}

/** Parse one TransferFee (18 bytes) at `offset`. */
function parseTransferFee(data: Uint8Array, offset: number): TransferFee {
  return {
    epoch: readUintLE(data, offset, 8),
    maximumFee: readUintLE(data, offset + 8, 8),
    transferFeeBasisPoints: Number(readUintLE(data, offset + 16, 2)),
  };
}

/** Parse a TransferFeeConfig value (108 bytes) starting at `value` offset. */
function parseTransferFeeConfig(data: Uint8Array, value: number): TransferFeeConfig {
  // +0 config authority (32), +32 withdraw authority (32), +64 withheld u64 (8),
  // +72 older TransferFee (18), +90 newer TransferFee (18).
  return {
    olderTransferFee: parseTransferFee(data, value + 72),
    newerTransferFee: parseTransferFee(data, value + 90),
  };
}

/** Parse a TransferHook value: authority (32) + program_id (32). Nil program → undefined. */
function parseTransferHook(data: Uint8Array, value: number, length: number): TransferHookInfo | undefined {
  if (length < 64) return undefined;
  if (isAllZero(data, value + 32, 32)) return undefined; // OptionalNonZeroPubkey::None
  return { programId: addressDecoder.decode(data.subarray(value + 32, value + 64)) };
}

/**
 * Parse the Token-2022 TLV extension region of a mint. Returns
 * `{ blocking: [] }` for a legacy 82-byte mint (or any non-T22 shape). For a
 * Token-2022 mint, recognizes TransferFeeConfig and TransferHook (returned as
 * structured fields) plus the un-routable set (NonTransferable,
 * PermanentDelegate, ConfidentialTransferMint, MemoTransfer-required, and
 * DefaultAccountState frozen), each pushed as a reason string into `blocking`.
 */
export function parseMintExtensions(mintData: Uint8Array): MintExtensions {
  const result: MintExtensions = { blocking: [] };
  if (!isToken2022Mint(mintData)) return result;

  let offset = T22_TLV_START;
  while (offset + 4 <= mintData.length) {
    const type = mintData[offset] | (mintData[offset + 1] << 8);
    const length = mintData[offset + 2] | (mintData[offset + 3] << 8);
    const value = offset + 4;
    if (type === EXT_UNINITIALIZED) break; // zero-padded tail
    if (value + length > mintData.length) break; // truncated entry — stop

    switch (type) {
      case EXT_TRANSFER_FEE_CONFIG:
        if (length >= 108) result.transferFee = parseTransferFeeConfig(mintData, value);
        break;
      case EXT_TRANSFER_HOOK: {
        const hook = parseTransferHook(mintData, value, length);
        if (hook) result.transferHook = hook;
        break;
      }
      case EXT_NON_TRANSFERABLE:
        result.blocking.push('NonTransferable (cannot be swapped)');
        break;
      case EXT_PERMANENT_DELEGATE:
        result.blocking.push('PermanentDelegate (balances can be seized by the delegate)');
        break;
      case EXT_CONFIDENTIAL_TRANSFER_MINT:
        result.blocking.push('ConfidentialTransferMint (amounts are hidden — no plain transfer)');
        break;
      case EXT_MEMO_TRANSFER:
        result.blocking.push('MemoTransfer-required (transfers must carry a memo)');
        break;
      case EXT_DEFAULT_ACCOUNT_STATE:
        if (length >= 1 && mintData[value] === ACCOUNT_STATE_FROZEN) {
          result.blocking.push('DefaultAccountState=frozen (new accounts start frozen)');
        }
        break;
      default:
        break; // any other extension is routing-neutral
    }
    offset = value + length;
  }
  return result;
}

/** The TransferFee active at `epoch`: newer if epoch >= newer.epoch, else older. */
export function getEpochFee(cfg: TransferFeeConfig, epoch: bigint): TransferFee {
  return epoch >= cfg.newerTransferFee.epoch ? cfg.newerTransferFee : cfg.olderTransferFee;
}

/**
 * The transfer fee withheld from `amount` under `cfg` at `epoch`, EXACTLY as
 * spl-token-2022 computes it: 0 when bps or amount is 0, else
 * min(maximum_fee, ceil(amount * bps / 10_000)).
 */
export function calcTransferFee(amount: bigint, cfg: TransferFeeConfig, epoch: bigint): bigint {
  const fee = getEpochFee(cfg, epoch);
  const bps = BigInt(fee.transferFeeBasisPoints);
  if (bps === 0n || amount === 0n) return 0n;
  const numerator = amount * bps;
  const rawFee = (numerator + ONE_IN_BASIS_POINTS - 1n) / ONE_IN_BASIS_POINTS; // ceil
  return rawFee < fee.maximumFee ? rawFee : fee.maximumFee;
}

/** The amount the recipient actually receives: `amount - calcTransferFee(...)`. */
export function netTransferAmount(amount: bigint, cfg: TransferFeeConfig, epoch: bigint): bigint {
  return amount - calcTransferFee(amount, cfg, epoch);
}
