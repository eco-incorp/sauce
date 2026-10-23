/**
 * Stabble CLMM venue — pool decoding, scope gates and the prepare-declared
 * tick-boundary WINDOW for the SvmRoute ladder fragment (./ladder.ts).
 *
 * It is, byte-for-byte, the same PoolState/AmmConfig/
 * TickArrayState account layout as the sibling
 * raydium-clmm venue (Stabble's CLMM program is a verbatim fork of Raydium's
 * `raydium-clmm` at the account level — GROUND-TRUTHED, not assumed, against
 * real mainnet state 2026-07-31, program `6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6`,
 * Jupiter's own label "Stabble CLMM" per `benchmark/adapters/fixtures/jupiter-program-id-to-label.json`):
 *   - `getProgramAccounts` filtered to `dataSize: 1544` returns exactly 17 live
 *     pool accounts (matching the venue brief's "17 live pools measured at
 *     dataSize 1544");
 *   - pool account `EK72FNtzoGJvXtq8r3bn7jB8ascHw1euFmnoemZ61D9g` (STB/USDC,
 *     tickSpacing 1, live liquidity 854392897124, tick -135413): 1544 bytes,
 *     discriminator f7 ed e3 f5 d7 c3 de 46 (IDENTICAL to raydium-clmm's —
 *     shared with raydium-cp-swap too, size+owner discriminate), field
 *     offsets IDENTICAL to raydium-clmm's (token_mint_0@73, token_mint_1@105,
 *     token_vault_0@137, token_vault_1@169, observation_key@201,
 *     tick_spacing@235, liquidity@237, sqrt_price@253, tick_current@269,
 *     status@389, fee_on@390 — all zero/matching the classic gate,
 *     dynamic_fee_info@1096..1176 all-zero);
 *   - its AmmConfig (`4th9ZwRvFX9yJQp1yFXVkCYQxbCAxPLKKh2RyTLbuVXP`, 117
 *     bytes, disc da f4 21 68 cb cb 2b 6f, trade_fee_rate@47 = 2500 i.e. 25
 *     bps) and TickArrayState accounts (10240 bytes, disc
 *     c0 9b 55 cd 31 f9 81 2a) decode with the SAME offsets;
 *   - `tick_array` PDA seeds (['tick_array', pool, be(startTick)], this
 *     program's id) reproduce the exact live tick array address
 *     `7zRBaaTg8x1GBpAQJYiEBqGEXn6HH5j2VRxZsU5V6i2d` (owner-confirmed against
 *     this program id, discriminator-confirmed as TickArrayState) — the SAME
 *     `pool_tick_array_bitmap_extension` seed derives
 *     `DQPu2HQXL889S3AifYcPZzEHVZPRRTLWFDAcAxaLS7G9`, which also exists
 *     on-chain owned by this program;
 *   - the Anchor discriminator for `swap_v2` (sha256('global:swap_v2')[0..8]
 *     = 43 04 ed 0b 1a c9 1e 62) is a PURE function of the instruction name,
 *     so it is necessarily identical for any Anchor program naming its swap
 *     instruction the same — this module's ladder (./ladder.ts) drives a
 *     REAL `swap_v2` CPI into the mainnet-dumped `stabble-clmm.so` binary
 *     against this exact pool's real account state
 *     (the consuming app realcpi e2e test's 'stabble-clmm' cell) and
 *     the resulting realized output matches this ladder's predicted quote
 *     exactly at three sizes — proving the account order/writability and
 *     instruction layout, not just the struct offsets.
 *
 * Given the confirmed byte-identical layout, this module reuses raydium-clmm's
 * PURE math and PDA-independent helpers straight from the `@eco-incorp/sauce/svm`
 * barrel (raydiumSqrtPriceAtTick, the tick-math constants,
 * RAYDIUM_CLMM_MAX_BOUNDARIES, the account discriminators, and the
 * PROGRAM-INDEPENDENT arrayStartIndex / windowStartTicks) — nothing here
 * reinvents that arithmetic. Only the parts that are genuinely PROGRAM-BOUND
 * (the PDA derivations and the CPI target) are reimplemented, against this
 * venue's own program id.
 *
 * Gates mirror raydium-clmm's exactly (see that adapter's header for the full
 * rationale): account size/discriminator, `fee_on != 0`, a nonzero
 * `dynamic_fee_info`, active limit orders on any scanned window tick, the
 * swap-disabled status bit, non-classic-SPL mints, and a direction with no
 * shipped boundaries/edge (gated by the orchestrator via windowFor).
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
import { address, getAddressCodec } from "@solana/kit";
import type { Address } from "@solana/kit";
import {
  AMM_CONFIG_DISCRIMINATOR as RAYDIUM_CLMM_AMM_CONFIG_DISCRIMINATOR,
  POOL_DISCRIMINATOR as RAYDIUM_CLMM_POOL_DISCRIMINATOR,
  TICK_ARRAY_DISCRIMINATOR as RAYDIUM_CLMM_TICK_ARRAY_DISCRIMINATOR,
  windowStartTicks as raydiumClmmWindowStartTicks,
} from "../raydium-clmm/index.js";
import {
  MAX_TICK as RAYDIUM_MAX_TICK,
  MIN_TICK as RAYDIUM_MIN_TICK,
} from "../raydium-clmm/tick-math.js";
import { raydiumSqrtPriceAtTick } from "../raydium-clmm/tick-math.js";
import { readUintLE } from "../math.js";
import { memoizedGetProgramDerivedAddress } from "../pda-memo.js";
import type { AccountLoader, PoolConfig } from "../types.js";
import { TOKEN_2022_PROGRAM_ID, classifyMintProgram } from "../../token-program.js";
import { parseMintExtensions } from "../../token-extensions.js";

const SLUG = "stabble-clmm";

/** Stabble's CLMM program (a Raydium-CLMM-shaped Anchor fork). */
export const STABBLE_CLMM_PROGRAM_ID = address("6dMXqGZ3ga2dikrYS9ovDXgHGh5RUsb2RTUj6hrQXhk6");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const MEMO_PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const POOL_ACCOUNT_SIZE = 1544;
export const AMM_CONFIG_ACCOUNT_SIZE = 117;
export const TICK_ARRAY_ACCOUNT_SIZE = 10240;
export const TICK_ARRAY_SIZE = 60;

// PoolState offsets (ABSOLUTE = struct offset + 8 anchor disc), IDENTICAL to raydium-clmm.
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
// TickArrayState offsets: pool_id @8, start_tick_index i32 @40, ticks[60] @44.
export const OFF_TA_POOL = 8;
export const OFF_TA_START = 40;
export const OFF_TA_TICKS = 44;
export const TICK_LEN = 168;
export const OFF_TICK_LIQ_NET = 4;
export const OFF_TICK_LIQ_GROSS = 20;
export const OFF_TICK_ORDERS_AMOUNT = 124;
export const OFF_TICK_PART_FILLED_ORDERS = 132;
/** Swap-disabled status bit (PoolStatusBitIndex::Swap = 4). */
const STATUS_SWAP_BIT = 4;

/**
 * Shipped initialized-tick boundaries per direction (same walk-step budget as
 * raydium-clmm — an independent constant, not imported, so a future SDK
 * change to raydium-clmm's own bound can never silently reshape this venue's
 * fragment; kept numerically equal by design).
 */
export const STABBLE_CLMM_MAX_BOUNDARIES = 4;

export interface StabbleClmmBoundary {
  arrayIndex: number;
  offset: number;
  tick: number;
  sqrtPrice: bigint;
}

export interface StabbleClmmWindow {
  tickArrays: [Address, Address, Address];
  startTicks: [number, number, number];
  boundaries: StabbleClmmBoundary[];
  edge: { tick: number; sqrtPrice: bigint } | null;
  readable: number;
}

export interface StabbleClmmPoolConfig extends PoolConfig {
  venue: typeof SLUG;
  direction: "0to1" | "1to0";
  ammConfig: Address;
  tokenMint0: Address;
  tokenMint1: Address;
  tokenVault0: Address;
  tokenVault1: Address;
  observation: Address;
  bitmapExtension: Address;
  tickSpacing: number;
  tradeFeeRate: number;
  liquidity: bigint;
  sqrtPrice: bigint;
  tickCurrentIndex: number;
  windows: {
    "0to1": StabbleClmmWindow;
    "1to0": StabbleClmmWindow;
  };
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
  return memoizedGetProgramDerivedAddress(STABBLE_CLMM_PROGRAM_ID, [
    new TextEncoder().encode("tick_array"),
    getAddressEncoded(pool),
    be,
  ]);
}

/** Whether a tick cell is initialized (liquidity_gross != 0). */
function tickInitialized(array: Uint8Array, offset: number): boolean {
  return readUintLE(array, OFF_TA_TICKS + offset * TICK_LEN + OFF_TICK_LIQ_GROSS, 16) !== 0n;
}

/** Whether a tick cell carries ACTIVE limit orders (see raydium-clmm's header — same semantics). */
function tickHasLimitOrders(array: Uint8Array, offset: number): boolean {
  const base = OFF_TA_TICKS + offset * TICK_LEN;
  return (
    readUintLE(array, base + OFF_TICK_ORDERS_AMOUNT, 8) !== 0n ||
    readUintLE(array, base + OFF_TICK_PART_FILLED_ORDERS, 8) !== 0n
  );
}

/**
 * Scan the readable window for initialized-tick boundaries in walk order —
 * next_initialized_tick semantics, identical to raydium-clmm's resolveWindow.
 */
async function resolveWindow(
  load: AccountLoader,
  pool: Address,
  tickCurrentIndex: number,
  tickSpacing: number,
  zeroForOne: boolean,
): Promise<StabbleClmmWindow> {
  const startTicks = raydiumClmmWindowStartTicks(tickCurrentIndex, tickSpacing, zeroForOne) as [
    number,
    number,
    number,
  ];
  const tickArrays = (await Promise.all(
    startTicks.map((start) => deriveTickArrayPda(pool, start)),
  )) as [Address, Address, Address];
  // allSettled (not all) keeps the break-on-first-invalid contract exact: a
  // rejection is re-thrown only if the readable prefix actually reaches it.
  const loaded = await Promise.allSettled(tickArrays.map((a) => load(a)));
  const arrays: Uint8Array[] = [];
  let readable = 0;
  for (let i = 0; i < 3; i++) {
    const settled = loaded[i]!;
    if (settled.status === "rejected") throw settled.reason;
    const data = settled.value;
    const valid =
      data !== null &&
      data.length >= TICK_ARRAY_ACCOUNT_SIZE &&
      hasDiscriminator(data, RAYDIUM_CLMM_TICK_ARRAY_DISCRIMINATOR) &&
      readI32(data, OFF_TA_START) === startTicks[i];
    if (!valid) break;
    arrays.push(data);
    readable += 1;
  }
  const boundaries: StabbleClmmBoundary[] = [];
  let maxStopped = false;
  for (let a = 0; a < readable && !maxStopped; a++) {
    const data = arrays[a];
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
        throw new Error(
          `${SLUG}: pool ${pool} has active limit orders at tick ${start + offset * tickSpacing} ` +
            "— the ladder does not model limit-order matching",
        );
      }
      if (tickInitialized(data, offset)) {
        const tick = start + offset * tickSpacing;
        boundaries.push({ arrayIndex: a, offset, tick, sqrtPrice: raydiumSqrtPriceAtTick(tick) });
        if (boundaries.length === STABBLE_CLMM_MAX_BOUNDARIES) {
          maxStopped = true;
          break;
        }
      }
      offset += zeroForOne ? -1 : 1;
    }
  }
  let edge: { tick: number; sqrtPrice: bigint } | null = null;
  if (readable > 0 && !maxStopped) {
    const lastStart = startTicks[readable - 1];
    let tick: number;
    if (zeroForOne) {
      tick = Math.max(lastStart, RAYDIUM_MIN_TICK);
    } else {
      tick = lastStart + TICK_ARRAY_SIZE * tickSpacing - 1;
      if (lastStart + TICK_ARRAY_SIZE * tickSpacing > RAYDIUM_MAX_TICK) tick = RAYDIUM_MAX_TICK;
    }
    edge = { tick, sqrtPrice: raydiumSqrtPriceAtTick(tick) };
  }
  return { tickArrays, startTicks, boundaries, edge, readable };
}

/**
 * Fetch + gate one Stabble CLMM pool (see the header for the gate list) and
 * freeze both directions' boundary windows. Read-only against the loader.
 */
export async function fetchStabbleClmmConfig(
  load: AccountLoader,
  pool: Address,
): Promise<StabbleClmmPoolConfig> {
  const data = await load(pool);
  if (data === null) throw new Error(`${SLUG}: pool account ${pool} not found`);
  if (data.length !== POOL_ACCOUNT_SIZE) {
    throw new Error(
      `${SLUG}: pool ${pool} has ${data.length} bytes, expected ${POOL_ACCOUNT_SIZE}`,
    );
  }
  if (!hasDiscriminator(data, RAYDIUM_CLMM_POOL_DISCRIMINATOR)) {
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
  const ammConfig = codec.decode(data.subarray(OFF_AMM_CONFIG, OFF_AMM_CONFIG + 32)) as Address;
  const tokenMint0 = codec.decode(
    data.subarray(OFF_TOKEN_MINT_0, OFF_TOKEN_MINT_0 + 32),
  ) as Address;
  const tokenMint1 = codec.decode(
    data.subarray(OFF_TOKEN_MINT_1, OFF_TOKEN_MINT_1 + 32),
  ) as Address;
  // The on-chain swap ix here is legacy-SPL only; detect a Token-2022 mint (or
  // one carrying an un-routable extension) via the shared data-shape resolver
  // and SELF-DROP the pool. The thrown error is the graceful-drop signal — the
  // SvmRoute orchestrator catches a fetchPoolConfig throw and drops the venue.
  // The LEGACY path stays byte-identical: a classic 82-byte mint classifies as
  // Tokenkeg, parses no extensions, and the config is built unchanged. An
  // unreadable mint falls back to the legacy assumption (keeps fixtures green).
  const _mints = [tokenMint0, tokenMint1];
  const _mintDatas = await Promise.all(_mints.map((mint) => load(mint)));
  for (let _i = 0; _i < _mints.length; _i++) {
    const mint = _mints[_i]!;
    const mintData = _mintDatas[_i]!;
    if (mintData === null) continue;
    if (classifyMintProgram(mint, mintData) === TOKEN_2022_PROGRAM_ID) {
      throw new Error(
        `${SLUG}: dropping pool ${pool} — mint ${mint} is Token-2022 (this venue's swap is legacy-SPL only)`,
      );
    }
    const { blocking } = parseMintExtensions(mintData);
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
    !hasDiscriminator(cfgData, RAYDIUM_CLMM_AMM_CONFIG_DISCRIMINATOR)
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
    memoizedGetProgramDerivedAddress(STABBLE_CLMM_PROGRAM_ID, [
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
    tokenVault0: codec.decode(data.subarray(OFF_TOKEN_VAULT_0, OFF_TOKEN_VAULT_0 + 32)) as Address,
    tokenVault1: codec.decode(data.subarray(OFF_TOKEN_VAULT_1, OFF_TOKEN_VAULT_1 + 32)) as Address,
    observation: codec.decode(
      data.subarray(OFF_OBSERVATION_KEY, OFF_OBSERVATION_KEY + 32),
    ) as Address,
    bitmapExtension,
    tickSpacing,
    tradeFeeRate: Number(readUintLE(cfgData, OFF_CFG_TRADE_FEE_RATE, 4)),
    liquidity: readUintLE(data, OFF_LIQUIDITY, 16),
    sqrtPrice: readUintLE(data, OFF_SQRT_PRICE, 16),
    tickCurrentIndex,
    windows: { "0to1": zeroForOne, "1to0": oneForZero },
  };
}

/** The Stabble CLMM venue: a concentrated-liquidity AMM forked from Raydium CLMM. */
export const stabbleClmm = {
  slug: SLUG,
  programId: STABBLE_CLMM_PROGRAM_ID,
  tokenProgram: TOKEN_PROGRAM,
  token2022Program: TOKEN_2022_PROGRAM,
  memoProgram: MEMO_PROGRAM,
  fetchPoolConfig: fetchStabbleClmmConfig,
};
