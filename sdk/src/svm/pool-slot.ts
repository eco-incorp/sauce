/**
 * A pool's SLOT: the nine accounts `@sauce/router`'s Solana swap at a price takes for one pool,
 * paying one of its two tokens — program, pool, config, its two vaults, one more account and three
 * tick arrays, in that order (`router.svm.js`'s header) — read from the pool's own state.
 *
 * The venues are the nine whose swap a price limit stops: Raydium CLMM, PancakeSwap CLMM, Byreal and
 * Stabble CLMM (one pool layout), Orca Whirlpools and Cropper (another), DefiTuna, Crema and
 * Phoenix's order book; and Meteora DLMM, whose swap is an exact input. What each slot holds, and
 * why:
 *
 *   - A Raydium-layout pool's swap loads every account given as a tick array, so each must exist,
 *     and starts at the first holding liquidity in its direction: the arrays its bitmap (1,024 bits
 *     at 904, bit 512 the array starting at tick 0) marks, nearest its price that way in walk order,
 *     then the other way, then arrays near its price that exist with none. A pool priced past its
 *     own bitmap's reach takes its bitmap extension among them, in the first place.
 *   - A whirlpool's, DefiTuna's and Crema's tick arrays are the SDK venue adapters' windows for the
 *     direction; a whirlpool's `extra` is its oracle, Crema's its tick-array map. The adapters read
 *     a pool for an off-chain quote and refuse what they cannot quote, an adaptive fee tier or a
 *     Token-2022 mint, though the accounts depend on neither: they are shown a whirlpool's fee tier
 *     as its tick spacing, and Orca's and DefiTuna's mints, whose swaps take Token-2022's, as
 *     unread (which they take as SPL Token's).
 *   - A Phoenix market's slot is the same paying either token: its log authority as `config`, its
 *     base and quote vaults, and the System program in the four places it takes nothing.
 *   - A Meteora DLMM pool's slot has its program's event authority as `config`, its reserves of
 *     token X and token Y, its oracle as `extra`, and the two bin arrays its bitmap (1,024 bits at
 *     584, bit 512 the array at 0) marks nearest its active bin's, that one included, in walk order:
 *     down paying token X, up paying token Y. The third tick place is the System program.
 *
 * Shared by `sauce pools`, which lists each pool's slot both ways, and the venue namespaces, whose
 * slot accounts `svm/account-names.ts` derives as the cook is built (`slot:<pool>:<token>.<part>`).
 * Reads go through the loader the caller hands it; nothing here makes a request of its own.
 */
import { address, getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";

import {
  BYREAL_PROGRAM_ID,
  CLMMPOOL_DISCRIMINATOR,
  CREMA_PROGRAM_ID,
  CROPPER_PROGRAM_ID,
  DEFITUNA_PROGRAM_ID,
  FUSION_POOL_DISCRIMINATOR,
  LB_PAIR_DISCRIMINATOR,
  METEORA_DLMM_PROGRAM_ID,
  fetchCremaPoolConfig,
  fetchCropperConfig,
  fetchDefiTunaPoolConfig,
  fetchOrcaWhirlpoolConfig,
  fetchPhoenixConfig,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PANCAKESWAP_CLMM_PROGRAM_ID,
  PHOENIX_MARKET_DISCRIMINANT,
  PHOENIX_PROGRAM_ID,
  RAYDIUM_CLMM_POOL_DISCRIMINATOR,
  RAYDIUM_CLMM_PROGRAM_ID,
  STABBLE_CLMM_PROGRAM_ID,
} from "./venues/index.js";
import { WHIRLPOOL_DISCRIMINATOR } from "./venues/orca-whirlpool/index.js";
import { memoizedGetProgramDerivedAddress } from "./venues/pda-memo.js";
import type { AccountLoader, OwnedAccountLoader } from "./venues/types.js";

const SYSTEM = address("11111111111111111111111111111111");

export type SvmPoolLayout = "raydium" | "whirlpool" | "defituna" | "crema" | "phoenix" | "dlmm";

/** A venue whose pool's slot is read here: its name, program and pool layout. */
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

/** Every venue whose pool's slot is read here: the price-limit venues, then Meteora DLMM. */
export const SVM_SLOT_VENUES: readonly SvmPriceLimitVenue[] = [
  ...SVM_PRICE_LIMIT_VENUES,
  { name: "Meteora DLMM", program: METEORA_DLMM_PROGRAM_ID, layout: "dlmm" },
];

/**
 * A concentrated-liquidity layout: its pool account's size and discriminator (the first 8 bytes,
 * Anchor's hash of the account's name), and where it keeps the pair (lower key first), its
 * liquidity, price and tick.
 */
export const SVM_CLMM_LAYOUT: Readonly<
  Record<
    Exclude<SvmPoolLayout, "phoenix" | "dlmm">,
    {
      readonly size: number;
      readonly discriminator: readonly number[];
      readonly mintA: number;
      readonly mintB: number;
      readonly liquidity: number;
      readonly price: number;
      readonly tick: number;
    }
  >
> = {
  // PoolState, for every Raydium-layout fork.
  raydium: {
    size: 1544,
    discriminator: RAYDIUM_CLMM_POOL_DISCRIMINATOR,
    mintA: 73,
    mintB: 105,
    liquidity: 237,
    price: 253,
    tick: 269,
  },
  // Whirlpool, for Orca and Cropper.
  whirlpool: {
    size: 653,
    discriminator: WHIRLPOOL_DISCRIMINATOR,
    mintA: 101,
    mintB: 181,
    liquidity: 49,
    price: 65,
    tick: 81,
  },
  // FusionPool.
  defituna: {
    size: 423,
    discriminator: FUSION_POOL_DISCRIMINATOR,
    mintA: 11,
    mintB: 43,
    liquidity: 151,
    price: 167,
    tick: 183,
  },
  // Clmmpool.
  crema: {
    size: 748,
    discriminator: CLMMPOOL_DISCRIMINATOR,
    mintA: 40,
    mintB: 72,
    liquidity: 174,
    price: 190,
    tick: 206,
  },
};

/** Where a Phoenix market keeps its base mint and its quote mint, in its 576-byte header. */
export const PHOENIX_BASE_MINT_AT = 48;
export const PHOENIX_QUOTE_MINT_AT = 128;
const PHOENIX_HEADER_SIZE = 576;

/**
 * A Meteora DLMM pool's `LbPair`: its size, and where it keeps its token X and Y mints, its reserves
 * of them, its oracle, its active bin (an i32) and its bin-array bitmap.
 */
export const SVM_DLMM_LAYOUT = {
  size: 904,
  mintX: 88,
  mintY: 120,
  reserveX: 152,
  reserveY: 184,
  oracle: 552,
  active: 76,
  bitmap: 584,
} as const;

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
  const { mintA, mintB } =
    SVM_CLMM_LAYOUT[venue.layout as Exclude<SvmPoolLayout, "phoenix" | "dlmm">];
  const unread =
    program === ORCA_WHIRLPOOL_PROGRAM_ID || program === DEFITUNA_PROGRAM_ID
      ? [keyAt(data, mintA), keyAt(data, mintB)]
      : [];
  const shown = new Uint8Array(data);
  if (venue.layout === "whirlpool") shown.set(data.subarray(41, 43), 43); // fee tier := tick spacing
  const adapted: AccountLoader = async (at) =>
    at === pool ? shown : unread.includes(at) ? null : load(at);
  if (venue.layout === "whirlpool") {
    const cfg =
      program === CROPPER_PROGRAM_ID
        ? await fetchCropperConfig(adapted, pool)
        : await fetchOrcaWhirlpoolConfig(adapted, pool);
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
    const cfg = await fetchDefiTunaPoolConfig(adapted, pool);
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

/** sha256("account:TickArrayBitmapExtension")[..8]. */
const BITMAP_EXTENSION = [0x3c, 0x96, 0x24, 0xdb, 0x61, 0x80, 0x8b, 0x99];

/**
 * A Raydium-layout pool's three tick-array places in its direction. Its swap starts at the first
 * array holding liquidity in the walk's direction and loads every account it is given, so these are
 * the marked arrays nearest its price that way in walk order, then the other way, then the nearest
 * that exist with no liquidity. An array is the program address of `["tick_array", pool, start]`,
 * `start` a big-endian i32.
 *
 * The pool's own bitmap (1,024 bits at 904, bit 512 the array at 0) marks the arrays within 512 of
 * zero each way; past that, its bitmap extension does (the program address of
 * `["pool_tick_array_bitmap_extension", pool]`: 14 bitmaps of 512 arrays each way, the positive at
 * 40 and the negative at 936), and the swap of a pool whose arrays lie there takes the extension
 * among its tick arrays, wherever it is, or fails the whole transaction. Such a pool's three are the
 * extension, then its two nearest arrays.
 */
async function raydiumTickArrays(
  program: Address,
  pool: Address,
  data: Uint8Array,
  down: boolean,
  load: AccountLoader,
): Promise<[Address, Address, Address]> {
  const span = 60 * Number(le(data, 235, 2));
  const edge = 512 * span; // the pool's own bitmap marks the arrays starting in [-edge, edge)
  const current = Math.floor(i32(data, 269) / span) * span;
  const bitmap = data.subarray(904, 904 + 128);
  const extension = await memoizedGetProgramDerivedAddress(program, [
    new TextEncoder().encode("pool_tick_array_bitmap_extension"),
    new Uint8Array(getAddressEncoder().encode(pool)),
  ]);
  let extended: Uint8Array | null | undefined;
  const bit = (bytes: Uint8Array, at: number, index: number) =>
    ((bytes[at + (index >> 3)]! >> (index & 7)) & 1) === 1;
  const inside = (start: number) => start >= -edge && start < edge;
  const marked = (start: number): boolean => {
    if (inside(start)) return bit(bitmap, 0, start / span + 512);
    if (extended === null || extended === undefined) return false;
    // Raydium's own arithmetic: the bitmap past the first `edge` ticks, and the array's bit in it.
    const magnitude = Math.abs(start);
    let level = Math.floor(magnitude / edge) - 1;
    if (start < 0 && magnitude % edge === 0) level -= 1;
    if (level < 0 || level >= 14) return false;
    const rest = magnitude % edge;
    const index = start < 0 && rest !== 0 ? 512 - rest / span : rest / span;
    return bit(extended, (start < 0 ? 936 : 40) + 64 * level, index);
  };
  // Read the extension only for a pool whose price is past its own bitmap.
  if (!inside(current)) {
    const read = await load(extension);
    extended = read !== null && BITMAP_EXTENSION.every((byte, i) => read[i] === byte) ? read : null;
  }
  // The search spans the bitmaps read: the pool's own, and past it the extension's 14 each way.
  const reach = extended === undefined || extended === null ? edge : 15 * edge;
  const within = (start: number) => start >= -reach && start < reach;
  const step = down ? -span : span;
  const starts: number[] = [];
  for (let start = current; starts.length < 3 && within(start); start += step)
    if (marked(start)) starts.push(start);
  for (let start = current - step; starts.length < 3 && within(start); start -= step)
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
  const outside = !inside(current) || starts.some((start) => !inside(start));
  if (outside && extended === undefined) {
    const read = await load(extension);
    extended = read !== null && BITMAP_EXTENSION.every((byte, i) => read[i] === byte) ? read : null;
  }
  if (outside && extended === null) {
    throw new Error("its price is past its own tick bitmap, and it has no bitmap extension");
  }
  // Past the pool's own bitmap, the extension takes the first place.
  const places = outside ? 2 : 3;
  const chosen = await Promise.all(starts.slice(0, places).map(at));
  // Fewer with liquidity than there are places: the nearest that exist with none, the price's own
  // array and those behind it, nearest first, every candidate read at once. Never one past the price
  // that way: the swap at a price stops where the furthest array it is given that way begins, which
  // must be one its bitmap marks (`router.svm.js`).
  if (chosen.length < places) {
    const candidates: number[] = [current];
    for (let distance = 1; distance <= 16; distance++) candidates.push(current - distance * step);
    const unmarked = candidates.filter((start) => !starts.includes(start));
    const keys = await Promise.all(unmarked.map(at));
    const exist = await Promise.all(keys.map(async (key) => (await load(key)) !== null));
    for (const [i, key] of keys.entries()) {
      if (chosen.length >= places) break;
      if (exist[i]) chosen.push(key);
    }
  }
  if (chosen.length < places) {
    throw new Error(
      `it has ${chosen.length} tick arrays near its price, and its swap takes ${places}`,
    );
  }
  return (outside ? [extension, ...chosen] : chosen) as [Address, Address, Address];
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
 * A Meteora DLMM pool's slot, paying its token X (the walk goes down) or its token Y (up). `data` is
 * the pool's own account. Throws when its active bin is past its own bitmap (in its bitmap
 * extension, which a swap here does not read) and when no bin array holds liquidity that way.
 */
export async function svmDlmmSlot(
  pool: Address,
  data: Uint8Array,
  paysX: boolean,
): Promise<SvmSlot> {
  const L = SVM_DLMM_LAYOUT;
  const active = i32(data, L.active);
  const from = Math.floor(active / 70);
  if (from < -512 || from > 511) {
    throw new Error(
      `its active bin, ${active}, is past its bitmap, in its bitmap extension, which a swap here ` +
        "does not read",
    );
  }
  const marked = (index: number) => {
    const bit = index + 512;
    return ((data[L.bitmap + (bit >> 3)]! >> (bit & 7)) & 1) === 1;
  };
  const indexes: number[] = [];
  for (
    let index = from;
    indexes.length < 2 && index >= -512 && index <= 511;
    index += paysX ? -1 : 1
  )
    if (marked(index)) indexes.push(index);
  if (indexes.length === 0) {
    throw new Error(`no bin array holds liquidity ${paysX ? "below" : "above"} its active bin`);
  }
  const pair = new Uint8Array(getAddressEncoder().encode(pool));
  const arrays = await Promise.all(
    indexes.map((index) => {
      const seed = new Uint8Array(8);
      new DataView(seed.buffer).setBigInt64(0, BigInt(index), true);
      return memoizedGetProgramDerivedAddress(METEORA_DLMM_PROGRAM_ID, [
        new TextEncoder().encode("bin_array"),
        pair,
        seed,
      ]);
    }),
  );
  const events = await memoizedGetProgramDerivedAddress(METEORA_DLMM_PROGRAM_ID, [
    new TextEncoder().encode("__event_authority"),
  ]);

  return {
    program: METEORA_DLMM_PROGRAM_ID,
    pool,
    config: events,
    vaultA: keyAt(data, L.reserveX),
    vaultB: keyAt(data, L.reserveY),
    extra: keyAt(data, L.oracle),
    ticks: [arrays[0]!, arrays[1] ?? SYSTEM, SYSTEM],
  };
}

/**
 * The slot of `pool` paying `pay`, read through `load`: its venue from the pool's owner, its pair
 * from its own bytes, which must hold `pay`. Throws for a pool no venue here owns, one whose
 * pair does not hold `pay`, and one whose slot cannot be read (a Raydium-layout pool with fewer
 * than three tick arrays near its price, a Meteora DLMM pool with no liquidity that way).
 */
export async function svmPoolSlot(
  load: OwnedAccountLoader,
  pool: Address,
  pay: Address,
): Promise<SvmSlot> {
  const account = await load(pool);
  if (account === null) throw new Error(`pool ${pool} has no account`);
  const venue = SVM_SLOT_VENUES.find((one) => one.program === account.owner);
  if (venue === undefined) {
    throw new Error(
      `${pool} is owned by ${account.owner}, which is not a venue a namespace swaps at ` +
        `(${SVM_SLOT_VENUES.map((one) => one.name).join(", ")})`,
    );
  }
  const data = account.data;
  const loadData: AccountLoader = async (key) => (await load(key))?.data ?? null;
  // The account's own kind, before a byte of it is read as a pool's: an account of the venue's
  // program that is not a pool is refused here rather than read at a pool's offsets.
  const notAPool = (what: string) =>
    new Error(`${pool} is not a ${venue.name} ${what}: its account is another of the program's`);
  if (venue.layout === "phoenix") {
    if (data.length < PHOENIX_HEADER_SIZE || le(data, 0, 8) !== PHOENIX_MARKET_DISCRIMINANT) {
      throw notAPool("market");
    }
    const base = keyAt(data, PHOENIX_BASE_MINT_AT);
    const quote = keyAt(data, PHOENIX_QUOTE_MINT_AT);
    if (pay !== base && pay !== quote) {
      throw new Error(`${venue.name} market ${pool} trades ${base} for ${quote}, not ${pay}`);
    }
    return svmPhoenixSlot(pool, loadData);
  }
  if (venue.layout === "dlmm") {
    if (data.length !== SVM_DLMM_LAYOUT.size) {
      throw new Error(
        `${pool} is ${data.length} bytes, not a ${venue.name} pool's ${SVM_DLMM_LAYOUT.size}`,
      );
    }
    if (!LB_PAIR_DISCRIMINATOR.every((byte, i) => data[i] === byte)) throw notAPool("pool");
    const x = keyAt(data, SVM_DLMM_LAYOUT.mintX);
    const y = keyAt(data, SVM_DLMM_LAYOUT.mintY);
    if (pay !== x && pay !== y) {
      throw new Error(`${venue.name} pool ${pool} trades ${x} and ${y}, not ${pay}`);
    }
    return svmDlmmSlot(pool, data, pay === x);
  }
  const layout = SVM_CLMM_LAYOUT[venue.layout];
  if (data.length !== layout.size) {
    throw new Error(`${pool} is ${data.length} bytes, not a ${venue.name} pool's ${layout.size}`);
  }
  if (!layout.discriminator.every((byte, i) => data[i] === byte)) throw notAPool("pool");
  const lower = keyAt(data, layout.mintA);
  const higher = keyAt(data, layout.mintB);
  if (pay !== lower && pay !== higher) {
    throw new Error(`${venue.name} pool ${pool} trades ${lower} and ${higher}, not ${pay}`);
  }

  return svmClmmSlot(venue, pool, data, pay === lower, loadData);
}
