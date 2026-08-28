/**
 * Saros DLMM (Dynamic Liquidity Market Maker) — a discrete-bin AMM on Solana,
 * the SAME bin-step design as `meteora-dlmm` (bin arrays, per-bin reserves, a
 * dynamic base+volatility fee) but with its own account layout and geometry.
 * No public on-chain IDL search engine turned this up as "documented" —
 * layout comes from `@saros-finance/dlmm-sdk`'s bundled Anchor IDL
 * (`src/constants/idl/liquidity_book.json`, published npm 2.0.1), CROSS
 * -VALIDATED against real mainnet dumps (pairs `9P3N4Qx...`/USDC-USDT,
 * `DHXKB9f...`/USDS-USDC, `7hc6hXj...`/uniBTC-xBTC) AND against the REAL
 * deployed program (`solana program dump`, executed via LiteSVM on real
 * mainnet pool + bin-array state): our off-chain quote matched the venue's
 * OWN realized swap output BIT-FOR-BIT at every tested size, both
 * directions (see the "VALIDATED" section below for the exact cells).
 *
 * PROGRAM ID `1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE` — confirmed both as
 * the account owner of every real `Pair`/`BinArray` dumped above AND as the
 * IDL's own `address` field.
 *
 * Pair account (204 bytes fixed — Anchor `InitSpace`-derived, so the account
 * is always 204 bytes whether or not `hook` is actually set; discriminator
 * sha256('account:Pair')[0..8] = 55 48 31 b0 b6 e4 8d 52):
 *   bump[1]@8, liquidity_book_config pubkey@9, bin_step u8@41, bin_step_seed[1]@42,
 *   token_mint_x pubkey@43, token_mint_y pubkey@75,
 *   static_fee_parameters@107 (base_factor u16@107, filter_period u16@109,
 *     decay_period u16@111, reduction_factor u16@113, variable_fee_control u32@115,
 *     max_volatility_accumulator u32@119, protocol_share u16@123, _space[2]@125),
 *   active_id u32@127 (ALREADY BIASED — centered at CENTER_BIN_ID = 2^23 =
 *     8388608, unlike meteora-dlmm's signed-native bin id; no BIAS trick needed:
 *     the price exponent is simply `active_id - CENTER_BIN_ID`),
 *   dynamic_fee_parameters@131 (time_last_updated u64@131, volatility_accumulator
 *     u32@139, volatility_reference u32@143, id_reference u32@147, _space[4]@151),
 *   protocol_fees_x u64@155, protocol_fees_y u64@163,
 *   hook Option<pubkey>@171 (tag byte; pubkey@172 iff tag===1).
 *
 * FEE MODEL — byte-for-byte identical formula to meteora-dlmm (both are
 * independent implementations of the same "Liquidity Book" bin-step design;
 * verified field-for-field against `@saros-finance/dlmm-sdk`'s `fees.ts`):
 * baseFee = binStep · baseFactor · 10 (NOTE: unlike meteora-dlmm, Saros'
 * `StaticFeeParameters` has NO `base_fee_power_factor` field — the extra
 * `10^x` term meteora-dlmm carries is simply absent here, confirmed against
 * the IDL's struct fields); variableFee = ceil(vfc·(volAcc·binStep)²/1e11),
 * volAcc = min(maxVolatilityAccumulator, volRef + |idRefEff − binId|·10000);
 * total = min(baseFee+variableFee, MAX_FEE_RATE). PRECISION = 1e9 (both). The
 * MAX_FEE_RATE clamp (1e8 = 10%) is a disclosed assumption carried over from
 * the meteora-dlmm lineage (no explicit cap documented in the Saros IDL/SDK);
 * it never bound in any measured cell and is a conservative ceiling, not a
 * floor — `minOut` is the real backstop regardless.
 *
 * BIN GEOMETRY — the real structural divergence from meteora-dlmm:
 * BIN_ARRAY_SIZE = 256 (not 70), Bin = {total_supply u128, reserve_x u64,
 * reserve_y u64} = 32 bytes (not 144 — no per-bin price cache; price is
 * ALWAYS computed from bin_id, matching meteora-dlmm's own `priceFromId`
 * treatment), BinArray = 8 (disc) + 32 (pair pubkey) + 256·32 (bins) + 4
 * (index u32) + 12 (_space) = 8248 bytes, discriminator
 * sha256('account:BinArray')[0..8] = 5c 8e 5c dc 05 94 46 b5 — IDENTICAL to
 * meteora-dlmm's (Anchor discriminators depend only on the account TYPE
 * NAME "BinArray", not the program), confirmed independently via the real
 * dump. Array index = floor(bin_id / 256) (simple, no meteora-style i64
 * offset trick) — GROUND-TRUTHED against real fixture accounts: the active
 * bin's own array exists at exactly this index and its liquid-bin reserves
 * sit at `bin_id - index*256` (test/svm/fixtures/saros-dlmm/, captured from
 * the real dumps above). PDA seed: ['bin_array', pair, index as u32 LE] —
 * a 4-byte index (meteora-dlmm uses an 8-byte i64).
 *
 * VAULTS — token_vault_x/y are ORDINARY Associated Token Accounts owned by
 * the `pair` account itself (`getAssociatedTokenAddress(mint, pair)`), NOT
 * custom program PDAs (the swap ix's IDL seeds resolve under
 * `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`, the standard ATA program —
 * confirmed by deriving both ways and finding real, funded accounts only at
 * the ATA address).
 *
 * NO BITMAP EXTENSION, NO ORACLE ACCOUNT: unlike meteora-dlmm, the swap ix
 * carries no bin-array-bitmap-extension and no oracle account at all —
 * simpler account list.
 *
 * HOOK GATE (self-drop, not a blanket refusal): Saros DLMM pairs may attach
 * an optional "hook" program (before/after-swap callbacks — reward
 * accrual, in the observed real fixture; `rewarder_hook.json`'s
 * `before_swap`/`after_swap` etc.) — a genuine extension point that COULD in
 * principle alter swap semantics, mirroring exactly the class of unmodeled
 * -CPI gates this repo already applies elsewhere (meteora-dlmm's
 * LimitOrder gate, defituna's active-resting-order gate). A pair with
 * `hook` set (Some) is GATED here (self-drops that ONE pool at prepare time,
 * never the family); every hookless pair — the norm — is fully served.
 * `hook`/`hooks_program` still ride the swap ix as PROGRAM-ID sentinels
 * (Anchor's optional-account convention, matching meteora-dlmm's
 * host_fee_in None-sentinel treatment) — CONFIRMED empirically: the real
 * program rejects a SHORTER (omitted) account list with
 * `AccountNotEnoughKeys`.
 *
 * CLASSIC-SPL-ONLY (mirrors meteora-dlmm's identical, disclosed weakness):
 * gated via mint account length !== 82. The Pair account itself carries no
 * token-program flag (unlike meteora-dlmm's dedicated byte) — the swap ix's
 * `token_program_x`/`token_program_y` are caller-supplied generic accounts,
 * so a length-82 Token-2022 mint WITH NO extensions would misclassify as
 * classic (identical gap to meteora-dlmm's own).
 *
 * VALIDATED against the REAL saros-dlmm program (`solana program dump`,
 * executed via LiteSVM on real mainnet pool + bin-array state, pair
 * `DHXKB9fSff4LjubMFieKxaBrvNY6AzXVwaRLk5N2vs87` USDS/USDC, slot ~436434887):
 * our off-chain quote matched the real program's realized output
 * BIT-FOR-BIT at every cell — Y-in/X-out (swap_for_y=false) at $10 / $500 /
 * $3000 (9998000 / 499879537 / 2997832435, 1/2/~11 bins crossed, an
 * UNBOUNDED off-chain walk validating the raw formula) AND X-in/Y-out
 * (swap_for_y=true) at 1 raw unit / 7 / 300 USDS (0 / 6999285 / 299969399,
 * including the dust-rounds-to-zero edge case) — zero discrepancy in all 6
 * cells. This also confirms the fee model reads
 * id_reference/volatility_reference ONCE per trade (update_references at
 * swap start), not re-updated per bin crossed mid-walk — the meteora-dlmm
 * -style model is exact, not an approximation, for this program.
 *
 * SEPARATELY, at the SHIPPED SAROS_DLMM_MAX_BINS=8 window this adapter
 * actually ships (bounded, like every other window-walking family in this
 * repo): re-validated bit-for-bit at $10 / $500 / $2000 Y-in/X-out
 * (9998000 / 499879537 / 1998980941 — $2000 sits right at this pair's real
 * 8-bin capacity in that direction, ~2.33e9 raw). A request exceeding the
 * shipped window's capacity (e.g. the $3000 cell above, on THIS adapter)
 * correctly reports capacity exhaustion off-chain (0 / a capacity-clamped
 * partial, never a wrong nonzero number) even though the real program —
 * unbounded, given the full 256-bin arrays — would keep filling it; see
 * test/svm/venues/saros-dlmm.test.ts's "exceeding the shipped window"
 * case.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountLoader, PoolConfig } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
import { memoizedGetProgramDerivedAddress } from '../pda-memo.js';

const SLUG = 'saros-dlmm';
export const SAROS_DLMM_PROGRAM_ID = address('1qbkdrr3z4ryLA7pZykqxvxWPoeifcVKo6ZG9CfkvVE');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const ASSOCIATED_TOKEN_PROGRAM_ID = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export const PAIR_ACCOUNT_SIZE = 204;
export const BIN_ARRAY_ACCOUNT_SIZE = 8248;
/** sha256('account:Pair')[0..8]. */
export const PAIR_DISCRIMINATOR = [85, 72, 49, 176, 182, 228, 141, 82];
/** sha256('account:BinArray')[0..8] — identical to meteora-dlmm's (same type name). */
export const BIN_ARRAY_DISCRIMINATOR = [0x5c, 0x8e, 0x5c, 0xdc, 0x05, 0x94, 0x46, 0xb5];
export const BINS_PER_ARRAY = 256;
export const CENTER_BIN_ID = 8_388_608; // 2^23

/**
 * Shipped liquid bins per direction — the meteora-dlmm-style bounded walk,
 * sized the same as METEORA_DLMM_MAX_BINS pending CU re-measurement against
 * this family's own compiled ladder (see budget.ts CU_FAMILIES).
 */
export const SAROS_DLMM_MAX_BINS = 8;

// Pair offsets (+8 anchor disc).
const OFF_BIN_STEP = 41;
const OFF_TOKEN_X_MINT = 43;
const OFF_TOKEN_Y_MINT = 75;
const OFF_BASE_FACTOR = 107;
const OFF_FILTER_PERIOD = 109;
const OFF_DECAY_PERIOD = 111;
const OFF_REDUCTION_FACTOR = 113;
const OFF_VARIABLE_FEE_CONTROL = 115;
const OFF_MAX_VOLATILITY_ACC = 119;
export const OFF_ACTIVE_ID = 127;
export const OFF_LAST_UPDATE = 131;
export const OFF_VOLATILITY_ACC = 139;
export const OFF_VOLATILITY_REF = 143;
export const OFF_INDEX_REF = 147;
const OFF_HOOK_TAG = 171;
// BinArray offsets: index u32 @8232, bins[256] @40 (32 bytes each: total_supply u128@0, reserve_x u64@16, reserve_y u64@24).
export const OFF_BA_INDEX = 8232;
export const OFF_BA_BINS = 40;
export const BIN_LEN = 32;
export const OFF_BIN_RESERVE_X = 16;
export const OFF_BIN_RESERVE_Y = 24;

export interface SarosDlmmBin {
  /** Index into the window's [binArrayLower, binArrayUpper] pair (0 or 1). */
  arrayIndex: 0 | 1;
  /** Bin offset within that array (0..255). */
  offset: number;
  /** The RAW (already-biased) bin id — active_id's own units. */
  binId: number;
  /** priceFromId-equivalent: (1+binStep/1e4)^(binId-CENTER_BIN_ID) in Q64.64. */
  price: bigint;
}

export interface SarosDlmmWindow {
  /** The two bracketing bin-array PDAs (ascending index; both ALWAYS required by the swap ix). */
  binArrayLower: Address;
  binArrayUpper: Address;
  lowerIndex: number;
  upperIndex: number;
  /** Liquid bins in walk order (<= SAROS_DLMM_MAX_BINS); empty when either bracket array is missing/invalid. */
  bins: SarosDlmmBin[];
}

export interface SarosDlmmPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** Trade direction: 'xToY' (default) sells token_x for token_y (swap_for_y, price down). */
  direction: 'xToY' | 'yToX';
  tokenXMint: Address;
  tokenYMint: Address;
  vaultX: Address;
  vaultY: Address;
  binStep: number;
  activeId: number;
  baseFactor: number;
  variableFeeControl: number;
  maxVolatilityAccumulator: number;
  reductionFactor: number;
  filterPeriod: number;
  decayPeriod: number;
  windows: { xToY: SarosDlmmWindow; yToX: SarosDlmmWindow };
}

function hasDiscriminator(data: Uint8Array, discriminator: number[]): boolean {
  return discriminator.every((byte, i) => data[i] === byte);
}
function getAddressEncoded(value: Address): Uint8Array {
  return new Uint8Array(getAddressCodec().encode(value));
}

async function deriveBinArrayPda(pair: Address, index: number): Promise<Address> {
  const le = new Uint8Array(4);
  new DataView(le.buffer).setUint32(0, index, true);
  return memoizedGetProgramDerivedAddress(SAROS_DLMM_PROGRAM_ID, [
    new TextEncoder().encode('bin_array'),
    getAddressEncoded(pair),
    le,
  ]);
}

/** ['ownerAta', TOKEN_PROGRAM, mint] under the standard Associated Token Account program. */
async function deriveAta(owner: Address, mint: Address): Promise<Address> {
  return memoizedGetProgramDerivedAddress(ASSOCIATED_TOKEN_PROGRAM_ID, [
    getAddressEncoded(owner),
    getAddressEncoded(TOKEN_PROGRAM),
    getAddressEncoded(mint),
  ]);
}

/**
 * The two bracketing bin-array indices for `activeId` — matching the real
 * program's own swap-account convention (cross-validated: the pair chosen
 * this way is exactly what a real swap accepts, both directions, at every
 * tested size — see the module header). `lowerIndex < upperIndex` always;
 * both cover `SAROS_DLMM_MAX_BINS` worth of headroom on either side of
 * `activeId` (256-bin arrays, an 8-bin walk never needs a third array).
 */
export function pairArrayIndexes(activeId: number): [number, number] {
  const current = Math.floor(activeId / BINS_PER_ARRAY);
  const offset = activeId - current * BINS_PER_ARRAY;
  return offset < BINS_PER_ARRAY / 2 ? [current - 1, current] : [current, current + 1];
}

/** priceFromId: (1 + binStep/1e4)^(binId - CENTER_BIN_ID) in Q64.64 (pow, exact transcription). */
const ONE_Q64 = 1n << 64n;
const U128_MAX = (1n << 128n) - 1n;
const BASIS_POINT_MAX = 10_000n;
const MAX_EXPONENTIAL = 0x80000;

function powQ64(base: bigint, exp: number): bigint | null {
  let invert = exp < 0;
  if (exp === 0) return ONE_Q64;
  const e = Math.abs(exp);
  if (e >= MAX_EXPONENTIAL) return null;
  let squaredBase = base;
  let result = ONE_Q64;
  if (squaredBase >= result) {
    squaredBase = U128_MAX / squaredBase;
    invert = !invert;
  }
  const step = (bit: number): boolean => {
    if ((e & bit) > 0) {
      result = (result * squaredBase) >> 64n;
      if (result > U128_MAX) return false;
    }
    return true;
  };
  if (!step(0x1)) return null;
  for (let bit = 0x2; bit <= 0x40000; bit <<= 1) {
    squaredBase = (squaredBase * squaredBase) >> 64n;
    if (squaredBase > U128_MAX) return null;
    if (!step(bit)) return null;
  }
  if (result === 0n) return null;
  if (invert) result = U128_MAX / result;
  return result;
}

export function priceFromId(binId: number, binStep: number): bigint {
  const bps = (BigInt(binStep) << 64n) / BASIS_POINT_MAX;
  const base = ONE_Q64 + bps;
  const price = powQ64(base, binId - CENTER_BIN_ID);
  if (price === null) throw new Error(`saros-dlmm priceFromId: pow overflow for bin ${binId} step ${binStep}`);
  return price;
}

/** Walk up to SAROS_DLMM_MAX_BINS liquid bins from activeId toward `swapForY`'s direction. */
function resolveBins(
  lowerData: Uint8Array,
  upperData: Uint8Array,
  lowerIndex: number,
  upperIndex: number,
  activeId: number,
  binStep: number,
  swapForY: boolean,
): SarosDlmmBin[] {
  const bins: SarosDlmmBin[] = [];
  let bid = activeId;
  const amountOffset = swapForY ? OFF_BIN_RESERVE_Y : OFF_BIN_RESERVE_X;
  while (bins.length < SAROS_DLMM_MAX_BINS) {
    const arrIdx = Math.floor(bid / BINS_PER_ARRAY);
    let data: Uint8Array;
    let arrayIndex: 0 | 1;
    if (arrIdx === lowerIndex) {
      data = lowerData;
      arrayIndex = 0;
    } else if (arrIdx === upperIndex) {
      data = upperData;
      arrayIndex = 1;
    } else {
      break; // outside the shipped [lower, upper] bracket — end of window
    }
    const offset = bid - arrIdx * BINS_PER_ARRAY;
    const cell = OFF_BA_BINS + offset * BIN_LEN;
    if (readUintLE(data, cell + amountOffset, 8) > 0n) {
      bins.push({ arrayIndex, offset, binId: bid, price: priceFromId(bid, binStep) });
    }
    bid += swapForY ? -1 : 1;
  }
  return bins;
}

/**
 * Fetch + gate one Saros DLMM pair (see the module header for the gate list)
 * and freeze both directions' bin windows. Read-only against the loader.
 */
export async function fetchSarosDlmmConfig(load: AccountLoader, pair: Address): Promise<SarosDlmmPoolConfig> {
  const data = await load(pair);
  if (data === null) throw new Error(`${SLUG}: pair account ${pair} not found`);
  if (data.length !== PAIR_ACCOUNT_SIZE) {
    throw new Error(`${SLUG}: pair ${pair} has ${data.length} bytes, expected ${PAIR_ACCOUNT_SIZE}`);
  }
  if (!hasDiscriminator(data, PAIR_DISCRIMINATOR)) {
    throw new Error(`${SLUG}: pair ${pair} has a foreign discriminator (not a Pair account)`);
  }
  if (data[OFF_HOOK_TAG] === 1) {
    throw new Error(`${SLUG}: pair ${pair} has a hook attached — unmodeled before/after-swap CPI, self-dropped`);
  }

  const codec = getAddressCodec();
  const tokenXMint = codec.decode(data.subarray(OFF_TOKEN_X_MINT, OFF_TOKEN_X_MINT + 32)) as Address;
  const tokenYMint = codec.decode(data.subarray(OFF_TOKEN_Y_MINT, OFF_TOKEN_Y_MINT + 32)) as Address;
  // The on-chain swap ix here is legacy-SPL only; detect a Token-2022 mint (or
  // one carrying an un-routable extension) via the shared data-shape resolver
  // and SELF-DROP the pool. The thrown error is the graceful-drop signal — the
  // SvmRoute orchestrator catches a fetchPoolConfig throw and drops the venue.
  // The LEGACY path stays byte-identical: a classic 82-byte mint classifies as
  // Tokenkeg, parses no extensions, and the config is built unchanged. An
  // unreadable mint falls back to the legacy assumption (keeps fixtures green).
  const mints = [tokenXMint, tokenYMint];
  const mintDatas = await Promise.all(mints.map((mint) => load(mint)));
  for (let mi = 0; mi < mints.length; mi++) {
    const mint = mints[mi]!;
    const mintData = mintDatas[mi]!;
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping pool ${pair} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping pool ${pair} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  const binStep = data[OFF_BIN_STEP];
  const activeId = Number(readUintLE(data, OFF_ACTIVE_ID, 4));

  const [lowerIndex, upperIndex] = pairArrayIndexes(activeId);
  const [binArrayLower, binArrayUpper, vaultX, vaultY] = await Promise.all([
    deriveBinArrayPda(pair, lowerIndex),
    deriveBinArrayPda(pair, upperIndex),
    deriveAta(pair, tokenXMint),
    deriveAta(pair, tokenYMint),
  ]);
  const [lowerData, upperData] = await Promise.all([load(binArrayLower), load(binArrayUpper)]);

  const arrayValid = (d: Uint8Array | null, expectedIndex: number): d is Uint8Array =>
    d !== null &&
    d.length === BIN_ARRAY_ACCOUNT_SIZE &&
    hasDiscriminator(d, BIN_ARRAY_DISCRIMINATOR) &&
    Number(readUintLE(d, OFF_BA_INDEX, 4)) === expectedIndex;

  const bracketValid = arrayValid(lowerData, lowerIndex) && arrayValid(upperData, upperIndex);
  const xToYBins = bracketValid ? resolveBins(lowerData!, upperData!, lowerIndex, upperIndex, activeId, binStep, true) : [];
  const yToXBins = bracketValid ? resolveBins(lowerData!, upperData!, lowerIndex, upperIndex, activeId, binStep, false) : [];

  const window: Omit<SarosDlmmWindow, 'bins'> = { binArrayLower, binArrayUpper, lowerIndex, upperIndex };

  return {
    venue: SLUG,
    pool: pair,
    direction: 'xToY',
    tokenXMint,
    tokenYMint,
    vaultX,
    vaultY,
    binStep,
    activeId,
    baseFactor: Number(readUintLE(data, OFF_BASE_FACTOR, 2)),
    variableFeeControl: Number(readUintLE(data, OFF_VARIABLE_FEE_CONTROL, 4)),
    maxVolatilityAccumulator: Number(readUintLE(data, OFF_MAX_VOLATILITY_ACC, 4)),
    reductionFactor: Number(readUintLE(data, OFF_REDUCTION_FACTOR, 2)),
    filterPeriod: Number(readUintLE(data, OFF_FILTER_PERIOD, 2)),
    decayPeriod: Number(readUintLE(data, OFF_DECAY_PERIOD, 2)),
    windows: { xToY: { ...window, bins: xToYBins }, yToX: { ...window, bins: yToXBins } },
  };
}

/** Family facade for the recipe orchestrator (ladder-only — no v1 adapter). */
export const sarosDlmm = {
  slug: SLUG,
  programId: SAROS_DLMM_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchSarosDlmmConfig,
};

export { MEMO_PROGRAM as SAROS_DLMM_MEMO_PROGRAM };
