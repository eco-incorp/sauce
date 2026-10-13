/**
 * A pool's SLOT: the nine accounts `@sauce/router`'s Solana swap at a price takes for one pool,
 * paying one of its two tokens — program, pool, config, its two vaults, one more account and three
 * tick arrays, in that order (`router.svm.js`'s header) — read from the pool's own state.
 *
 * The venues are the nine whose swap a price limit stops: Raydium CLMM, PancakeSwap CLMM, Byreal and
 * Stabble CLMM (one pool layout), Orca Whirlpools and Cropper (another), DefiTuna, Crema and
 * Phoenix's order book. What each slot holds, and why:
 *
 *   - A Raydium-layout pool's swap loads every account given as a tick array, so each must exist,
 *     and starts at the first holding liquidity in its direction: the arrays its bitmap (1,024 bits
 *     at 904, bit 512 the array starting at tick 0) marks, nearest its price that way in walk order,
 *     then the other way, then arrays near its price that exist with none.
 *   - A whirlpool's, DefiTuna's and Crema's tick arrays are the SDK venue adapters' windows for the
 *     direction; a whirlpool's `extra` is its oracle, Crema's its tick-array map.
 *   - A Phoenix market's slot is the same paying either token: its log authority as `config`, its
 *     base and quote vaults, and the System program in the four places it takes nothing.
 *
 * Shared by `sauce pools`, which lists each pool's slot both ways, and the venue namespaces, whose
 * slot accounts `svm/account-names.ts` derives as the cook is built (`slot:<pool>:<token>.<part>`).
 * Reads go through the loader the caller hands it; nothing here makes a request of its own.
 */
import { address, getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";

import {
  BYREAL_PROGRAM_ID,
  CREMA_PROGRAM_ID,
  CROPPER_PROGRAM_ID,
  DEFITUNA_PROGRAM_ID,
  fetchCremaPoolConfig,
  fetchCropperConfig,
  fetchDefiTunaPoolConfig,
  fetchOrcaWhirlpoolConfig,
  fetchPhoenixConfig,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PANCAKESWAP_CLMM_PROGRAM_ID,
  PHOENIX_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  STABBLE_CLMM_PROGRAM_ID,
} from "./venues/index.js";
import { memoizedGetProgramDerivedAddress } from "./venues/pda-memo.js";
import type { AccountLoader, OwnedAccountLoader } from "./venues/types.js";

const SYSTEM = address("11111111111111111111111111111111");

export type SvmPoolLayout = "raydium" | "whirlpool" | "defituna" | "crema" | "phoenix";

/** A venue whose swap a price limit stops: its name, program and pool layout. */
export interface SvmPriceLimitVenue {
  readonly name: string;
  readonly program: Address;
  readonly layout: SvmPoolLayout;
}

/** Every venue, in the order the skills name them. */
export const SVM_PRICE_LIMIT_VENUES: readonly SvmPriceLimitVenue[] = [
  { name: "Raydium CLMM", program: RAYDIUM_CLMM_PROGRAM_ID, layout: "raydium" },
  { name: "PancakeSwap CLMM", program: PANCAKESWAP_CLMM_PROGRAM_ID, layout: "raydium" },
  { name: "Byreal", program: BYREAL_PROGRAM_ID, layout: "raydium" },
  { name: "Stabble CLMM", program: STABBLE_CLMM_PROGRAM_ID, layout: "raydium" },
  { name: "Orca Whirlpools", program: ORCA_WHIRLPOOL_PROGRAM_ID, layout: "whirlpool" },
  { name: "Cropper", program: CROPPER_PROGRAM_ID, layout: "whirlpool" },
  { name: "DefiTuna", program: DEFITUNA_PROGRAM_ID, layout: "defituna" },
  { name: "Crema", program: CREMA_PROGRAM_ID, layout: "crema" },
  { name: "Phoenix", program: PHOENIX_PROGRAM_ID, layout: "phoenix" },
];

/** Where a concentrated-liquidity layout keeps the pair (lower key first), its liquidity, price and tick. */
export const SVM_CLMM_LAYOUT: Readonly<
  Record<
    Exclude<SvmPoolLayout, "phoenix">,
    {
      readonly size: number;
      readonly mintA: number;
      readonly mintB: number;
      readonly liquidity: number;
      readonly price: number;
      readonly tick: number;
    }
  >
> = {
  raydium: { size: 1544, mintA: 73, mintB: 105, liquidity: 237, price: 253, tick: 269 },
  whirlpool: { size: 653, mintA: 101, mintB: 181, liquidity: 49, price: 65, tick: 81 },
  defituna: { size: 423, mintA: 11, mintB: 43, liquidity: 151, price: 167, tick: 183 },
  crema: { size: 748, mintA: 40, mintB: 72, liquidity: 174, price: 190, tick: 206 },
};

/** Where a Phoenix market keeps its base mint and its quote mint. */
export const PHOENIX_BASE_MINT_AT = 48;
export const PHOENIX_QUOTE_MINT_AT = 128;

/** A slot's nine accounts, in the program's order. */
export interface SvmSlot {
  readonly program: Address;
  readonly pool: Address;
  readonly config: Address;
  readonly vaultA: Address;
  readonly vaultB: Address;
  readonly extra: Address;
  readonly ticks: readonly [Address, Address, Address];
}

/** The slot's accounts as a list, in the order `@sauce/router`'s swap takes them. */
export const svmSlotAccounts = (slot: SvmSlot): readonly Address[] => [
  slot.program,
  slot.pool,
  slot.config,
  slot.vaultA,
  slot.vaultB,
  slot.extra,
  ...slot.ticks,
];

/** The names of a slot's nine accounts, in that order. */
export const SVM_SLOT_PARTS = [
  "program",
  "pool",
  "config",
  "vaultA",
  "vaultB",
  "extra",
  "ticks0",
  "ticks1",
  "ticks2",
] as const;
export type SvmSlotPart = (typeof SVM_SLOT_PARTS)[number];

const le = (data: Uint8Array, offset: number, length: number): bigint => {
  let value = 0n;
  for (let i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]!);
  return value;
};
const i32 = (data: Uint8Array, offset: number): number => {
  const raw = Number(le(data, offset, 4));
  return raw >= 0x8000_0000 ? raw - 0x1_0000_0000 : raw;
};
const keyAt = (data: Uint8Array, offset: number): Address =>
  getAddressDecoder().decode(data.subarray(offset, offset + 32));

/**
 * The nine accounts a concentrated-liquidity pool's slot takes, paying its lower-key token or not.
 * `data` is the pool's own account.
 */
export async function svmClmmSlot(
  venue: SvmPriceLimitVenue,
  pool: Address,
  data: Uint8Array,
  paysLower: boolean,
  load: AccountLoader,
): Promise<SvmSlot> {
  const program = venue.program;
  if (venue.layout === "raydium") {
    return {
      program,
      pool,
      config: keyAt(data, 9),
      vaultA: keyAt(data, 137),
      vaultB: keyAt(data, 169),
      extra: keyAt(data, 201),
      ticks: await raydiumTickArrays(program, pool, data, paysLower, load),
    };
  }
  const window = (windows: { aToB: { tickArrays: Address[] }; bToA: { tickArrays: Address[] } }) =>
    (paysLower ? windows.aToB : windows.bToA).tickArrays as unknown as [Address, Address, Address];
  if (venue.layout === "whirlpool") {
    const cfg =
      program === CROPPER_PROGRAM_ID
        ? await fetchCropperConfig(load, pool)
        : await fetchOrcaWhirlpoolConfig(load, pool);
    return {
      program,
      pool,
      config: SYSTEM,
      vaultA: keyAt(data, 133),
      vaultB: keyAt(data, 213),
      extra: cfg.oracle,
      ticks: window(cfg.windows),
    };
  }
  if (venue.layout === "defituna") {
    const cfg = await fetchDefiTunaPoolConfig(load, pool);
    return {
      program,
      pool,
      config: SYSTEM,
      vaultA: keyAt(data, 75),
      vaultB: keyAt(data, 107),
      extra: SYSTEM,
      ticks: window(cfg.windows),
    };
  }
  if (venue.layout === "crema") {
    const cfg = await fetchCremaPoolConfig(load, pool);
    return {
      program,
      pool,
      config: cfg.clmmConfig,
      vaultA: cfg.tokenVaultA,
      vaultB: cfg.tokenVaultB,
      extra: cfg.tickArrayMap,
      ticks: window(cfg.windows),
    };
  }
  throw new Error(`${venue.name} is not a concentrated-liquidity venue`);
}

/**
 * A Raydium-layout pool's three tick arrays in its direction: the marked ones nearest its price that
 * way in walk order, then the other way, then the nearest that exist with no liquidity. An array is
 * the program address of `["tick_array", pool, start]`, `start` a big-endian i32.
 */
async function raydiumTickArrays(
  program: Address,
  pool: Address,
  data: Uint8Array,
  down: boolean,
  load: AccountLoader,
): Promise<[Address, Address, Address]> {
  const span = 60 * Number(le(data, 235, 2));
  const current = Math.floor(i32(data, 269) / span) * span;
  const bitmap = data.subarray(904, 904 + 128);
  const marked = (start: number) => {
    const bit = start / span + 512;
    return bit >= 0 && bit < 1024 && ((bitmap[bit >> 3]! >> (bit & 7)) & 1) === 1;
  };
  const step = down ? -span : span;
  const starts: number[] = [];
  for (
    let start = current;
    starts.length < 3 && Math.abs(start - current) <= 512 * span;
    start += step
  )
    if (marked(start)) starts.push(start);
  for (
    let start = current - step;
    starts.length < 3 && Math.abs(start - current) <= 512 * span;
    start -= step
  )
    if (marked(start)) starts.push(start);
  const at = (start: number) => {
    const seed = new Uint8Array(4);
    new DataView(seed.buffer).setInt32(0, start, false);
    return memoizedGetProgramDerivedAddress(program, [
      new TextEncoder().encode("tick_array"),
      new Uint8Array(getAddressEncoder().encode(pool)),
      seed,
    ]);
  };
  const chosen = await Promise.all(starts.map(at));
  // Fewer than three with liquidity: the nearest that exist with none.
  for (let distance = 0; chosen.length < 3 && distance <= 8; distance++) {
    for (const start of distance === 0
      ? [current]
      : [current + distance * span, current - distance * span]) {
      if (chosen.length >= 3 || starts.includes(start)) continue;
      const key = await at(start);
      if ((await load(key)) !== null) {
        starts.push(start);
        chosen.push(key);
      }
    }
  }
  if (chosen.length < 3) {
    throw new Error(`it has ${chosen.length} tick arrays near its price, and its swap takes three`);
  }
  return chosen as [Address, Address, Address];
}

/** A Phoenix market's slot, the same paying either token. */
export async function svmPhoenixSlot(market: Address, load: AccountLoader): Promise<SvmSlot> {
  const cfg = await fetchPhoenixConfig(load, market);
  const log = await memoizedGetProgramDerivedAddress(PHOENIX_PROGRAM_ID, [
    new TextEncoder().encode("log"),
  ]);

  return {
    program: PHOENIX_PROGRAM_ID,
    pool: market,
    config: log,
    vaultA: cfg.baseVault,
    vaultB: cfg.quoteVault,
    extra: SYSTEM,
    ticks: [SYSTEM, SYSTEM, SYSTEM],
  };
}

/**
 * The slot of `pool` paying `pay`, read through `load`: its venue from the pool's owner, its pair
 * from its own bytes, which must hold `pay`. Throws for a pool no price-limit venue owns, one whose
 * pair does not hold `pay`, and one whose slot cannot be read (a Raydium-layout pool with fewer
 * than three tick arrays near its price).
 */
export async function svmPoolSlot(
  load: OwnedAccountLoader,
  pool: Address,
  pay: Address,
): Promise<SvmSlot> {
  const account = await load(pool);
  if (account === null) throw new Error(`pool ${pool} has no account`);
  const venue = SVM_PRICE_LIMIT_VENUES.find((one) => one.program === account.owner);
  if (venue === undefined) {
    throw new Error(
      `${pool} is owned by ${account.owner}, which is not a venue whose swap stops at a price ` +
        `limit (${SVM_PRICE_LIMIT_VENUES.map((one) => one.name).join(", ")})`,
    );
  }
  const data = account.data;
  const loadData: AccountLoader = async (key) => (await load(key))?.data ?? null;
  if (venue.layout === "phoenix") {
    const base = keyAt(data, PHOENIX_BASE_MINT_AT);
    const quote = keyAt(data, PHOENIX_QUOTE_MINT_AT);
    if (pay !== base && pay !== quote) {
      throw new Error(`${venue.name} market ${pool} trades ${base} for ${quote}, not ${pay}`);
    }
    return svmPhoenixSlot(pool, loadData);
  }
  const layout = SVM_CLMM_LAYOUT[venue.layout];
  if (data.length !== layout.size) {
    throw new Error(`${pool} is ${data.length} bytes, not a ${venue.name} pool's ${layout.size}`);
  }
  const lower = keyAt(data, layout.mintA);
  const higher = keyAt(data, layout.mintB);
  if (pay !== lower && pay !== higher) {
    throw new Error(`${venue.name} pool ${pool} trades ${lower} and ${higher}, not ${pay}`);
  }

  return svmClmmSlot(venue, pool, data, pay === lower, loadData);
}
