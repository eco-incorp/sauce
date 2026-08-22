/**
 * Meteora DLMM (Liquidity Book / bin) venue — pool decoding, scope gates and
 * the prepare-declared BIN WINDOW for the SvmRoute ladder fragment
 * (./ladder.ts). LADDER-ONLY (adapter contract v2): a DLMM quote is a bin walk
 * over a data-dependent bin-array set, so there is no v1 SvmVenueAdapter and
 * the venue is not in the v1 registry. This is the whirlpool WINDOW thesis
 * applied to DISCRETE bins instead of tick segments: bins are price buckets
 * `price = (1 + bin_step/1e4)^bin_id` (Q64.64), each holding reserves.
 *
 * Layout source-verified against github.com/MeteoraAg/dlmm-sdk (idls/dlmm.json
 * account layouts + commons/src/{quote,extensions/{bin,lb_pair}}.rs) AND a
 * mainnet dump of the SOL/USDC bin_step=4 pair 5rCf1DM8... (snapshot slot
 * ~431198953, sdk/test/svm/fixtures/meteora-dlmm/): LbPair = 904 bytes (8 disc
 * + 896 struct), discriminator sha256('account:LbPair')[0..8] =
 * 21 0b 31 62 b5 65 b1 0d; BinArray = 10136 bytes (8 + 8 index + 8 pad + 32
 * lb_pair + 70*144 bins), discriminator 5c 8e 5c dc 05 94 46 b5. Each Bin is
 * 144 bytes: amount_x u64 @+0, amount_y u64 @+8, price u128 @+16. All LE;
 * bin ids are i32 (read unsigned + biased by 2^31 in-VM).
 *
 * DIRECTION (the EVM/doc note's "inverted" warning): swap_for_y (X in, Y out)
 * walks DOWN in bin id from active_id, consuming each bin's amount_y; !swap_for_y
 * (Y in, X out) walks UP, consuming amount_x. Verified against quote.rs
 * `get_bin_array_pubkeys_for_swap` (increment −1 for swap_for_y) and
 * `advance_active_bin`.
 *
 * THE WINDOW: prepare walks the bins OFF-CHAIN from active_id in the swap
 * direction and ships up to METEORA_DLMM_MAX_BINS bins that hold liquidity —
 * each (arrayIndex, offset, biased bin id, price). Everything value-bearing
 * stays live: the fragment re-reads active_id + the volatility v_parameters
 * from the LbPair, and each shipped bin's amount_x/amount_y from its bin array,
 * at cook time. The shipped price is drift-invariant (a pure function of the
 * bin id). Drift semantics mirror whirlpool: bins behind the live active_id are
 * skipped in-VM (drift re-anchoring), a shipped bin drained to 0 live is
 * skipped, and a live active_id past the whole shipped window self-deactivates.
 *
 * VARIABLE FEE: the fee is dynamic (base + a volatility term). The fragment
 * reads the live v_parameters and static fee params and replicates the venue's
 * update_references(clock) + per-bin update_volatility_accumulator EXACTLY (the
 * static params are immutable, so they are baked; the volatility state + clock
 * are live) — so the fee is venue-exact per bin, not a prepare snapshot. `now`
 * feeds update_references, like meteora-damm-v2's stored-volatility policy.
 *
 * Gates (named errors): account size / discriminator; a non-Enabled status;
 * `collect_fee_mode != 0` (only InputOnly is walked — fee always on input);
 * explicit LimitOrder-function_type pairs (the limit-order fill layers are unmodeled;
 * Undetermined/LiquidityMining are admitted — unmodeled orders only add output); non-classic
 * -SPL mints; a slot-typed activation with a nonzero point (no in-VM slot read);
 * a direction with no shippable liquid bins (gated by the orchestrator).
 *
 * NOTE — RELOCATED LADDER. This venue's merge-decomposition ladder used to sit
 * next to this file as `./ladder.ts`; it now lives in the consuming recipes
 * package, which defines every `*Ladder`, window selector and rung-feeding
 * decomposition helper itself. The SDK keeps only the generic venue
 * integration below (pool-account decode, program ids, pool-config types, and
 * the AMM/tick math the decode needs). Every `ladder.ts` reference in the text
 * above therefore points at that relocated module, not at a file in this
 * directory.
  */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountLoader, PoolConfig } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';
import { memoizedGetProgramDerivedAddress } from '../pda-memo.js';
import { MAX_BIN_ID, MIN_BIN_ID, binArrayIndex, priceFromId } from './bin-math.js';

const SLUG = 'meteora-dlmm';

export const METEORA_DLMM_PROGRAM_ID = address('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export const LB_PAIR_ACCOUNT_SIZE = 904;
export const BIN_ARRAY_ACCOUNT_SIZE = 10136;
/** sha256('account:LbPair')[0..8]. */
export const LB_PAIR_DISCRIMINATOR = [0x21, 0x0b, 0x31, 0x62, 0xb5, 0x65, 0xb1, 0x0d];
/** sha256('account:BinArray')[0..8]. */
export const BIN_ARRAY_DISCRIMINATOR = [0x5c, 0x8e, 0x5c, 0xdc, 0x05, 0x94, 0x46, 0xb5];

export const BINS_PER_ARRAY = 70;
export { MAX_BIN_ID, MIN_BIN_ID };

/**
 * Shipped liquid bins per direction. Each bin is a discrete walk step (cheap
 * arithmetic + one live reserve read), so this can be larger than the CLMM
 * boundary window; sized against the engine's measured per-bin cost and moved
 * in lockstep with the fragment's unrolled setup (ladder.ts) and the mirror.
 */
export const METEORA_DLMM_MAX_BINS = 8;

// LbPair offsets (+8 anchor disc).
export const OFF_BASE_FACTOR = 8;
export const OFF_FILTER_PERIOD = 10;
export const OFF_DECAY_PERIOD = 12;
export const OFF_REDUCTION_FACTOR = 14;
export const OFF_VARIABLE_FEE_CONTROL = 16;
export const OFF_MAX_VOLATILITY_ACC = 20;
export const OFF_PROTOCOL_SHARE = 32;
export const OFF_BASE_FEE_POWER_FACTOR = 34;
export const OFF_FUNCTION_TYPE = 35;
export const OFF_COLLECT_FEE_MODE = 36;
export const OFF_VOLATILITY_ACC = 40;
export const OFF_VOLATILITY_REF = 44;
export const OFF_INDEX_REF = 48;
export const OFF_LAST_UPDATE = 56;
export const OFF_PAIR_TYPE = 75;
export const OFF_ACTIVE_ID = 76;
export const OFF_BIN_STEP = 80;
export const OFF_STATUS = 82;
export const OFF_ACTIVATION_TYPE = 86;
const OFF_TOKEN_X_MINT = 88;
const OFF_TOKEN_Y_MINT = 120;
const OFF_RESERVE_X = 152;
const OFF_RESERVE_Y = 184;
const OFF_ORACLE = 552;
export const OFF_ACTIVATION_POINT = 816;

// BinArray offsets: index i64 @8, bins[70] @56 (144 bytes each).
export const OFF_BA_INDEX = 8;
export const OFF_BA_BINS = 56;
export const BIN_LEN = 144;
export const OFF_BIN_AMOUNT_X = 0;
export const OFF_BIN_AMOUNT_Y = 8;

export interface DlmmBin {
  /** Index into the window's binArrays (0..2). */
  arrayIndex: number;
  /** Bin offset within that array (0..69) — the live amount_x/amount_y cell. */
  offset: number;
  /** UNBIASED bin id. */
  binId: number;
  /** priceFromId(binId, binStep) — Q64.64, pure function of the id. */
  price: bigint;
}

export interface DlmmWindow {
  /** The bin-array PDAs covering the walk, nearest first (walk order). */
  binArrays: [Address, Address, Address];
  /** bin-array index encoded in each PDA (walk order). */
  arrayIndexes: [number, number, number];
  /** Liquid bins in walk order (<= METEORA_DLMM_MAX_BINS). */
  bins: DlmmBin[];
  /** Contiguous prefix of binArrays that existed as BinArray accounts at prepare. */
  readable: number;
}

export interface MeteoraDlmmPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** Trade direction: 'xToY' (default) sells token_x for token_y (swap_for_y, price down). */
  direction: 'xToY' | 'yToX';
  tokenXMint: Address;
  tokenYMint: Address;
  reserveX: Address;
  reserveY: Address;
  oracle: Address;
  /** ['bitmap', lb_pair] — required by the swap when the walk leaves the default bitmap. */
  bitmapExtension: Address;
  /**
   * Whether the ['bitmap', lb_pair] extension account EXISTS on-chain. The swap
   * ix takes it as an Option<AccountLoader>; when it is absent the swap must pass
   * the DLMM program id as the Anchor None sentinel (NOT the derived-but-
   * uninitialized PDA, which makes Anchor deserialize Some(...) and revert).
   */
  bitmapExtensionExists: boolean;
  binStep: number;
  activeId: number;
  /** Immutable fee params (StaticParameters) — shipped as cfg words. */
  baseFactor: number;
  baseFeePowerFactor: number;
  variableFeeControl: number;
  maxVolatilityAccumulator: number;
  reductionFactor: number;
  filterPeriod: number;
  decayPeriod: number;
  collectFeeMode: number;
  /** Direction-keyed prepare-declared windows (see the header). */
  windows: { xToY: DlmmWindow; yToX: DlmmWindow };
}

const readI32 = (data: Uint8Array, offset: number): number => {
  const u = Number(readUintLE(data, offset, 4));
  return u >= 0x8000_0000 ? u - 0x1_0000_0000 : u;
};

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return discriminator.every((byte, i) => data[i] === byte);
}

function getAddressEncoded(value: Address): Uint8Array {
  return new Uint8Array(getAddressCodec().encode(value));
}

async function deriveBinArrayPda(pair: Address, index: number): Promise<Address> {
  const le = new Uint8Array(8);
  new DataView(le.buffer).setBigInt64(0, BigInt(index), true); // bin_array_index.to_le_bytes()
  return memoizedGetProgramDerivedAddress(METEORA_DLMM_PROGRAM_ID, [
    new TextEncoder().encode('bin_array'),
    getAddressEncoded(pair),
    le,
  ]);
}

/** The three bin-array indexes the walk touches: the active array then two more in the walk direction. */
export function windowArrayIndexes(activeId: number, swapForY: boolean): [number, number, number] {
  const base = binArrayIndex(activeId);
  return swapForY ? [base, base - 1, base - 2] : [base, base + 1, base + 2];
}

/**
 * Whether this pair is an explicit LimitOrder pool (FunctionType, dlmm-sdk
 * commons/src/conversions/function_type.rs @ 4eaaeaa6: 0=Undetermined,
 * 1=LiquidityMining, 2=LimitOrder). The ladder models only bin (liquidity)
 * crossings, not limit-order fill layers, so a LimitOrder pool is GATED.
 *
 * NOTE: we intentionally do NOT mirror upstream's is_support_limit_order, which
 * ALSO returns true for an Undetermined pool with no reward mint. That predicate
 * is a routing-consideration flag ("this pool MIGHT carry limit-order liquidity"),
 * NOT a drop signal — and Undetermined-with-no-reward is the DEFAULT state of an
 * ordinary new pool (e.g. the SOL/USDC mainnet fixture), so gating on it would
 * drop a large fraction of normal DLMM pools. Admitting them is conservative-safe:
 * any unmodeled limit-order liquidity only ADDS output (realized out >= modeled),
 * exactly the Raydium-CLMM treatment. Gate only the explicit LimitOrder(2) type.
 */
function isSupportLimitOrder(data: Uint8Array): boolean {
  return data[OFF_FUNCTION_TYPE] === 2; // LimitOrder — admit Undetermined(0) and LiquidityMining(1)
}

/**
 * Scan the readable window for liquid bins in walk order: from active_id
 * DOWN (swap_for_y, amount_y > 0) / UP (!swap_for_y, amount_x > 0), skipping
 * empty bins, across the readable bin arrays. Up to METEORA_DLMM_MAX_BINS.
 */
async function resolveWindow(
  load: AccountLoader,
  pair: Address,
  activeId: number,
  binStep: number,
  swapForY: boolean,
): Promise<DlmmWindow> {
  const arrayIndexes = windowArrayIndexes(activeId, swapForY);
  const binArrays = (await Promise.all(arrayIndexes.map((idx) => deriveBinArrayPda(pair, idx)))) as [
    Address,
    Address,
    Address,
  ];

  // Batch the whole bin-array window into ONE coalesced round instead of an
  // outward serial walk: the bin-array PDAs are all derived above (from the
  // active id + step), so nothing here depends on a prior array's bytes.
  // Registering every load() synchronously lets the coalescing loader fold
  // them into a single getMultipleAccounts. allSettled preserves the
  // break-on-first-invalid contract exactly — a rejection is re-thrown only if
  // the readable prefix reaches it, and a miss/rejection past the break
  // degrades to the same readable prefix a missing tail array always would.
  const loaded = await Promise.allSettled(binArrays.map((addr) => load(addr)));
  const arrays: (Uint8Array | null)[] = [];
  let readable = 0;
  for (let i = 0; i < 3; i++) {
    const settled = loaded[i];
    if (settled.status === 'rejected') throw settled.reason;
    const data = settled.value;
    const valid =
      data !== null &&
      data.length >= BIN_ARRAY_ACCOUNT_SIZE &&
      hasDiscriminator(data, BIN_ARRAY_DISCRIMINATOR) &&
      Number(BigInt.asIntN(64, readUintLE(data, OFF_BA_INDEX, 8))) === arrayIndexes[i];
    if (!valid) break;
    arrays.push(data);
    readable += 1;
  }

  const bins: DlmmBin[] = [];
  const amountOffset = swapForY ? OFF_BIN_AMOUNT_Y : OFF_BIN_AMOUNT_X;
  for (let a = 0; a < readable && bins.length < METEORA_DLMM_MAX_BINS; a++) {
    const data = arrays[a]!;
    const start = arrayIndexes[a] * BINS_PER_ARRAY;
    let offset: number;
    if (a === 0) {
      offset = activeId - start; // the active bin's offset within its array
    } else {
      offset = swapForY ? BINS_PER_ARRAY - 1 : 0;
    }
    while (offset >= 0 && offset < BINS_PER_ARRAY && bins.length < METEORA_DLMM_MAX_BINS) {
      const cell = OFF_BA_BINS + offset * BIN_LEN;
      if (readUintLE(data, cell + amountOffset, 8) > 0n) {
        const binId = start + offset;
        bins.push({ arrayIndex: a, offset, binId, price: priceFromId(binId, binStep) });
      }
      offset += swapForY ? -1 : 1;
    }
  }

  return { binArrays, arrayIndexes, bins, readable };
}

/**
 * Fetch + gate one DLMM pair (see the header for the gate list) and freeze
 * both directions' bin windows. Read-only against the loader.
 */
export async function fetchMeteoraDlmmConfig(load: AccountLoader, pair: Address): Promise<MeteoraDlmmPoolConfig> {
  const data = await load(pair);
  if (data === null) throw new Error(`${SLUG}: pair account ${pair} not found`);
  if (data.length !== LB_PAIR_ACCOUNT_SIZE) {
    throw new Error(`${SLUG}: pair ${pair} has ${data.length} bytes, expected ${LB_PAIR_ACCOUNT_SIZE}`);
  }
  if (!hasDiscriminator(data, LB_PAIR_DISCRIMINATOR)) {
    throw new Error(`${SLUG}: pair ${pair} has a foreign discriminator (not an LbPair account)`);
  }
  if (data[OFF_STATUS] !== 0) {
    throw new Error(`${SLUG}: pair ${pair} is not Enabled (status ${data[OFF_STATUS]})`);
  }
  if (data[OFF_COLLECT_FEE_MODE] !== 0) {
    throw new Error(
      `${SLUG}: pair ${pair} uses collect_fee_mode ${data[OFF_COLLECT_FEE_MODE]} (OnlyY) — the ladder walks the fee-on-input (InputOnly) path only`,
    );
  }
  if (isSupportLimitOrder(data)) {
    throw new Error(`${SLUG}: pair ${pair} supports limit orders — the limit-order fill layers are unsupported`);
  }
  // Slot-typed activation the in-VM quote cannot read (mirroring damm-v2).
  const pairType = data[OFF_PAIR_TYPE];
  if ((pairType === 1 || pairType === 2) && data[OFF_ACTIVATION_TYPE] === 0 && readUintLE(data, OFF_ACTIVATION_POINT, 8) !== 0n) {
    throw new Error(`${SLUG}: pair ${pair} is slot-activated (activation_type 0) — no in-VM slot read`);
  }

  const codec = getAddressCodec();
  const tokenXMint = codec.decode(data.subarray(OFF_TOKEN_X_MINT, OFF_TOKEN_X_MINT + 32));
  const tokenYMint = codec.decode(data.subarray(OFF_TOKEN_Y_MINT, OFF_TOKEN_Y_MINT + 32));
  // The on-chain swap ix here is legacy-SPL only; detect a Token-2022 mint (or
  // one carrying an un-routable extension) via the shared data-shape resolver
  // and SELF-DROP the pool. The thrown error is the graceful-drop signal — the
  // SvmRoute orchestrator catches a fetchPoolConfig throw and drops the venue.
  // The LEGACY path stays byte-identical: a classic 82-byte mint classifies as
  // Tokenkeg, parses no extensions, and the config is built unchanged. An
  // unreadable mint falls back to the legacy assumption (keeps fixtures green).
  for (const mint of [tokenXMint, tokenYMint]) {
    const mintData = await load(mint);
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping pool ${pair} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping pool ${pair} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  const binStep = Number(readUintLE(data, OFF_BIN_STEP, 2));
  const activeId = readI32(data, OFF_ACTIVE_ID);
  const [xToY, yToX, bitmapExtension] = await Promise.all([
    resolveWindow(load, pair, activeId, binStep, true),
    resolveWindow(load, pair, activeId, binStep, false),
    memoizedGetProgramDerivedAddress(METEORA_DLMM_PROGRAM_ID, [new TextEncoder().encode('bitmap'), getAddressEncoded(pair)]),
  ]);
  // The bitmap extension exists only for pairs whose liquidity leaves the
  // default bitmap; probe it so the swap can pass the program-id None sentinel
  // when it is absent (the common case) instead of an uninitialized PDA.
  const bitmapExtensionExists = (await load(bitmapExtension)) !== null;

  return {
    venue: SLUG,
    pool: pair,
    direction: 'xToY',
    tokenXMint,
    tokenYMint,
    reserveX: codec.decode(data.subarray(OFF_RESERVE_X, OFF_RESERVE_X + 32)),
    reserveY: codec.decode(data.subarray(OFF_RESERVE_Y, OFF_RESERVE_Y + 32)),
    oracle: codec.decode(data.subarray(OFF_ORACLE, OFF_ORACLE + 32)),
    bitmapExtension,
    bitmapExtensionExists,
    binStep,
    activeId,
    baseFactor: Number(readUintLE(data, OFF_BASE_FACTOR, 2)),
    baseFeePowerFactor: data[OFF_BASE_FEE_POWER_FACTOR],
    variableFeeControl: Number(readUintLE(data, OFF_VARIABLE_FEE_CONTROL, 4)),
    maxVolatilityAccumulator: Number(readUintLE(data, OFF_MAX_VOLATILITY_ACC, 4)),
    reductionFactor: Number(readUintLE(data, OFF_REDUCTION_FACTOR, 2)),
    filterPeriod: Number(readUintLE(data, OFF_FILTER_PERIOD, 2)),
    decayPeriod: Number(readUintLE(data, OFF_DECAY_PERIOD, 2)),
    collectFeeMode: data[OFF_COLLECT_FEE_MODE],
    windows: { xToY, yToX },
  };
}

/** Family facade for the recipe orchestrator (ladder-only — no v1 adapter). */
export const meteoraDlmm = {
  slug: SLUG,
  programId: METEORA_DLMM_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchMeteoraDlmmConfig,
};
