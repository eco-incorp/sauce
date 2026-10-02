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
 *   - ScaledUiAmountConfig (extension_type 25) value: authority Pubkey (32),
 *     multiplier f64 (8), new_multiplier_effective_timestamp i64 (8),
 *     new_multiplier f64 (8). A display multiplier only: every amount an
 *     instruction or a program sees is raw.
 *   - PausableConfig (extension_type 26) value: authority Pubkey (32), paused
 *     bool (1). While paused, Token-2022 refuses transfers, mints and burns.
 *
 * FEE FORMULA (spl-token-2022 `TransferFee::calculate_fee` /
 * `TransferFeeConfig::calculate_epoch_fee`, cross-checked):
 *   fee = 0                                      if bps == 0 or amount == 0
 *   fee = min(maximum_fee, ceil(amount * bps / 10_000))   otherwise
 * with the TransferFee active at `epoch` chosen as:
 *   newer_transfer_fee  if epoch >= newer_transfer_fee.epoch
 *   older_transfer_fee  otherwise
 * The recipient receives amount - fee.
 *
 * The INVERSE (spl-token-2022 `TransferFee::calculate_pre_fee_amount`), the
 * amount to send for the recipient to receive exactly `received`:
 *   received                                     if bps == 0
 *   0                                            if received == 0
 *   received + maximum_fee                       if bps == 10_000
 *   otherwise raw = ceil(received * 10_000 / (10_000 - bps)), and
 *   received + maximum_fee                       if raw - received >= maximum_fee
 *   raw                                          otherwise
 * The fee on that amount is exactly the difference, so the recipient nets
 * `received` to the unit.
 */
import { getAddressDecoder } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "./venues/math.js";
import { T22_TLV_START, isToken2022Mint } from "./token-program.js";

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
export const EXT_SCALED_UI_AMOUNT = 25;
export const EXT_PAUSABLE = 26;

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
  /**
   * HARD un-routable reasons: a plain `transferChecked` into a fresh recipient
   * ATA genuinely fails or the received amount is unusable. Empty for a routable
   * mint. Only NonTransferable, DefaultAccountState=frozen and a paused
   * Pausable mint qualify — see the `advisories` note for why PermanentDelegate
   * / ConfidentialTransfer do NOT.
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
function parseTransferHook(
  data: Uint8Array,
  value: number,
  length: number,
): TransferHookInfo | undefined {
  if (length < 64) return undefined;
  if (isAllZero(data, value + 32, 32)) return undefined; // OptionalNonZeroPubkey::None
  return { programId: addressDecoder.decode(data.subarray(value + 32, value + 64)) };
}

/**
 * Parse the Token-2022 TLV extension region of a mint. Returns
 * `{ blocking: [], advisories: [] }` for a legacy 82-byte mint (or any non-T22
 * shape). For a Token-2022 mint, recognizes TransferFeeConfig and TransferHook
 * (returned as structured fields), the un-routable set (NonTransferable,
 * DefaultAccountState frozen, Pausable paused), each pushed as a reason string
 * into `blocking`, and the routable trust flags (PermanentDelegate,
 * ConfidentialTransferMint, Pausable not paused, ScaledUiAmount, MemoTransfer),
 * each pushed into `advisories`.
 */
export function parseMintExtensions(mintData: Uint8Array): MintExtensions {
  const result: MintExtensions = { blocking: [], advisories: [] };
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
        result.blocking.push("NonTransferable (cannot be transferred at all)");
        break;
      case EXT_DEFAULT_ACCOUNT_STATE:
        if (length >= 1 && mintData[value] === ACCOUNT_STATE_FROZEN) {
          // A freshly created recipient ATA starts frozen and cannot receive
          // until the freeze authority thaws it — un-routable for a plain swap.
          result.blocking.push("DefaultAccountState=frozen (new accounts start frozen)");
        }
        break;
      case EXT_PERMANENT_DELEGATE:
        // NOT blocking: a clawback/compliance authority, not a transfer gate.
        // PYUSD/USDG both carry it and trade normally everywhere.
        result.advisories.push("PermanentDelegate (a delegate authority can move/burn balances)");
        break;
      case EXT_CONFIDENTIAL_TRANSFER_MINT:
        // NOT blocking: confidential transfers are OPT-IN per account; plain
        // transferChecked still works. PYUSD/USDG both carry it.
        result.advisories.push(
          "ConfidentialTransferMint (confidential transfers are opt-in; plain transfers still work)",
        );
        break;
      case EXT_PAUSABLE:
        if (length >= 33 && mintData[value + 32] !== 0) {
          // Token-2022 refuses every transfer, mint and burn until the authority resumes it.
          result.blocking.push("Pausable=paused (transfers fail until the mint is resumed)");
        } else {
          // Tokenized stocks carry it unpaused: an issuer's switch, not a transfer gate today.
          result.advisories.push("Pausable (the issuer can pause transfers)");
        }
        break;
      case EXT_SCALED_UI_AMOUNT:
        // NOT blocking: a display multiplier. Balances, transfers and quotes stay raw.
        result.advisories.push(
          "ScaledUiAmount (a UI amount is the raw amount times a multiplier; amounts here are raw)",
        );
        break;
      case EXT_MEMO_TRANSFER:
        // Account-level extension — cannot appear on a mint; recognized only
        // defensively. Surfaced as advisory, never a mint-level block.
        result.advisories.push("MemoTransfer (account-level; not expected on a mint)");
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

/**
 * The amount to send under `cfg` at `epoch` for the recipient to receive exactly `received`, as
 * spl-token-2022's `calculate_pre_fee_amount` computes it (the formula is in this file's header):
 * `netTransferAmount(grossTransferAmount(r, cfg, e), cfg, e) === r`.
 */
export function grossTransferAmount(
  received: bigint,
  cfg: TransferFeeConfig,
  epoch: bigint,
): bigint {
  const fee = getEpochFee(cfg, epoch);
  const bps = BigInt(fee.transferFeeBasisPoints);
  if (bps === 0n) return received;
  if (received === 0n) return 0n;
  if (bps === ONE_IN_BASIS_POINTS) return received + fee.maximumFee;
  const denominator = ONE_IN_BASIS_POINTS - bps;
  const raw = (received * ONE_IN_BASIS_POINTS + denominator - 1n) / denominator; // ceil
  return raw - received >= fee.maximumFee ? received + fee.maximumFee : raw;
}
