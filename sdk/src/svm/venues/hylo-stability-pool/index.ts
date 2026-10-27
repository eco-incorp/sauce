/**
 * Hylo Stability Pool ("Earn Pool") — a single GLOBAL Anchor vault on program
 * `HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ` (Jupiter's own label for this
 * program id, per `benchmark/adapters/fixtures/jupiter-program-id-to-label.json`,
 * is verbatim "Hylo Stability Pool"). Users deposit hyUSD and receive sHYUSD
 * (the pool's own `staked_hyUSD` LP-share mint) via `user_deposit`; `user_withdraw`
 * burns sHYUSD for hyUSD, net of a configured withdrawal fee. There is exactly
 * ONE `PoolConfig` account and ONE vault/mint pair for the life of the program —
 * unlike every OTHER family in this recipe (a scanned-by-mint universe of many
 * pools), this is a SINGLETON with no per-pair discovery: every address below is
 * a deterministic PDA of one of two immutable program ids, computed OFFLINE (no
 * RPC) and hardcoded as a constant.
 *
 * SOURCE: this program's own on-chain Anchor IDL (fetched from the IDL PDA —
 * `createAddressWithSeed(findProgramAddress([], programId), "anchor:idl", programId)`
 * — 8,732 bytes on-chain, 25,318 decompressed, `hylo_earn_pool` v2.0.5) for every
 * account layout, instruction shape and PDA seed. Two of the `user_deposit`/
 * `user_withdraw` accounts (`hylo`, `stablecoin_mint`) are PDAs of a DIFFERENT,
 * immutable program — `HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn` ("Hylo
 * Exchange", the core protocol program this pool reads hyUSD/pause state from,
 * itself its OWN separate Jupiter-labeled venue) — confirmed by decoding the
 * IDL's raw seed-program constant bytes to that address, and cross-checked
 * account-for-account against a real settled mainnet `UserWithdraw` (tx
 * `2yA67kUE...`, slot ~436449170): every PDA this module derives matched that
 * transaction's actual account list byte-for-byte, in the same order.
 *
 * QUOTE MATH — ground-truthed EXACTLY (bit-for-bit, not approximated) against
 * the REAL deployed program via LiteSVM (`solana program dump` of the live
 * binary, real current `PoolConfig`/vault/mint state, a fabricated user with a
 * real ATA pair), at three sizes per direction (10 / 1,000 / 100,000 hyUSD
 * deposited; 5 / 500 / 50,000 sHYUSD withdrawn) — every size matched the real
 * program's own emitted `UserDepositEvent`/`UserWithdrawEvent` return data
 * (`sol_set_return_data`) and the real token-account balance deltas exactly:
 *
 *   DEPOSIT: the program computes a share price ("nav") FIRST — ROUNDED
 *   half-up to 6 decimals (`navBits = round_half_up(poolBalance * 1e6 /
 *   lpSupply)`) — and REUSES that rounded value for the mint:
 *     minted = floor(depositedRaw * 1e6 / navBits)
 *   (this double-rounding is real and DELIBERATE — the rounded nav is also the
 *   value the program returns as `lp_token_nav` on the event, i.e. it computes
 *   the price once and prices the mint off that same number; a naive
 *   single-step `deposited * lpSupply / poolBalance` OVER-mints by a growing
 *   margin as size increases — confirmed wrong at 100 SOL by 14,792 raw units).
 *
 *   WITHDRAW: by contrast computes the redemption DIRECTLY, ONE mulDiv, with NO
 *   intermediate rounded nav (`UserWithdrawEvent` carries no nav field at all —
 *   consistent with this):
 *     gross = floor(sharesRaw * poolBalance / lpSupply)
 *     fee   = ceil(gross * withdrawalFeeBits / 10^(-withdrawalFeeExp))
 *     net   = gross - fee
 *
 * Both formulas are EXACT integer bigint arithmetic — floors/ceils exactly as
 * every other family in this recipe, no floating point.
 *
 * CAPS — two REAL, hard, on-chain REVERTING caps (not a soft self-drop the way
 * a depleted CP pool degrades): `PoolConfig.deposit_limiter.limit` bounds the
 * POST-deposit total pool balance (remaining headroom = limit - livePoolBalance,
 * confirmed to revert past it: custom error 13085); `PoolConfig.withdrawal_limiter`
 * is a PER-EPOCH (Solana's own native protocol epoch — confirmed: the on-chain
 * `epoch` field read live off mainnet EQUALED `getEpochInfo().epoch` exactly at
 * capture time) rolling window (remaining = limit - withdrawal_ledger.supply,
 * confirmed to revert past it: custom error 13088). Because ANY revert here
 * kills the WHOLE cook atomically (SVM has no per-venue try/catch), this
 * adapter CLAMPS the effective traded amount against the LIVE cap INSIDE the
 * quote helper itself (deposit: clamp gross hyUSD in; withdraw: clamp shares in
 * so the resulting gross hyUSD stays under the epoch cap) — the quote curve is
 * therefore a straight line up to the live cap, then FLAT (zero further output,
 * same self-limiting shape a depleting CP pool's `return 0` carries elsewhere
 * in this recipe; monotone non-decreasing, weakly concave, never over-promises).
 * The epoch-ROLLOVER reset (a new epoch lazily zeroes the ledger) is NOT
 * modeled — this adapter always reads the stored ledger as current, which is
 * conservative (can only UNDER-estimate remaining capacity right after a real
 * rollover, never over-promise into a revert).
 *
 * `paused` gates at prepare time (a self-drop, like every other family's
 * activation/status gate) rather than being re-checked live — a pool that
 * pauses between prepare and cook fails the CPI exactly like a vanished pool
 * elsewhere in this recipe.
 *
 * DECIMALS: hyUSD and sHYUSD are both 6-decimal SPL mints (immutable metadata,
 * confirmed live) — hardcoded as `SCALE = 1_000_000n` rather than read live;
 * `deposit_limiter`/`withdrawal_limiter` are asserted to carry `exp === -6` at
 * fetch time (self-drop otherwise — a governance change to that convention
 * would need this adapter revisited, not silently mispriced).
 *
 * SWAP CPI — `user_deposit` discriminator `sha256("global:user_deposit")[0..8]`
 * = `bac68ce981276299`; `user_withdraw` = `35fe1af277ed4921` — both lifted
 * directly off the on-chain IDL, not guessed. Args are `(amount: u64, slippage_config:
 * Option<SlippageConfig>)`; this adapter always sends `None` (0x00) for
 * `slippage_config` — the recipe's own post-swap outAta delta check is the real
 * bound, matching every other family's venue-level `min_out = 1` convention.
 * Both instructions are Anchor "event CPI" self-invocations under the hood
 * (the trailing `event_authority`/`program` accounts), included verbatim.
 */
import { address } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { accountDataLoader } from "../../loader.js";
import type { OwnedAccountLoader, PoolConfig } from "../types.js";

/** The Earn Pool program — this family's discovered-pool owner. */
export const HYLO_STABILITY_POOL_PROGRAM_ID = address(
  "HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ",
);
// ---------------------------------------------------------------------------
// Deterministic PDAs — every one of these is a fixed constant of the two
// immutable program ids above; none require RPC to compute, and this family
// has no per-pair candidate to discover beyond the single PoolConfig account.
// Verified live 2026-07-31 (getAccountInfo, owner + size) AND against a real
// settled mainnet UserWithdraw transaction's own account list (see header).
// ---------------------------------------------------------------------------
/** PDA(["pool_config"], EARN_PROGRAM) — the single global pool config account. */
export const HYLO_STABILITY_POOL_CONFIG = address("2jk7miWrsTbt5hUSaCXPkEQPvuUMgbFLpgMzMQw3Z6ar");
/** PDA(["hyUSD"], CORE_PROGRAM) — the hyUSD mint. Exported: index.ts's FAMILIES.mints() needs it
 *  (this adapter's PoolConfig decode carries no mint fields — both mints are fixed constants). */
export const HYLO_STABILITY_POOL_STABLECOIN_MINT = address(
  "5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E",
);
/** PDA(["staked_hyUSD"], EARN_PROGRAM) — the sHYUSD (LP share) mint. Exported for the same reason. */
export const HYLO_STABILITY_POOL_LP_TOKEN_MINT = address(
  "HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz",
);
/** sha256("account:PoolConfig")[0..8]. */
const POOL_CONFIG_DISCRIMINATOR = [26, 108, 14, 123, 116, 230, 129, 43];
const POOL_CONFIG_SIZE = 107;

// PoolConfig byte offsets (discriminator(8) + _dead_admin(32) + 3 bumps(3) = 43).
const OFF_WITHDRAWAL_FEE_BITS = 43;
const OFF_WITHDRAWAL_FEE_EXP = 51;
const OFF_PAUSED = 52;
const OFF_WLIMIT_BITS = 53;
const OFF_WLIMIT_EXP = 61;
const OFF_DLIMIT_BITS = 79;
const OFF_DLIMIT_EXP = 87;

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return data.length >= discriminator.length && discriminator.every((byte, i) => data[i] === byte);
}
function readInt8(data: Uint8Array, offset: number): number {
  const raw = data[offset]!;
  return raw >= 128 ? raw - 256 : raw;
}
export type HyloStabilityPoolDirection = "deposit" | "withdraw";

export interface HyloStabilityPoolConfig extends PoolConfig {
  venue: "hylo-stability-pool";
  direction: HyloStabilityPoolDirection;
  paused: boolean;
  withdrawalFeeBits: bigint;
  withdrawalFeeExp: number;
  depositLimitBits: bigint;
  withdrawalLimitBits: bigint;
}

async function fetchHyloStabilityPoolConfig(
  owned: OwnedAccountLoader,
  pool: Address,
): Promise<HyloStabilityPoolConfig> {
  const load = accountDataLoader(owned);
  const data = await load(pool);
  if (data === null) throw new Error(`hylo-stability-pool ${pool} account not found`);
  if (data.length !== POOL_CONFIG_SIZE) {
    throw new Error(
      `hylo-stability-pool ${pool} data must be ${POOL_CONFIG_SIZE} bytes, got ${data.length}`,
    );
  }
  if (!hasDiscriminator(data, POOL_CONFIG_DISCRIMINATOR)) {
    throw new Error(
      `hylo-stability-pool ${pool} is not an initialized Anchor PoolConfig account (bad discriminator)`,
    );
  }

  const withdrawalFeeBits = readUintLE(data, OFF_WITHDRAWAL_FEE_BITS, 8);
  const withdrawalFeeExp = readInt8(data, OFF_WITHDRAWAL_FEE_EXP);
  const paused = data[OFF_PAUSED] !== 0;
  const withdrawalLimitBits = readUintLE(data, OFF_WLIMIT_BITS, 8);
  const withdrawalLimitExp = readInt8(data, OFF_WLIMIT_EXP);
  const depositLimitBits = readUintLE(data, OFF_DLIMIT_BITS, 8);
  const depositLimitExp = readInt8(data, OFF_DLIMIT_EXP);

  // Both caps are compared directly against raw SPL amounts (6-decimal
  // balances) in this adapter's math — a governance change to either's scale
  // convention would silently mis-cap, so refuse rather than guess.
  if (withdrawalLimitExp !== -6) {
    throw new Error(
      `hylo-stability-pool ${pool} withdrawal_limiter.limit exp must be -6, got ${withdrawalLimitExp}`,
    );
  }
  if (depositLimitExp !== -6) {
    throw new Error(
      `hylo-stability-pool ${pool} deposit_limiter.limit exp must be -6, got ${depositLimitExp}`,
    );
  }
  if (withdrawalFeeExp > 0 || withdrawalFeeExp < -18) {
    throw new Error(
      `hylo-stability-pool ${pool} withdrawal_fee exp out of sane range: ${withdrawalFeeExp}`,
    );
  }

  return {
    venue: "hylo-stability-pool",
    pool,
    direction: "deposit",
    paused,
    withdrawalFeeBits,
    withdrawalFeeExp,
    depositLimitBits,
    withdrawalLimitBits,
  };
}

export const hyloStabilityPool = {
  slug: "hylo-stability-pool" as const,
  programId: HYLO_STABILITY_POOL_PROGRAM_ID,
  fetchPoolConfig: (owned: OwnedAccountLoader, pool: Address): Promise<HyloStabilityPoolConfig> =>
    fetchHyloStabilityPoolConfig(owned, pool),
};
