/**
 * DefiTuna Fusion Pools (FusionAMM) — a Whirlpool-LINEAGE CLMM on Solana.
 * DefiTuna's own docs describe FusionAMM as "a hybrid (CLMM + OrderBook) AMM
 * contract... Modification based on Orca Whirlpools" (source headers in
 * github.com/DefiTuna/fusionamm-sdk, FusionAMM SDK Source-Available License;
 * the on-chain program itself is closed-source — only the client SDK + IDL
 * are public). Program id fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9,
 * 906 live pools measured (dataSize 423) at integration time.
 *
 * Layout source: target/idl/fusionamm.json (FusionPool/TickArray account
 * types) in the SDK repo above, CROSS-VERIFIED against a real mainnet dump
 * (pool 7VuKeevbvbQQcxz6N4SNLmuq6PYy4AcGQRDssoqo4t65, SOL/USDC ts=4):
 * FusionPool = 423 bytes, discriminator sha256('account:FusionPool')[0..8] =
 * fe cc cf 62 19 b5 1d 43, token_mint_a@11, token_mint_b@43, token_vault_a@75,
 * token_vault_b@107 (all pubkeys) — this matches the trimmed Whirlpool header
 * (Whirlpool itself is 653 bytes; FusionPool drops the config/reward-related
 * fields Whirlpool carries, keeping tick_spacing/fee_rate/liquidity/sqrt_price/
 * tick_current_index in the same relative shape).
 *
 * THE KEY STRUCTURAL DIVERGENCE FROM ORCA WHIRLPOOL: FusionPool's TickArray
 * account is VARIABLE-LENGTH, not the fixed 9988-byte layout Whirlpool uses.
 * The IDL's `MaybeTick` is a Rust enum (Uninitialized | Initialized(TickData))
 * Borsh-serialized as ONE tag byte (0 or 1) PLUS 112 bytes of TickData only
 * when initialized — so an all-empty tick array is 132 bytes
 * (8 + 4 + 32 + 88) and a fully-initialized one is 9988 bytes
 * (8 + 4 + 32 + 88*113), confirmed empirically: 5 real tick arrays sampled at
 * integration time measured 244/356/356/692/804 bytes, each solving
 * `88 + 112*k` exactly for k = 1/2/2/5/6 initialized ticks. This means a
 * tick's byte position within the account is NOT `offset * TICK_LEN` (the
 * Whirlpool/raydium-clmm assumption) — it depends on how many EARLIER ticks
 * in the array are initialized. Prepare-time resolution here does a
 * SEQUENTIAL scan of the fetched bytes and bakes each shipped boundary's
 * ABSOLUTE byte offset (not an index) as a compile-time constant — cheaper
 * on-chain than Whirlpool's own `OFF_TA_TICKS + offset*TICK_LEN` (no
 * multiply needed at all), but with a residual drift risk Whirlpool's fixed
 * stride does not have: if some EARLIER tick in the same array flips
 * initialized-state between prepare and execution, every LATER tick's true
 * byte offset shifts. The tag-byte check every boundary read already does
 * (`if (tag !== 1) skip` — identical to Whirlpool's own "removed since
 * prepare" check) catches the common case (a shift landing on a 0 tag), and
 * a residual false-tag-positive is bounded in the same way EVERY venue's
 * quote-vs-execution drift already is in this codebase: `minOut` is the sole
 * atomic revert/floor authority, never a per-venue model guarantee.
 *
 * Tick array PDA seeds are IDENTICAL to Whirlpool's own scheme
 * (['tick_array', pool, start_tick_index.toString()] — confirmed from the
 * SDK's rust-sdk/client/src/pda/tick_array.rs), so `windowStartTicks` is
 * reused verbatim from the orca-whirlpool module (pure function of
 * tick/spacing/direction, venue-agnostic). TICK_ARRAY_SIZE (88 slots/array)
 * and the swap-sequence window-walk semantics (aToB searches DOWN from the
 * live tick inclusive, bToA searches UP exclusive) are also unchanged from
 * Whirlpool, and the Q64.64 sqrt-price / delta-A / delta-B / next-sqrt-price
 * math is Whirlpool's verbatim (this module's `resolveWindow` reuses
 * orca-whirlpool's own `whirlpoolSqrtPriceAtTick`), so a consumer's fragment
 * can share one copy of the on-chain delta/next-sqrt helpers across an
 * orca-whirlpool slot and a defituna slot.
 *
 * VALIDATED against the REAL fusionamm.so binary (dumped from mainnet-beta)
 * executing on REAL mainnet pool + tick-array state via LiteSVM
 * (test/svm/venues/defituna.test.ts's real-CPI cell / the realcpi e2e lane):
 * at 0.05 SOL (single segment, no boundary crossed) our off-chain math is
 * BIT-EXACT to the real program's realized output. At larger single-segment
 * sizes (0.2 SOL, 1 SOL, same pool/state) we measured the real program
 * delivering marginally LESS output than our pure-CLMM model predicts (up to
 * ~0.01% at 1 SOL on the tested pool, growing with size) — most likely an
 * undocumented protocol-level adjustment in the closed-source swap
 * instruction (DefiTuna markets FusionAMM as more than plain-Whirlpool CLMM
 * math; the FusionPool account also carries an `ma_sqrt_price` field with no
 * public SDK documentation of how it feeds execution). This is a DISCLOSED,
 * MEASURED, one-sided residual (never in the favourable direction beyond the
 * exact match at small size) backstopped by `minOut` like every other venue's
 * quote-vs-execution drift in this repo — not a fund-safety gap. Re-measure
 * (ECO_SVM_CU_PRINT-style re-pin discipline) if this grows materially.
 *
 * Gates (named errors caught by the orchestrator's TOCTOU self-drop):
 * - account size / discriminator / owner (fetch-time);
 * - non-Tokenkeg mints (the swap accounts below are classic-SPL only);
 * - a direction with NO shipped boundaries and no edge (readable === 0),
 *   wired the same way as orca-whirlpool/raydium-clmm/byreal via the
 *   recipe's SvmWindowDriftError in the consuming app SVM solver entry's FAMILIES entry;
 * - a shipped boundary carrying an ACTIVE resting limit order
 *   (open_orders_input > 0 or part_filled_orders_remaining_input > 0) —
 *   FusionAMM's hybrid CLMM+orderbook model may fill resting orders at a
 *   crossed tick beyond plain liquidity_net math, which this pure-CLMM
 *   ladder does not model; every REAL tick sampled at integration time
 *   carried all-zero order fields (this is the common case), but a pool
 *   that DOES have one is self-dropped rather than risk a silently wrong
 *   quote — recoverable (an order fills/cancels), so it is the SAME
 *   SvmWindowDriftError self-drop class, wired via `window.hasActiveOrder`.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { MAX_TICK_INDEX, MIN_TICK_INDEX, whirlpoolSqrtPriceAtTick } from '../orca-whirlpool/tick-math.js';
import { readUintLE } from '../math.js';
import { memoizedGetProgramDerivedAddress } from '../pda-memo.js';
import { windowStartTicks } from '../orca-whirlpool/index.js';
import type { AccountLoader, PoolConfig } from '../types.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'defituna';
export const DEFITUNA_PROGRAM_ID = address('fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const FUSION_POOL_ACCOUNT_SIZE = 423;
/** sha256('account:FusionPool')[0..8] (IDL-given: [254,204,207,98,25,181,29,67]). */
export const FUSION_POOL_DISCRIMINATOR = [0xfe, 0xcc, 0xcf, 0x62, 0x19, 0xb5, 0x1d, 0x43];
/** sha256('account:TickArray')[0..8] (IDL-given: [85,1,199,2,188,97,101,139]). */
export const TICK_ARRAY_DISCRIMINATOR = [85, 1, 199, 2, 188, 97, 101, 139];
export const TICK_ARRAY_SIZE = 88;
/** Borsh-tagged-enum per-tick size when Initialized (1-byte tag + 112-byte TickData); 1 byte when Uninitialized. */
export const TICK_LEN_INITIALIZED = 113;
/** Minimum possible TickArray account length (all 88 ticks uninitialized): 8 + 4 + 32 + 88. */
export const TICK_ARRAY_MIN_LEN = 132;

// FusionPool offsets (fusionamm.json's FusionPool type, declared-field order, Borsh-packed).
const OFF_MINT_A = 11;
const OFF_MINT_B = 43;
const OFF_VAULT_A = 75;
const OFF_VAULT_B = 107;
const OFF_TICK_SPACING = 139;
const OFF_FEE_RATE = 143;
const OFF_LIQUIDITY = 151;
const OFF_SQRT_PRICE = 167;
const OFF_TICK_CURRENT = 183;

// TickArray offsets.
const OFF_TA_START = 8;
const OFF_TA_TICKS = 44;

/**
 * Shipped initialized-tick boundaries per direction — same budget class as
 * orca-whirlpool/raydium-clmm (2 rungs default, degrade-first CU kind).
 */
export const DEFITUNA_MAX_BOUNDARIES = 4;

export interface DefiTunaBoundary {
  arrayIndex: number;
  /** ABSOLUTE byte offset of the tick's tag byte within its TickArray account (see header — NOT offset*stride). */
  byteOffset: number;
  tick: number;
  sqrtPrice: bigint;
}

export interface DefiTunaWindow {
  tickArrays: [Address, Address, Address];
  startTicks: [number, number, number];
  boundaries: DefiTunaBoundary[];
  edge: { tick: number; sqrtPrice: bigint } | null;
  /** Contiguous prefix of tickArrays that existed as real TickArray accounts at prepare. */
  readable: number;
  /** True when a SHIPPED boundary carries a live resting limit order (see header gate). */
  hasActiveOrder: boolean;
}

export interface DefiTunaPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  direction: 'aToB' | 'bToA';
  tokenMintA: Address;
  tokenMintB: Address;
  tokenVaultA: Address;
  tokenVaultB: Address;
  tickSpacing: number;
  feeRate: number;
  liquidity: bigint;
  sqrtPrice: bigint;
  tickCurrentIndex: number;
  windows: { aToB: DefiTunaWindow; bToA: DefiTunaWindow };
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
async function deriveTickArrayPda(pool: Address, startTick: number): Promise<Address> {
  return memoizedGetProgramDerivedAddress(DEFITUNA_PROGRAM_ID, [
    new TextEncoder().encode('tick_array'),
    getAddressEncoded(pool),
    new TextEncoder().encode(String(startTick)),
  ]);
}

interface DecodedTick {
  tick: number;
  byteOffset: number;
  liquidityNetRaw: bigint;
  hasOrder: boolean;
}

/**
 * Sequential Borsh-tagged-enum scan of one TickArray's raw bytes (see header
 * — NOT a fixed stride). Stops defensively on an unrecognized tag byte
 * (foreign/corrupt data) rather than misreading the rest of the account.
 */
function scanTickArray(data: Uint8Array, startTick: number, tickSpacing: number): DecodedTick[] {
  const out: DecodedTick[] = [];
  let pos = OFF_TA_TICKS;
  for (let slot = 0; slot < TICK_ARRAY_SIZE && pos < data.length; slot++) {
    const tag = data[pos];
    if (tag === 0) {
      pos += 1;
      continue;
    }
    if (tag !== 1) break; // defensive: unrecognized encoding, stop rather than misread
    if (pos + TICK_LEN_INITIALIZED > data.length) break; // truncated tail, stop rather than misread
    const liquidityNetRaw = readUintLE(data, pos + 1, 16);
    const openOrdersInput = readUintLE(data, pos + 73, 8);
    const partFilledRemaining = readUintLE(data, pos + 89, 8);
    out.push({
      tick: startTick + slot * tickSpacing,
      byteOffset: pos,
      liquidityNetRaw,
      hasOrder: openOrdersInput > 0n || partFilledRemaining > 0n,
    });
    pos += TICK_LEN_INITIALIZED;
  }
  return out;
}

/**
 * Scan the readable window for initialized-tick boundaries in walk order —
 * identical direction semantics to orca-whirlpool's resolveWindow (aToB
 * searches DOWN from the live tick inclusive, bToA searches UP exclusive;
 * later arrays search their full span), adapted for the variable-length
 * per-array scan above instead of a fixed-offset walk.
 */
async function resolveWindow(
  load: AccountLoader,
  pool: Address,
  tickCurrentIndex: number,
  tickSpacing: number,
  aToB: boolean,
): Promise<DefiTunaWindow> {
  const startTicks = windowStartTicks(tickCurrentIndex, tickSpacing, aToB) as [number, number, number];
  const tickArrays = (await Promise.all(startTicks.map((start) => deriveTickArrayPda(pool, start)))) as [Address, Address, Address];
  const tickDatas = await Promise.all(tickArrays.map((a) => load(a)));
  const arrays: Uint8Array[] = [];
  let readable = 0;
  for (let i = 0; i < 3; i++) {
    const data = tickDatas[i];
    const valid =
      data !== null &&
      data.length >= TICK_ARRAY_MIN_LEN &&
      hasDiscriminator(data, TICK_ARRAY_DISCRIMINATOR) &&
      readI32(data, OFF_TA_START) === startTicks[i];
    if (!valid) break;
    arrays.push(data as Uint8Array);
    readable += 1;
  }

  const boundaries: DefiTunaBoundary[] = [];
  let hasActiveOrder = false;
  let maxStopped = false;
  for (let a = 0; a < readable && !maxStopped; a++) {
    const decoded = scanTickArray(arrays[a]!, startTicks[a]!, tickSpacing);
    const candidates =
      a === 0
        ? aToB
          ? decoded.filter((t) => t.tick <= tickCurrentIndex).sort((x, y) => y.tick - x.tick)
          : decoded.filter((t) => t.tick > tickCurrentIndex).sort((x, y) => x.tick - y.tick)
        : aToB
          ? [...decoded].sort((x, y) => y.tick - x.tick)
          : [...decoded].sort((x, y) => x.tick - y.tick);
    for (const c of candidates) {
      boundaries.push({ arrayIndex: a, byteOffset: c.byteOffset, tick: c.tick, sqrtPrice: whirlpoolSqrtPriceAtTick(c.tick) });
      if (c.hasOrder) hasActiveOrder = true;
      if (boundaries.length === DEFITUNA_MAX_BOUNDARIES) {
        maxStopped = true;
        break;
      }
    }
  }

  let edge: { tick: number; sqrtPrice: bigint } | null = null;
  if (readable > 0 && !maxStopped) {
    const lastStart = startTicks[readable - 1]!;
    let tick: number;
    if (aToB) {
      tick = Math.max(lastStart, MIN_TICK_INDEX);
    } else {
      tick = lastStart + TICK_ARRAY_SIZE * tickSpacing - 1;
      if (lastStart + TICK_ARRAY_SIZE * tickSpacing > MAX_TICK_INDEX) tick = MAX_TICK_INDEX;
    }
    edge = { tick, sqrtPrice: whirlpoolSqrtPriceAtTick(tick) };
  }

  return { tickArrays, startTicks, boundaries, edge, readable, hasActiveOrder };
}

/** Fetch + decode one FusionPool and freeze both directions' boundary windows. Read-only against the loader. */
export async function fetchDefiTunaPoolConfig(load: AccountLoader, pool: Address): Promise<DefiTunaPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool account ${pool} not found`);
  if (data.length !== FUSION_POOL_ACCOUNT_SIZE) {
    throw new Error(`${SLUG}: pool ${pool} has ${data.length} bytes, expected ${FUSION_POOL_ACCOUNT_SIZE}`);
  }
  if (!hasDiscriminator(data, FUSION_POOL_DISCRIMINATOR)) {
    throw new Error(`${SLUG}: pool ${pool} has a foreign discriminator (not a FusionPool account)`);
  }

  const codec = getAddressCodec();
  const tokenMintA = codec.decode(data.subarray(OFF_MINT_A, OFF_MINT_A + 32)) as Address;
  const tokenMintB = codec.decode(data.subarray(OFF_MINT_B, OFF_MINT_B + 32)) as Address;
  // The swap accounts here are classic-SPL only, so a Token-2022 mint (or one
  // carrying an un-routable extension) SELF-DROPS this pool: the thrown error is
  // the graceful-drop signal the SvmRoute orchestrator catches. An unreadable
  // mint falls back to the legacy assumption (a classic 82-byte mint classifies
  // legacy → no throw → config built byte-identically to before).
  const mintList = [tokenMintA, tokenMintB];
  const mintDatas = await Promise.all(mintList.map((mint) => load(mint)));
  for (let mi = 0; mi < mintList.length; mi++) {
    const mint = mintList[mi]!;
    const mintData = mintDatas[mi];
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`);
    }
    const { blocking } = parseMintExtensions(mintData);
    if (blocking.length > 0) {
      throw new Error(`${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join('; ')}`);
    }
  }

  const tickSpacing = Number(readUintLE(data, OFF_TICK_SPACING, 2));
  const tickCurrentIndex = readI32(data, OFF_TICK_CURRENT);
  const [aToB, bToA] = await Promise.all([
    resolveWindow(load, pool, tickCurrentIndex, tickSpacing, true),
    resolveWindow(load, pool, tickCurrentIndex, tickSpacing, false),
  ]);

  return {
    venue: SLUG,
    pool,
    direction: 'aToB',
    tokenMintA,
    tokenMintB,
    tokenVaultA: codec.decode(data.subarray(OFF_VAULT_A, OFF_VAULT_A + 32)) as Address,
    tokenVaultB: codec.decode(data.subarray(OFF_VAULT_B, OFF_VAULT_B + 32)) as Address,
    tickSpacing,
    feeRate: Number(readUintLE(data, OFF_FEE_RATE, 2)),
    liquidity: readUintLE(data, OFF_LIQUIDITY, 16),
    sqrtPrice: readUintLE(data, OFF_SQRT_PRICE, 16),
    tickCurrentIndex,
    windows: { aToB, bToA },
  };
}

/** Family facade for the recipe orchestrator (ladder-only, like orca-whirlpool/raydium-clmm/byreal). */
export const defituna = {
  slug: SLUG,
  programId: DEFITUNA_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchDefiTunaPoolConfig,
};

