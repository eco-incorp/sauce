/**
 * Raydium CLMM (concentrated liquidity) venue — pool decoding, scope gates and
 * the prepare-declared tick-boundary WINDOW for the SvmRoute ladder fragment
 * (./ladder.ts). LADDER-ONLY (adapter contract v2): a CLMM quote is a tick walk
 * over a data-dependent account set, so there is no v1 SvmVenueAdapter and the
 * venue is not in the v1 registry. The design is the Orca-Whirlpools WINDOW
 * pattern retargeted to Raydium's layout + math (see ./ladder.ts and
 * the historical venue investigation).
 *
 * Layout source-verified against github.com/raydium-io/raydium-clmm
 * (programs/amm/src/states/{pool,tick_array,config,pool_fee}.rs,
 * libraries/{tick_math,sqrt_price_math,liquidity_math,swap_math}.rs) AND a
 * mainnet dump of the SOL/USDC 0.04% pool 3ucNos4N... (snapshot slot
 * ~431198953, sdk/test/svm/fixtures/raydium-clmm/): PoolState = 1544 bytes
 * (8 disc + 1536 struct), discriminator sha256('account:PoolState')[0..8] =
 * f7 ed e3 f5 d7 c3 de 46 (SHARED with raydium-cp-swap — size 1544 and the
 * CAMM program owner discriminate); AmmConfig = 117 bytes, discriminator
 * da f4 21 68 cb cb 2b 6f; TickArrayState = 10240 bytes, discriminator
 * c0 9b 55 cd 31 f9 81 2a. All integers little-endian; liquidity_net is i128
 * LE two's-complement and tick indices are i32 LE (read unsigned + biased by
 * 2^31 in-VM). Raydium has no per-tick `initialized` byte (unlike whirlpool):
 * upstream's TickState::is_initialized() is has_liquidity() (liquidity_gross
 * != 0) OR has_limit_orders() (orders_amount != 0 || part_filled_orders_
 * remaining != 0), and the swap matches a boundary tick's limit orders
 * UNCONDITIONALLY (before any liquidity crossing). The ladder models ONLY the
 * liquidity crossing, so it uses liquidity_gross != 0 as its boundary condition
 * and GATES any pool whose scanned window carries active limit orders (see
 * tickHasLimitOrders) — a conservative drop, never mis-modeled order math. On
 * the classic order-free CLMM build those two order u64s lie inside the
 * never-written padding[13] region and read as zero, so the gate is a no-op
 * there; the fields are populated only by the limit-order build.
 *
 * THE WINDOW (identical thesis to whirlpool): prepare walks the tick arrays
 * OFF-CHAIN and ships up to RAYDIUM_CLMM_MAX_BOUNDARIES initialized-tick
 * boundaries per direction — each (arrayIndex, offset, biased tick, sqrt
 * price) — plus the swap-sequence EDGE. Everything value-bearing stays live:
 * the fragment re-reads sqrt_price_x64 / tick_current / liquidity from the
 * pool, trade_fee_rate from the AmmConfig, and each shipped boundary's
 * liquidity_gross (initialized check) + liquidity_net i128 from its tick array
 * at cook time. Shipped parts are drift-invariant by construction (a
 * TickArrayState PDA encodes (pool, start_tick_index), so a shipped offset's
 * tick can never change, and sqrt_price_from_tick is a pure function of the
 * tick). Drift semantics match whirlpool (see ./ladder.ts).
 *
 * Gates (named errors, everything else is a live read):
 * - account size / discriminator;
 * - `fee_on != 0` (Token0Only/Token1Only fee routing) — the ladder walks the
 *   classic fee-on-input path only;
 * - a nonzero `dynamic_fee_info` — a dynamic-fee pool walks tick-spacing-
 *   bounded steps with a per-step volatility fee the fragment does not model
 *   (the SwapState path where `get_dynamic_fee_info()` is Some); classic pools
 *   (all-zero dynamic_fee_info) jump straight to the next initialized tick;
 * - active limit orders on any scanned window tick (orders_amount /
 *   part_filled_orders_remaining nonzero) — upstream matches them at the
 *   boundary UNCONDITIONALLY and the ladder does not model order matching
 *   (conservative drop; a no-op on the classic order-free build);
 * - the swap-disabled status bit;
 * - non-classic-SPL mints (the quote reads vault-independent tick liquidity,
 *   but a transfer-fee mint would break the realized-delta bound);
 * - a direction with NO shipped boundaries and no edge (gated by the recipe
 *   orchestrator via windowFor).
 *
 * NOTE — RELOCATED LADDER. This venue's merge-decomposition ladder used to sit
 * next to this file as `./ladder.ts`; it now lives in the consuming recipes
 * package, which defines every `*Ladder`, window selector and rung-feeding
 * decomposition helper itself. The SDK keeps only the generic venue
 * integration below (pool-account decode, program ids, pool-config types, and
 * the AMM/tick math the decode needs). Every `ladder.ts` reference in the text
 * above therefore points at that relocated module, not at a file in this
 * directory.
 *
 * Original venue investigation (historical):
 * https://github.com/eco-incorp/sauce/blob/d3686430ee308994f95309a8c9b2d5930d71cf5d/docs/svm-venues.md
 */
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import { readUintLE } from "../math.js";
import { accountDataLoader } from "../../loader.js";
import type { AccountLoader, OwnedAccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import { MAX_TICK, MIN_TICK, raydiumSqrtPriceAtTick } from "./tick-math.js";

const SLUG = "raydium-clmm";

export const RAYDIUM_CLMM_PROGRAM_ID = address("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const POOL_ACCOUNT_SIZE = 1544;
export const AMM_CONFIG_ACCOUNT_SIZE = 117;
export const TICK_ARRAY_ACCOUNT_SIZE = 10240;
/** sha256('account:PoolState')[0..8] (shared with raydium-cp — size+owner discriminate). */
export const POOL_DISCRIMINATOR = [0xf7, 0xed, 0xe3, 0xf5, 0xd7, 0xc3, 0xde, 0x46];
/** sha256('account:AmmConfig')[0..8]. */
export const AMM_CONFIG_DISCRIMINATOR = [0xda, 0xf4, 0x21, 0x68, 0xcb, 0xcb, 0x2b, 0x6f];
/** sha256('account:TickArrayState')[0..8]. */
export const TICK_ARRAY_DISCRIMINATOR = [0xc0, 0x9b, 0x55, 0xcd, 0x31, 0xf9, 0x81, 0x2a];

export const TICK_ARRAY_SIZE = 60;
export { MAX_TICK, MIN_TICK };

/**
 * Shipped initialized-tick boundaries per direction (matches whirlpool: each
 * crossed boundary is a walk step ~tens of k CU on the interpreter). Moves in
 * lockstep with the fragment's unrolled setup (ladder.ts) and the mirror.
 */
export const RAYDIUM_CLMM_MAX_BOUNDARIES = 4;

// PoolState offsets (ABSOLUTE = struct offset + 8 anchor disc; repr(C, packed)).
export const OFF_AMM_CONFIG = 9;
export const OFF_TOKEN_MINT_0 = 73;
export const OFF_TOKEN_MINT_1 = 105;
export const OFF_TOKEN_VAULT_0 = 137;
export const OFF_TOKEN_VAULT_1 = 169;
export const OFF_OBSERVATION_KEY = 201;
export const OFF_TICK_SPACING = 235;
export const OFF_LIQUIDITY = 237;
export const OFF_SQRT_PRICE = 253;
export const OFF_TICK_CURRENT = 269;
export const OFF_STATUS = 389;
export const OFF_FEE_ON = 390;
export const OFF_OPEN_TIME = 1080;
export const OFF_DYNAMIC_FEE_INFO = 1096;
export const DYNAMIC_FEE_INFO_LEN = 80;
/** AmmConfig: trade_fee_rate u32 @47 (hundredths of a bip, denominator 1e6). */
export const OFF_CFG_TRADE_FEE_RATE = 47;

// TickArrayState offsets: pool_id @8, start_tick_index i32 @40, ticks[60] @44
// (168 bytes each: tick i32 @+0, liquidity_net i128 @+4, liquidity_gross u128 @+20).
export const OFF_TA_POOL = 8;
export const OFF_TA_START = 40;
export const OFF_TA_TICKS = 44;
export const TICK_LEN = 168;
export const OFF_TICK_LIQ_NET = 4;
export const OFF_TICK_LIQ_GROSS = 20;
// Limit-order fields (cell-relative). orders_amount u64 @124, part_filled_orders_remaining
// u64 @132 — after reward_growths_outside_x64[3] (ends @116) and order_phase u64 (@116).
// On the classic order-free build these two u64s fall inside the never-written padding[13]
// region (also @116..168) and read as zero, so the limit-order gate is a no-op there.
export const OFF_TICK_ORDERS_AMOUNT = 124;
export const OFF_TICK_PART_FILLED_ORDERS = 132;

/** Swap-disabled status bit (PoolStatusBitIndex::Swap = 4). */
const STATUS_SWAP_BIT = 4;

export interface RaydiumClmmBoundary {
  /** Index into the window's tickArrays (0..2). */
  arrayIndex: number;
  /** Tick offset within that array (0..59) — the live liquidity_gross/net cell. */
  offset: number;
  /** UNBIASED tick index (= start + offset * spacing, PDA-pinned). */
  tick: number;
  /** raydiumSqrtPriceAtTick(tick) — pure function of the tick. */
  sqrtPrice: bigint;
}

export interface RaydiumClmmWindow {
  /** The three swap-sequence tick array PDAs, nearest first (walk order). */
  tickArrays: [Address, Address, Address];
  /** start_tick_index encoded in each PDA (walk order). */
  startTicks: [number, number, number];
  /** Initialized-tick boundaries in walk order (<= RAYDIUM_CLMM_MAX_BOUNDARIES). */
  boundaries: RaydiumClmmBoundary[];
  /**
   * The swap-sequence bound of the readable window — null when the boundary
   * scan stopped at RAYDIUM_CLMM_MAX_BOUNDARIES (deeper ticks the model does
   * not carry, so the walk must not step past the last shipped boundary).
   */
  edge: { tick: number; sqrtPrice: bigint } | null;
  /** Contiguous prefix of tickArrays that existed as TickArrayState at prepare. */
  readable: number;
}

export interface RaydiumClmmPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  /** Trade direction: '0to1' (default) sells token_0 for token_1 (zero_for_one, price down). */
  direction: "0to1" | "1to0";
  ammConfig: Address;
  tokenMint0: Address;
  tokenMint1: Address;
  tokenVault0: Address;
  tokenVault1: Address;
  observation: Address;
  /** ['pool_tick_array_bitmap_extension', pool] — required by the swap when the walk leaves the default bitmap. */
  bitmapExtension: Address;
  tickSpacing: number;
  /** Snapshot at fetch time (the fragment re-reads it live from the AmmConfig). */
  tradeFeeRate: number;
  /** Snapshots at fetch time (the fragment re-reads them live from the pool). */
  liquidity: bigint;
  sqrtPrice: bigint;
  tickCurrentIndex: number;
  /** Direction-keyed prepare-declared windows (see the header). */
  windows: { "0to1": RaydiumClmmWindow; "1to0": RaydiumClmmWindow };
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
  const be = new Uint8Array(4);
  new DataView(be.buffer).setInt32(0, startTick, false); // start_tick_index.to_be_bytes()
  return memoizedGetProgramDerivedAddress(RAYDIUM_CLMM_PROGRAM_ID, [
    new TextEncoder().encode("tick_array"),
    getAddressEncoded(pool),
    be,
  ]);
}

/** floor division toward negative infinity (TickArrayState::get_array_start_index). */
export function arrayStartIndex(tickIndex: number, tickSpacing: number): number {
  const n = TICK_ARRAY_SIZE * tickSpacing;
  let start = Math.trunc(tickIndex / n);
  if (tickIndex < 0 && tickIndex % n !== 0) start -= 1;
  return start * n;
}

/**
 * The three swap-sequence array starts for a direction: the array containing
 * the live tick, then two more in the walk direction (down for zero_for_one).
 * Raydium's first swap array is always the live-tick array (no whirlpool-style
 * shifted-window rule — next_initialized_tick searches within it first).
 */
export function windowStartTicks(
  tickCurrentIndex: number,
  tickSpacing: number,
  zeroForOne: boolean,
): [number, number, number] {
  const span = TICK_ARRAY_SIZE * tickSpacing;
  const base = arrayStartIndex(tickCurrentIndex, tickSpacing);
  return zeroForOne ? [base, base - span, base - 2 * span] : [base, base + span, base + 2 * span];
}

/** Whether a tick cell (at OFF_TA_TICKS + offset*TICK_LEN) is initialized (liquidity_gross != 0). */
function tickInitialized(array: Uint8Array, offset: number): boolean {
  return readUintLE(array, OFF_TA_TICKS + offset * TICK_LEN + OFF_TICK_LIQ_GROSS, 16) !== 0n;
}

/**
 * Whether a tick cell carries ACTIVE limit orders — upstream's
 * TickState::has_limit_orders() = orders_amount > 0 || part_filled_orders_remaining > 0.
 * Upstream treats such a tick as initialized and matches its orders UNCONDITIONALLY when
 * the swap reaches the boundary (even with liquidity_gross == 0, so this is checked
 * independently of tickInitialized). The ladder models only liquidity crossings, so a
 * window tick with live orders is gated. No-op on the classic order-free build (padding).
 */
function tickHasLimitOrders(array: Uint8Array, offset: number): boolean {
  const base = OFF_TA_TICKS + offset * TICK_LEN;
  return (
    readUintLE(array, base + OFF_TICK_ORDERS_AMOUNT, 8) !== 0n ||
    readUintLE(array, base + OFF_TICK_PART_FILLED_ORDERS, 8) !== 0n
  );
}

/**
 * Scan the readable window for initialized-tick boundaries in walk order —
 * next_initialized_tick semantics: zero_for_one searches DOWN from the live
 * tick's offset INCLUSIVE, one_for_zero searches UP exclusive; later arrays
 * search their full span. The edge is shipped only when the scan exhausted the
 * readable window (see RaydiumClmmWindow.edge).
 */
async function resolveWindow(
  load: AccountLoader,
  pool: Address,
  tickCurrentIndex: number,
  tickSpacing: number,
  zeroForOne: boolean,
): Promise<RaydiumClmmWindow> {
  const startTicks = windowStartTicks(tickCurrentIndex, tickSpacing, zeroForOne);
  const tickArrays = (await Promise.all(
    startTicks.map((start) => deriveTickArrayPda(pool, start)),
  )) as [Address, Address, Address];

  // Read the whole window in ONE batched round instead of an outward serial
  // walk: the tick-array PDAs are all derived above (from the live tick +
  // spacing), so nothing here depends on a prior array's bytes. Registering
  // every load() synchronously lets the coalescing loader fold them into a
  // single getMultipleAccounts, collapsing ~3 dependency rounds to 1.
  // allSettled (not all) keeps the break-on-first-invalid contract exact: a
  // load that REJECTS is re-thrown only when the readable prefix actually
  // reaches it (matching the old serial await), while a rejection/miss PAST
  // the break — an array the serial walk never read — is never inspected, so
  // a missing tail array degrades to the identical readable prefix.
  const loaded = await Promise.allSettled(tickArrays.map((addr) => load(addr)));
  const arrays: (Uint8Array | null)[] = [];
  let readable = 0;
  for (let i = 0; i < 3; i++) {
    const settled = loaded[i];
    if (settled.status === "rejected") throw settled.reason;
    const data = settled.value;
    const valid =
      data !== null &&
      data.length >= TICK_ARRAY_ACCOUNT_SIZE &&
      hasDiscriminator(data, TICK_ARRAY_DISCRIMINATOR) &&
      readI32(data, OFF_TA_START) === startTicks[i];
    if (!valid) break;
    arrays.push(data);
    readable += 1;
  }

  const boundaries: RaydiumClmmBoundary[] = [];
  let maxStopped = false;
  for (let a = 0; a < readable && !maxStopped; a++) {
    const data = arrays[a]!;
    const start = startTicks[a];
    let offset: number;
    if (a === 0) {
      const raw = Math.floor((tickCurrentIndex - start) / tickSpacing);
      offset = zeroForOne ? raw : raw + 1;
    } else {
      offset = zeroForOne ? TICK_ARRAY_SIZE - 1 : 0;
    }
    if (!zeroForOne && offset < 0) offset = 0;
    while (offset >= 0 && offset < TICK_ARRAY_SIZE) {
      if (tickHasLimitOrders(data, offset)) {
        // Upstream matches this boundary tick's limit orders unconditionally; the ladder
        // does not model order matching, so drop the pool (conservative — real out would
        // only exceed the modeled out). Rejection routes through the orchestrator's
        // per-venue self-drop, exactly like the other named gates.
        throw new Error(
          `${SLUG}: pool ${pool} has active limit orders at tick ${start + offset * tickSpacing} ` +
            "— the ladder does not model limit-order matching",
        );
      }
      if (tickInitialized(data, offset)) {
        const tick = start + offset * tickSpacing;
        boundaries.push({ arrayIndex: a, offset, tick, sqrtPrice: raydiumSqrtPriceAtTick(tick) });
        if (boundaries.length === RAYDIUM_CLMM_MAX_BOUNDARIES) {
          maxStopped = true;
          break;
        }
      }
      offset += zeroForOne ? -1 : 1;
    }
  }

  let edge: RaydiumClmmWindow["edge"] = null;
  if (readable > 0 && !maxStopped) {
    const lastStart = startTicks[readable - 1];
    let tick: number;
    if (zeroForOne) {
      tick = Math.max(lastStart, MIN_TICK);
    } else {
      tick = lastStart + TICK_ARRAY_SIZE * tickSpacing - 1;
      if (lastStart + TICK_ARRAY_SIZE * tickSpacing > MAX_TICK) tick = MAX_TICK;
    }
    edge = { tick, sqrtPrice: raydiumSqrtPriceAtTick(tick) };
  }

  return { tickArrays, startTicks, boundaries, edge, readable };
}

/**
 * Fetch + gate one Raydium CLMM pool (see the header for the gate list) and
 * freeze both directions' boundary windows. Read-only against the loader.
 */
export async function fetchRaydiumClmmConfig(
  owned: OwnedAccountLoader,
  pool: Address,
): Promise<RaydiumClmmPoolConfig> {
  const load = accountDataLoader(owned);
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool account ${pool} not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG}: pool ${pool} has ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`,
    );
  }
  if (!hasDiscriminator(data, POOL_DISCRIMINATOR)) {
    throw new Error(`${SLUG}: pool ${pool} has a foreign discriminator (not a PoolState account)`);
  }

  const status = data[OFF_STATUS];
  if ((status & (1 << STATUS_SWAP_BIT)) !== 0) {
    throw new Error(`${SLUG}: pool ${pool} has swaps disabled (status bit ${STATUS_SWAP_BIT})`);
  }
  const feeOn = data[OFF_FEE_ON];
  if (feeOn !== 0) {
    throw new Error(
      `${SLUG}: pool ${pool} uses fee_on ${feeOn} (Token0Only/Token1Only) — the ladder walks the fee-on-input path only`,
    );
  }
  for (let i = 0; i < DYNAMIC_FEE_INFO_LEN; i++) {
    if (data[OFF_DYNAMIC_FEE_INFO + i] !== 0) {
      throw new Error(
        `${SLUG}: pool ${pool} has a dynamic fee configured — its swap walks tick-spacing-bounded steps with a per-step ` +
          "volatility fee the in-VM quote does not model",
      );
    }
  }

  const codec = getAddressCodec();
  const ammConfig = codec.decode(data.subarray(OFF_AMM_CONFIG, OFF_AMM_CONFIG + 32));
  const tokenMint0 = codec.decode(data.subarray(OFF_TOKEN_MINT_0, OFF_TOKEN_MINT_0 + 32));
  const tokenMint1 = codec.decode(data.subarray(OFF_TOKEN_MINT_1, OFF_TOKEN_MINT_1 + 32));
  // The on-chain swap ix here is legacy-SPL only; detect a Token-2022 mint (or
  // one carrying an un-routable extension) by its OWNER (an extensionless
  // Token-2022 mint is byte-identical to a legacy one) and SELF-DROP the pool.
  // The thrown error is the graceful-drop signal — the SvmRoute orchestrator
  // catches a fetchPoolConfig throw and drops the venue. The LEGACY path stays
  // byte-identical: a Tokenkeg-owned mint parses no extensions, and the config
  // is built unchanged. An unreadable mint falls back to the legacy assumption
  // (keeps fixtures green).
  for (const mint of [tokenMint0, tokenMint1]) {
    const mintAccount = await owned(mint);
    if (mintAccount === null) continue;
    if (classifyMintProgram(mint, mintAccount.data, mintAccount.owner) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(
        `${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`,
      );
    }
    const { blocking } = parseMintExtensions(mintAccount.data);
    if (blocking.length > 0) {
      throw new Error(
        `${SLUG}: dropping pool ${pool} — mint ${mint} is un-routable: ${blocking.join("; ")}`,
      );
    }
  }

  const cfgData = await load(ammConfig);
  if (cfgData === null)
    throw new Error(`${SLUG}: AmmConfig ${ammConfig} of pool ${pool} not found`);
  if (
    cfgData.length !== AMM_CONFIG_ACCOUNT_SIZE ||
    !hasDiscriminator(cfgData, AMM_CONFIG_DISCRIMINATOR)
  ) {
    throw new Error(
      `${SLUG}: AmmConfig ${ammConfig} of pool ${pool} has an unexpected size/discriminator`,
    );
  }

  const tickSpacing = Number(readUintLE(data, OFF_TICK_SPACING, 2));
  const tickCurrentIndex = readI32(data, OFF_TICK_CURRENT);
  const [zeroForOne, oneForZero, bitmapExtension] = await Promise.all([
    resolveWindow(load, pool, tickCurrentIndex, tickSpacing, true),
    resolveWindow(load, pool, tickCurrentIndex, tickSpacing, false),
    memoizedGetProgramDerivedAddress(RAYDIUM_CLMM_PROGRAM_ID, [
      new TextEncoder().encode("pool_tick_array_bitmap_extension"),
      getAddressEncoded(pool),
    ]),
  ]);

  return {
    venue: SLUG,
    pool,
    direction: "0to1",
    ammConfig,
    tokenMint0,
    tokenMint1,
    tokenVault0: codec.decode(data.subarray(OFF_TOKEN_VAULT_0, OFF_TOKEN_VAULT_0 + 32)),
    tokenVault1: codec.decode(data.subarray(OFF_TOKEN_VAULT_1, OFF_TOKEN_VAULT_1 + 32)),
    observation: codec.decode(data.subarray(OFF_OBSERVATION_KEY, OFF_OBSERVATION_KEY + 32)),
    bitmapExtension,
    tickSpacing,
    tradeFeeRate: Number(readUintLE(cfgData, OFF_CFG_TRADE_FEE_RATE, 4)),
    liquidity: readUintLE(data, OFF_LIQUIDITY, 16),
    sqrtPrice: readUintLE(data, OFF_SQRT_PRICE, 16),
    tickCurrentIndex,
    windows: { "0to1": zeroForOne, "1to0": oneForZero },
  };
}

/** The Raydium CLMM venue: a concentrated-liquidity AMM. */
export const raydiumClmm = {
  slug: SLUG,
  programId: RAYDIUM_CLMM_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  token2022Program: TOKEN_2022_PROGRAM,
  memoProgram: MEMO_PROGRAM,
  fetchPoolConfig: fetchRaydiumClmmConfig,
};
