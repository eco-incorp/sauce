/**
 * Invariant Protocol — a Uniswap-V3-lineage CLMM on Solana (Anchor program,
 * fully OPEN SOURCE: github.com/invariant-labs/protocol, `programs/invariant`),
 * program id HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJutt. NOT an on-chain IDL
 * job and NOT reverse-engineering — the layout source is the published Rust
 * crate (`invariant-types`/`programs/invariant/src/{structs,math,util}.rs`).
 *
 * GROUND-TRUTHED LIVE against real mainnet state at integration time (2026-07-31):
 * - `Pool` zero-copy account: 400 bytes (8-byte Anchor discriminator
 *   sha256('account:Pool')[0..8] + 392 bytes, `#[repr(packed)]`, NO padding).
 *   604 live pool accounts confirmed at exactly this dataSize+discriminator via
 *   getProgramAccounts. Field offsets (after the 8-byte discriminator):
 *   token_x@8, token_y@40, token_x_reserve@72, token_y_reserve@104,
 *   position_iterator(u128)@136, tick_spacing(u16)@152, fee(u128,1e12-scaled
 *   FixedPoint)@154, protocol_fee(u128)@170, liquidity(u128,1e6-scaled)@186,
 *   sqrt_price(u128,1e24-scaled)@202, current_tick_index(i32)@218,
 *   tickmap(pubkey)@222. 16 real on-chain FeeTier accounts confirm the fee
 *   scale (values from 0.00001 to 0.5, i.e. up to 50% on exotic tiers — an
 *   unusually wide range, but real and chain-configured, not a decode bug).
 * - `Tick` zero-copy account: 150 bytes (8 + pool(32) + index(i32)@40 +
 *   sign(bool)@44 + liquidity_change(u128,1e6-scaled)@45 + liquidity_gross(u128)
 *   + sqrt_price(u128) + ...). PDA seeds `["tickv1", pool, index_i32_le]` —
 *   verified: 8 PDAs derived off-chain for a real pool's tickmap-reported
 *   initialized indices all matched real on-chain accounts with the EXACT
 *   expected `index` field decoded back out.
 * - `Tickmap` zero-copy account: a single ~11KB fixed bitmap per pool
 *   (`bitmap: [u8; 11091]`), NOT an array-of-ticks (unlike Whirlpool/Raydium
 *   CLMM) — ticks are individually PDA'd, so "one boundary" here means "one
 *   more account", not "one more index into a shared array". `next_initialized`
 *   /`prev_initialized`/`get_search_limit`/`tick_to_position` are ported
 *   verbatim (bigint) from `structs/tickmap.rs` and validated against a real
 *   pool's real bitmap (found initialized ticks [5,2,1,0,-1,-2] walking down
 *   from a live tick of 8, confirmed by fetching all 8 real Tick PDAs).
 * - `calculate_price_sqrt` (the bit-ladder of custom FixedPoint(1e12)
 *   constants, NOT `1.0001^tick` — Invariant's own reduced-precision
 *   approximation) is ported verbatim and passes every vector in
 *   `math.rs`'s `test_calculate_price_sqrt`.
 * - `compute_swap_step`/`get_delta_x`/`get_delta_y`/`get_next_sqrt_price_x_up`/
 *   `get_next_sqrt_price_y_down` (the exact ceil/floor rounding conventions,
 *   including the "double ceil/floor" TokenAmount-conversion pattern
 *   `big_div_values_to_token{,_up}`) are ported verbatim and pass every
 *   vector in `math.rs`'s `test_swap_step`/`test_get_delta_x`/
 *   `test_get_delta_y`/`test_get_next_sqrt_price_{x_up,y_down}` (32/32).
 * - `cross_tick`'s liquidity update (`structs/util.rs`) reduces, for a
 *   DIRECTED single-pass walk (this ladder never re-visits an earlier tick),
 *   to a per-direction-invariant rule: `pool.current_tick_index >= tick.index`
 *   is ALWAYS true while walking DOWN (xToY) and ALWAYS false while walking UP
 *   (yToX) — proved by induction over the walk (each step's post-cross
 *   current_tick lands AT OR BELOW/ABOVE the crossed tick, and the next
 *   boundary is strictly further in the same direction). So: xToY crossing a
 *   tick with `sign=true` SUBTRACTS `liquidity_change`, `sign=false` ADDS;
 *   yToX is the mirror (`sign=true` ADDS, `sign=false` SUBTRACTS).
 * - The `swap` instruction (Anchor global disc sha256('global:swap')[0..8] =
 *   [248,198,158,145,225,117,135,200] — the SAME 8 bytes as
 *   Whirlpool's/DefiTuna's `swap`, since Anchor discriminators depend only on
 *   the instruction NAME) takes `(x_to_y: bool, amount: u64, by_amount_in:
 *   bool, sqrt_price_limit: u128)` and a FIXED 10-account list — state(ro),
 *   pool(mut), tickmap(mut), account_x(mut), account_y(mut), reserve_x(mut),
 *   reserve_y(mut), owner(signer), program_authority(ro), token_program(ro) —
 *   PLUS the crossed-tick PDAs as `remaining_accounts` (order-independent: the
 *   program `.find()`s each by pubkey). Classic `token::transfer` (not
 *   `transfer_checked`) — no mint accounts needed. `state` (seeds
 *   `["statev1"]`) and `program_authority` (seeds `["Invariant"]`) are
 *   GLOBAL, pool-independent PDAs — hardcoded below and verified against real
 *   mainnet accounts (the `State` account's own `authority` field byte-decodes
 *   to exactly the hardcoded `program_authority` address).
 *
 * VALIDATED against the REAL deployed program (dumped from mainnet-beta) via
 * LiteSVM real-CPI on real mainnet pool/tickmap/tick state (pool
 * 5dX3tkVDmbHBWMCQMerAHTmd9wsRvmtKLoQt6qv9fHy7, USDC/USDT, tick_spacing=1,
 * fee=1bp) at THREE sizes, all BIT-EXACT to this module's off-chain math:
 *   100_000 USDC-raw    -> 100_075 USDT-raw   (single segment, no crossing)
 *   1_000_000 USDC-raw  -> 1_000_755 USDT-raw (single segment, no crossing)
 *   700_000_000 USDC-raw -> 700_381_707 USDT-raw (crosses tick 5, real
 *     on-chain `cross_tick` executes and the post-cross liquidity this
 *     module predicts off-chain matches the real program's realized output
 *     exactly — proves the cross-tick sign rule above, not just the
 *     no-crossing math).
 * See test/svm/venues/invariant.test.ts for the fixture-driven regression of
 * this exact quadrilateral (offline) and the SAUCE_VENUE_PROGRAMS-gated
 * real-CPI cell in the consuming app realcpi e2e test.
 *
 * Volume is thin (~$0.04M/7d per the integration brief) — this ladder is
 * wired unconditionally; the existing relative-depth survivorship filter
 * drops it from an election whenever it is too shallow to matter, exactly
 * like every other thin venue in this recipe. A pool/direction with no
 * initialized tick within the tickmap's chained search range (no boundary to
 * bound the walk) self-drops via `SvmWindowDriftError`, matching
 * orca-whirlpool/raydium-clmm/meteora-dlmm's own "nothing to walk" gate.
 */
import { address, getAddressCodec } from '@solana/kit';
import type { Address } from '@solana/kit';
import { readUintLE } from '../math.js';
import type { AccountLoader, PoolConfig } from '../types.js';
import { memoizedGetProgramDerivedAddress } from '../pda-memo.js';
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from '../../token-program.js';
import { parseMintExtensions } from '../../token-extensions.js';

const SLUG = 'invariant';
export const INVARIANT_PROGRAM_ID = address('HyaB3W9q6XdA5xwpU4XnSZV94htfmbmqJXZcEbRaJutt');
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const POOL_ACCOUNT_SIZE = 400;
/** sha256('account:Pool')[0..8]. */
export const POOL_DISCRIMINATOR = [0xf1, 0x9a, 0x6d, 0x04, 0x11, 0xb1, 0x6d, 0xbc];
/** sha256('account:Tick')[0..8]. */
export const TICK_DISCRIMINATOR = [0xb0, 0x5e, 0x43, 0xf7, 0x85, 0xad, 0x07, 0x73];
export const TICK_ACCOUNT_SIZE = 150;
export const TICKMAP_ACCOUNT_SIZE = 8 + 11091;

// Pool field offsets (after the 8-byte discriminator; see header for the full field list).
const OFF_TOKEN_X = 8;
const OFF_TOKEN_Y = 40;
const OFF_TOKEN_X_RESERVE = 72;
const OFF_TOKEN_Y_RESERVE = 104;
const OFF_TICK_SPACING = 152;
const OFF_CURRENT_TICK = 218;
const OFF_TICKMAP = 222;

// Decimal scales.
const PRICE_ONE = 10n ** 24n;
const LIQ_ONE = 10n ** 6n;
const FEE_ONE = 10n ** 12n;
const PRICE_LIQUIDITY_DENOMINATOR = 10n ** 18n;

// Tickmap constants (structs/tickmap.rs).
const TICK_LIMIT = 44_364;
const TICK_SEARCH_RANGE = 256;
const MAX_TICK = 221_818;

/** Shipped boundaries per direction — one ACCOUNT per boundary (no shared tick-array amortization). */
export const INVARIANT_MAX_BOUNDARIES = 3;

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/** calculate_price_sqrt (math.rs) — the custom bit-ladder, NOT 1.0001^tick. Verified vs 7 Rust vectors. */
const TICK_BITS: readonly [number, bigint][] = [
  [0x1, 1000049998750n],
  [0x2, 1000100000000n],
  [0x4, 1000200010000n],
  [0x8, 1000400060004n],
  [0x10, 1000800280056n],
  [0x20, 1001601200560n],
  [0x40, 1003204964963n],
  [0x80, 1006420201726n],
  [0x100, 1012881622442n],
  [0x200, 1025929181080n],
  [0x400, 1052530684591n],
  [0x800, 1107820842005n],
  [0x1000, 1227267017980n],
  [0x2000, 1506184333421n],
  [0x4000, 2268591246242n],
  [0x8000, 5146506242525n],
  [0x10000, 26486526504348n],
  [0x20000, 701536086265529n],
];

export function invariantSqrtPriceAtTick(tickIndex: number): bigint {
  const tick = Math.abs(tickIndex);
  if (tick > MAX_TICK) throw new Error(`invariant: tick ${tickIndex} out of bounds`);
  let price = FEE_ONE;
  for (const [mask, c] of TICK_BITS) {
    if (tick & mask) price = (price * c) / FEE_ONE;
  }
  if (tickIndex >= 0) return price * (PRICE_ONE / FEE_ONE);
  const inv = (FEE_ONE * FEE_ONE) / price;
  return inv * (PRICE_ONE / FEE_ONE);
}

// ── get_delta_x / get_delta_y / get_next_sqrt_price_{x_up,y_down} (math.rs) ──
// Verified bit-exact against 32 Rust unit-test vectors AND a real-CPI quadrilateral (see header).

export function invariantDeltaX(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, up: boolean): bigint {
  const deltaPrice = sqrtA > sqrtB ? sqrtA - sqrtB : sqrtB - sqrtA;
  const nominator = (deltaPrice * liquidity) / LIQ_ONE; // big_mul_to_value (floor), always non-up
  if (up) {
    const denom = (sqrtA * sqrtB) / PRICE_ONE; // big_mul_to_value (floor)
    return ceilDiv(ceilDiv(nominator * PRICE_ONE, denom), PRICE_ONE);
  }
  const denom = ceilDiv(sqrtA * sqrtB, PRICE_ONE); // big_mul_to_value_up (ceil)
  return (nominator * PRICE_ONE) / denom / PRICE_ONE;
}

export function invariantDeltaY(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, up: boolean): bigint {
  const deltaPrice = sqrtA > sqrtB ? sqrtA - sqrtB : sqrtB - sqrtA;
  if (up) return ceilDiv(ceilDiv(deltaPrice * liquidity, LIQ_ONE), PRICE_ONE);
  return (deltaPrice * liquidity) / LIQ_ONE / PRICE_ONE;
}

/** get_next_sqrt_price_x_up(price, liquidity, amount, add=true) — the ONLY branch a by-amount-in ladder ever needs. */
export function invariantNextSqrtXUp(price: bigint, liquidity: bigint, amount: bigint): bigint {
  if (amount === 0n) return price;
  const bigLiquidity = liquidity * PRICE_LIQUIDITY_DENOMINATOR;
  const denominator = bigLiquidity + price * amount;
  const nom = ceilDiv(price * liquidity, LIQ_ONE);
  return ceilDiv(nom * PRICE_ONE, denominator);
}

/** get_next_sqrt_price_y_down(price, liquidity, amount, add=true). */
export function invariantNextSqrtYDown(price: bigint, liquidity: bigint, amount: bigint): bigint {
  if (amount === 0n) return price;
  const num = amount * PRICE_ONE * PRICE_ONE;
  const den = liquidity * PRICE_LIQUIDITY_DENOMINATOR;
  return price + num / den;
}

export interface InvariantSwapStep {
  nextSqrt: bigint;
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
}

/**
 * compute_swap_step (math.rs), BY-AMOUNT-IN ONLY (the merge ladder never
 * quotes by-amount-out). `xToY` is derived exactly like the Rust source
 * (`current_price_sqrt >= target_price_sqrt`).
 */
export function invariantComputeSwapStepIn(currentSqrt: bigint, targetSqrt: bigint, liquidity: bigint, amount: bigint, fee: bigint): InvariantSwapStep {
  if (liquidity === 0n) return { nextSqrt: targetSqrt, amountIn: 0n, amountOut: 0n, feeAmount: 0n };
  const xToY = currentSqrt >= targetSqrt;
  const amountAfterFee = (amount * (FEE_ONE - fee)) / FEE_ONE;
  const fx = xToY ? invariantDeltaX(targetSqrt, currentSqrt, liquidity, true) : invariantDeltaY(currentSqrt, targetSqrt, liquidity, true);
  const nextSqrt = amountAfterFee >= fx ? targetSqrt : xToY ? invariantNextSqrtXUp(currentSqrt, liquidity, amountAfterFee) : invariantNextSqrtYDown(currentSqrt, liquidity, amountAfterFee);
  const notMax = targetSqrt !== nextSqrt;
  let amountIn: bigint;
  let amountOut: bigint;
  if (xToY) {
    amountIn = notMax ? invariantDeltaX(nextSqrt, currentSqrt, liquidity, true) : fx;
    amountOut = invariantDeltaY(nextSqrt, currentSqrt, liquidity, false);
  } else {
    amountIn = notMax ? invariantDeltaY(currentSqrt, nextSqrt, liquidity, true) : fx;
    amountOut = invariantDeltaX(currentSqrt, nextSqrt, liquidity, false);
  }
  const feeAmount = notMax ? amount - amountIn : ceilDiv(amountIn * fee, FEE_ONE);
  return { nextSqrt, amountIn, amountOut, feeAmount };
}

// ── Tickmap bit-scan (structs/tickmap.rs), ported verbatim. Off-chain only — the on-chain quote
// never re-scans the tickmap; boundary prices/refs are baked at prepare time. ──

function tickToPosition(tick: number, tickSpacing: number): [number, number] {
  if (tick % tickSpacing !== 0) throw new Error(`invariant: tick ${tick} not divisible by spacing ${tickSpacing}`);
  const bitmapIndex = Math.trunc(tick / tickSpacing) + TICK_LIMIT;
  const byte = Math.trunc(bitmapIndex / 8);
  const bit = ((bitmapIndex % 8) + 8) % 8;
  return [byte, bit];
}

function getSearchLimit(tick: number, tickSpacing: number, up: boolean): number {
  const index = Math.trunc(tick / tickSpacing);
  let limit: number;
  if (up) {
    limit = Math.min(TICK_LIMIT - 1, index + TICK_SEARCH_RANGE, Math.trunc(MAX_TICK / tickSpacing));
  } else {
    limit = Math.max(-TICK_LIMIT + 1, index - TICK_SEARCH_RANGE, -Math.trunc(MAX_TICK / tickSpacing));
  }
  return limit * tickSpacing;
}

function nextInitialized(bitmap: Uint8Array, tick: number, tickSpacing: number): number | null {
  const limit = getSearchLimit(tick, tickSpacing, true);
  let [byte, bit] = tickToPosition(tick + tickSpacing, tickSpacing);
  const [limitingByte, limitingBit] = tickToPosition(limit, tickSpacing);
  while (byte < limitingByte || (byte === limitingByte && bit <= limitingBit)) {
    let shifted = bitmap[byte]! >> bit;
    if (shifted !== 0) {
      while ((shifted & 1) === 0) {
        shifted >>= 1;
        bit += 1;
      }
      if (byte < limitingByte || (byte === limitingByte && bit <= limitingBit)) {
        return (byte * 8 + bit - TICK_LIMIT) * tickSpacing;
      }
      return null;
    }
    byte += 1;
    bit = 0;
  }
  return null;
}

function prevInitialized(bitmap: Uint8Array, tick: number, tickSpacing: number): number | null {
  const limit = getSearchLimit(tick, tickSpacing, false);
  let [byte, bit] = tickToPosition(tick, tickSpacing);
  const [limitingByte, limitingBit] = tickToPosition(limit, tickSpacing);
  while (byte > limitingByte || (byte === limitingByte && bit >= limitingBit)) {
    let mask = 1 << bit;
    const value = bitmap[byte]!;
    if (value % (mask << 1) > 0) {
      while ((value & mask) === 0) {
        mask >>= 1;
        bit -= 1;
      }
      if (byte > limitingByte || (byte === limitingByte && bit >= limitingBit)) {
        return (byte * 8 + bit - TICK_LIMIT) * tickSpacing;
      }
      return null;
    }
    byte -= 1;
    bit = 7;
  }
  return null;
}

async function deriveTickPda(pool: Address, tickIndex: number): Promise<Address> {
  const poolBytes = new Uint8Array(getAddressCodec().encode(pool));
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setInt32(0, tickIndex, true);
  return memoizedGetProgramDerivedAddress(INVARIANT_PROGRAM_ID, [
    new TextEncoder().encode('tickv1'),
    poolBytes,
    indexBytes,
  ]);
}

function hasDiscriminator(data: Uint8Array, discriminator: readonly number[]): boolean {
  return discriminator.every((byte, i) => data[i] === byte);
}

export interface InvariantBoundary {
  tick: number;
  sqrtPrice: bigint;
  address: Address;
}

export interface InvariantWindow {
  boundaries: InvariantBoundary[];
}

export interface InvariantPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  direction: 'xToY' | 'yToX';
  tokenXMint: Address;
  tokenYMint: Address;
  tokenXReserve: Address;
  tokenYReserve: Address;
  tickmap: Address;
  windows: { xToY: InvariantWindow; yToX: InvariantWindow };
}

/**
 * Chains next_initialized/prev_initialized calls (each internally bounded to
 * a +/-256 index search range, matching the on-chain single-call bound) to
 * find up to INVARIANT_MAX_BOUNDARIES initialized tick indices walking away
 * from `currentTick`, then derives + confirms each real Tick PDA. Takes the
 * ALREADY-FETCHED tickmap bitmap bytes (shared across both directions).
 */
async function resolveWindowFromBitmap(
  load: AccountLoader,
  pool: Address,
  bitmap: Uint8Array,
  currentTick: number,
  tickSpacing: number,
  xToY: boolean,
): Promise<InvariantWindow> {
  const boundaries: InvariantBoundary[] = [];
  let cursor = currentTick;
  for (let i = 0; i < INVARIANT_MAX_BOUNDARIES; i++) {
    const found = xToY ? prevInitialized(bitmap, cursor, tickSpacing) : nextInitialized(bitmap, cursor, tickSpacing);
    if (found === null) break;
    const tickAddress = await deriveTickPda(pool, found);
    const data = await load(tickAddress);
    if (data === null || data.length !== TICK_ACCOUNT_SIZE || !hasDiscriminator(data, TICK_DISCRIMINATOR)) break;
    boundaries.push({ tick: found, sqrtPrice: invariantSqrtPriceAtTick(found), address: tickAddress });
    cursor = xToY ? found - tickSpacing : found + tickSpacing; // don't check the current tick again
  }
  return { boundaries };
}

/** Fetch + decode one Invariant Pool and freeze both directions' boundary windows. Read-only against the loader. */
export async function fetchInvariantPoolConfig(load: AccountLoader, pool: Address): Promise<InvariantPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool account ${pool} not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) throw new Error(`${SLUG}: pool ${pool} has ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`);
  if (!hasDiscriminator(data, POOL_DISCRIMINATOR)) throw new Error(`${SLUG}: pool ${pool} has a foreign discriminator (not a Pool account)`);

  const codec = getAddressCodec();
  const tokenXMint = codec.decode(data.subarray(OFF_TOKEN_X, OFF_TOKEN_X + 32)) as Address;
  const tokenYMint = codec.decode(data.subarray(OFF_TOKEN_Y, OFF_TOKEN_Y + 32)) as Address;
  const tokenXReserve = codec.decode(data.subarray(OFF_TOKEN_X_RESERVE, OFF_TOKEN_X_RESERVE + 32)) as Address;
  const tokenYReserve = codec.decode(data.subarray(OFF_TOKEN_Y_RESERVE, OFF_TOKEN_Y_RESERVE + 32)) as Address;
  const tickmap = codec.decode(data.subarray(OFF_TICKMAP, OFF_TICKMAP + 32)) as Address;

  // The swap ix here is classic `token::transfer` (Tokenkeg-only, no mint
  // accounts). SELF-DROP a Token-2022 mint (or one carrying an un-routable
  // extension) by throwing — the SvmRoute orchestrator catches a fetchPoolConfig
  // throw and drops the venue. An unreadable mint falls back to the legacy
  // assumption, keeping every existing fixture-driven test green.
  const _mints = [tokenXMint, tokenYMint];
  const _mintDatas = await Promise.all(_mints.map((mint) => load(mint)));
  for (let _i = 0; _i < _mints.length; _i++) {
    const mint = _mints[_i]!;
    const mintData = _mintDatas[_i]!;
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
  const currentTick = ((): number => {
    const u = Number(readUintLE(data, OFF_CURRENT_TICK, 4));
    return u >= 0x8000_0000 ? u - 0x1_0000_0000 : u;
  })();

  const tickmapData = await load(tickmap);
  if (tickmapData === null) throw new Error(`${SLUG}: tickmap ${tickmap} of pool ${pool} not found`);
  const bitmap = tickmapData.subarray(8);

  const [xToY, yToX] = await Promise.all([
    resolveWindowFromBitmap(load, pool, bitmap, currentTick, tickSpacing, true),
    resolveWindowFromBitmap(load, pool, bitmap, currentTick, tickSpacing, false),
  ]);

  return {
    venue: SLUG,
    pool,
    direction: 'xToY',
    tokenXMint,
    tokenYMint,
    tokenXReserve,
    tokenYReserve,
    tickmap,
    windows: { xToY, yToX },
  };
}

/** Family facade for the recipe orchestrator (ladder-only, like orca-whirlpool/raydium-clmm). */
export const invariant = {
  slug: SLUG,
  programId: INVARIANT_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  fetchPoolConfig: fetchInvariantPoolConfig,
};

