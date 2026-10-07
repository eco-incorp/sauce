/**
 * `sauce pools --chain solana <pay> <buy>`: a pair's pools at every Solana venue whose swap takes a
 * price limit that stops it — Raydium CLMM, PancakeSwap CLMM, Byreal and Stabble CLMM (one pool
 * layout), Orca Whirlpools and Cropper (another), DefiTuna, Crema and Phoenix's order book — read now
 * through an endpoint, each with its price both ways, its fee and the nine accounts a distributed
 * swap's slot takes for it in each direction (program, pool, config, two vaults, one more account,
 * three tick arrays), so the program's accounts come from the cluster rather than by hand.
 *
 * A pool is found by `getProgramAccounts` on its venue's program, filtered by its size and the
 * pair at its mints' offsets (the concentrated-liquidity venues keep the pair in key order, the
 * lower first; a Phoenix market its base and quote, either way). What a pool is skipped for is what
 * the skill's program skips it for: no liquidity at its price, swaps switched off, a fee that is not
 * one rate, a paused pool, a market not open for taking.
 */
import {
  address,
  createSolanaRpc,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  isAddress,
} from "@solana/kit";
import type { Address } from "@solana/kit";

import type { CanonicalChain } from "../chains/canonical.js";
import { svmTokenRows } from "../routes/token-registry.js";
import { coalescingAccountLoader, kitBatchAccountLoader } from "../svm/loader.js";
import {
  CREMA_PROGRAM_ID,
  CROPPER_PROGRAM_ID,
  DEFITUNA_PROGRAM_ID,
  fetchCremaPoolConfig,
  fetchCropperConfig,
  fetchDefiTunaPoolConfig,
  fetchOrcaWhirlpoolConfig,
  fetchPhoenixConfig,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PHOENIX_PROGRAM_ID,
} from "../svm/venues/index.js";
import {
  BYREAL_PROGRAM_ID,
  PANCAKESWAP_CLMM_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  STABBLE_CLMM_PROGRAM_ID,
} from "../svm/venues/index.js";
import { memoizedGetProgramDerivedAddress } from "../svm/venues/pda-memo.js";
import { CliError, UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";
import { svmReader } from "./solana.js";

type Rpc = ReturnType<typeof createSolanaRpc>;

const SYSTEM = address("11111111111111111111111111111111");
const Q128 = 1n << 128n;
const E18 = 10n ** 18n;
/** The discriminant every Phoenix market's header opens with, little-endian. */
const PHOENIX_MARKET = 8_167_313_896_524_341_111n;

type Layout = "raydium" | "whirlpool" | "defituna" | "crema" | "phoenix";

interface SvmVenue {
  readonly name: string;
  readonly program: Address;
  readonly layout: Layout;
}

/** Every venue, in the order the skill names them. */
export const SVM_PRICE_LIMIT_VENUES: readonly SvmVenue[] = [
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

/** Where a concentrated-liquidity layout keeps the pair, the liquidity, the price and the fee. */
const CLMM: Record<
  Exclude<Layout, "phoenix">,
  { size: number; mintA: number; mintB: number; liquidity: number; price: number; tick: number }
> = {
  raydium: { size: 1544, mintA: 73, mintB: 105, liquidity: 237, price: 253, tick: 269 },
  whirlpool: { size: 653, mintA: 101, mintB: 181, liquidity: 49, price: 65, tick: 81 },
  defituna: { size: 423, mintA: 11, mintB: 43, liquidity: 151, price: 167, tick: 183 },
  crema: { size: 748, mintA: 40, mintB: 72, liquidity: 174, price: 190, tick: 206 },
};

export interface SvmPoolsInput {
  readonly chain: CanonicalChain;
  readonly rpcUrl: string;
  /** The pair, as written: registry symbols or base58 mints; the first is the one paid first. */
  readonly tokens: readonly [string, string];
}

/** Makes each request, naming what it reads when it fails (the endpoint never named). */
type Ask = <T>(what: string, request: () => Promise<T>) => Promise<T>;

interface Mint {
  readonly symbol: string;
  readonly mint: Address;
  readonly decimals: number;
}

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
const keyNumber = (key: Address): bigint =>
  BigInt(`0x${Buffer.from(getAddressEncoder().encode(key)).toString("hex")}`);
/** A whole-token amount of `units` base units, to six significant places. */
function decimal(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) return "∞";
  const whole = numerator / denominator;
  let rest = numerator % denominator;
  let text = whole.toString();
  if (rest === 0n) return text;
  text += ".";
  let digits = whole === 0n ? 0 : whole.toString().length;
  let leading = whole === 0n;
  while (rest !== 0n && digits < 8 && text.length < 30) {
    rest *= 10n;
    const digit = rest / denominator;
    rest %= denominator;
    text += digit.toString();
    if (!(leading && digit === 0n)) {
      leading = false;
      digits++;
    }
  }
  return text;
}

/** One side of a pool: paying `pay` for `buy`, before and with the fee, and as a maxPrice. */
interface Side {
  readonly pay: string;
  readonly buy: string;
  /** Whole pay tokens per whole buy token, before the fee. */
  readonly mid: string;
  /** With the fee. */
  readonly taker: string;
  /** The taker price as the distributed swap's maxPrice: pay base units per buy base unit × 1e18. */
  readonly maxPrice: string;
}

interface Listed {
  readonly venue: string;
  readonly program: Address;
  readonly pool: Address;
  /** In millionths: a Phoenix market's taker fee, in basis points, times 100. */
  readonly fee: number;
  readonly liquidity?: string;
  readonly sqrtPriceX64?: string;
  readonly sides: readonly Side[];
  /** Each direction's slot, by the token paid. */
  readonly slots: Readonly<Record<string, SvmSlot>>;
  /** Why a slot could not be filled, by the token paid. */
  readonly unfilled?: Readonly<Record<string, string>>;
}

/** The pair's pools at every price-limit venue, each with its sides and slots. */
export async function svmPoolsCommand(input: SvmPoolsInput): Promise<CommandOutput> {
  const { chain } = input;
  const rpc = createSolanaRpc(input.rpcUrl);
  const ask = svmReader(input.rpcUrl);
  const load = coalescingAccountLoader(kitBatchAccountLoader(rpc));
  const mints = await Promise.all(input.tokens.map((token) => mintOf(chain, token, load)));
  const [first, second] = mints as [Mint, Mint];
  if (first.mint === second.mint) throw new UsageError("the pair names one mint twice");
  const lower = keyNumber(first.mint) < keyNumber(second.mint) ? first : second;
  const higher = lower === first ? second : first;
  const listed: Listed[] = [];
  const skipped: { venue: string; pool: Address; why: string }[] = [];
  const checked: { venue: string; program: Address; pools: number; error?: string }[] = [];

  for (const venue of SVM_PRICE_LIMIT_VENUES) {
    let found: { pubkey: Address; data: Uint8Array }[];
    try {
      found = await programAccounts(
        rpc,
        ask,
        venue,
        lower.mint,
        higher.mint,
        first.mint,
        second.mint,
      );
    } catch (error) {
      checked.push({
        venue: venue.name,
        program: venue.program,
        pools: 0,
        error: (error as Error).message,
      });
      continue;
    }
    checked.push({ venue: venue.name, program: venue.program, pools: found.length });
    for (const { pubkey, data } of found) {
      const read =
        venue.layout === "phoenix"
          ? await phoenixPool(venue, pubkey, data, first, second, load)
          : await clmmPool(rpc, ask, venue, pubkey, data, lower, higher, first, second, load);
      if ("why" in read) skipped.push({ venue: venue.name, pool: pubkey, why: read.why });
      else listed.push(read);
    }
  }
  // Deepest first among the concentrated-liquidity pools (their liquidity is in the same units for
  // one pair), the order books after.
  listed.sort((a, b) =>
    a.liquidity === undefined
      ? 1
      : b.liquidity === undefined
        ? -1
        : BigInt(b.liquidity) > BigInt(a.liquidity)
          ? 1
          : BigInt(b.liquidity) < BigInt(a.liquidity)
            ? -1
            : 0,
  );

  const json = {
    chain: chain.slug,
    tokens: mints.map((m) => ({ symbol: m.symbol, mint: m.mint, decimals: m.decimals })),
    sortedBy: "liquidity at the pool's price, the order books after",
    pools: listed,
    skipped,
    checked,
  };
  const lines = [
    `${first.symbol}/${second.symbol} on ${chain.slug}: ${listed.length} pools to trade, ` +
      `${skipped.length} skipped. Prices are ${first.symbol} per ${second.symbol} paying ` +
      `${first.symbol}, then the reverse; a slot is the nine accounts the distributed swap takes for ` +
      "the pool, paying the token named.",
  ];
  for (const pool of listed) {
    lines.push(
      "",
      `${pool.venue} ${pool.pool}: fee ${pool.fee / 10_000}%` +
        (pool.liquidity === undefined ? "" : `, liquidity ${pool.liquidity}`),
    );
    for (const side of pool.sides)
      lines.push(
        `  paying ${side.pay}: ${side.mid} ${side.pay} per ${side.buy}, ${side.taker} with the fee, maxPrice ${side.maxPrice}`,
      );
    for (const [paid, slot] of Object.entries(pool.slots))
      lines.push(
        `  slot paying ${paid}: program=${slot.program} pool=${slot.pool} config=${slot.config} ` +
          `vaultA=${slot.vaultA} vaultB=${slot.vaultB} extra=${slot.extra} ticks=${slot.ticks.join(",")}`,
      );
    for (const [paid, why] of Object.entries(pool.unfilled ?? {}))
      lines.push(`  no slot paying ${paid}: ${why}`);
  }
  if (skipped.length > 0) {
    lines.push("", "Skipped, as the distributed swap skips them:");
    for (const one of skipped) lines.push(`  ${one.venue} ${one.pool}: ${one.why}`);
  }
  lines.push(
    "",
    `Looked at: ${checked.map((c) => `${c.venue} (${c.error ?? `${c.pools} pools`})`).join(", ")}`,
  );

  return { text: lines.join("\n"), json };
}

/** A registry symbol or a base58 mint, with its decimals. */
async function mintOf(
  chain: CanonicalChain,
  token: string,
  load: (key: Address) => Promise<Uint8Array | null>,
): Promise<Mint> {
  const row = svmTokenRows(chain).find((one) => one.symbol.toUpperCase() === token.toUpperCase());
  if (row !== undefined)
    return { symbol: row.symbol, mint: address(row.mint), decimals: row.decimals };
  if (!isAddress(token)) {
    throw new UsageError(
      `${token} is not a mint ${chain.slug} registers: give its symbol (sauce globals --chain ` +
        `${chain.slug}) or its base58 address`,
    );
  }
  const data = await load(address(token));
  if (data === null || data.length < 82)
    throw new CliError(`${token} is not a mint on ${chain.slug}`);
  return { symbol: token, mint: address(token), decimals: data[44]! };
}

/** The venue's accounts holding the pair, with their data. */
async function programAccounts(
  rpc: Rpc,
  ask: Ask,
  venue: SvmVenue,
  lower: Address,
  higher: Address,
  first: Address,
  second: Address,
): Promise<{ pubkey: Address; data: Uint8Array }[]> {
  const query = async (filters: readonly unknown[]) => {
    const found = await ask(`${venue.name}'s pools`, () =>
      rpc
        .getProgramAccounts(venue.program, { encoding: "base64", filters: filters as never })
        .send(),
    );
    return (found as unknown as { pubkey: Address; account: { data: [string, string] } }[]).map(
      (item) => ({
        pubkey: item.pubkey,
        data: new Uint8Array(Buffer.from(item.account.data[0], "base64")),
      }),
    );
  };
  if (venue.layout === "phoenix") {
    const discriminant = new Uint8Array(8);
    new DataView(discriminant.buffer).setBigUint64(0, PHOENIX_MARKET, true);
    const marker = {
      memcmp: { offset: 0n, bytes: getBase58Decoder().decode(discriminant), encoding: "base58" },
    };
    const pair = (base: Address, quote: Address) => [
      marker,
      { memcmp: { offset: 48n, bytes: base, encoding: "base58" } },
      { memcmp: { offset: 128n, bytes: quote, encoding: "base58" } },
    ];
    return [...(await query(pair(first, second))), ...(await query(pair(second, first)))];
  }
  const layout = CLMM[venue.layout];
  return query([
    { dataSize: BigInt(layout.size) },
    { memcmp: { offset: BigInt(layout.mintA), bytes: lower, encoding: "base58" } },
    { memcmp: { offset: BigInt(layout.mintB), bytes: higher, encoding: "base58" } },
  ]);
}

/** A price in maxPrice's units (pay base units per buy base unit, × 1e18) in whole tokens. */
const whole = (priceE18: bigint, pay: Mint, buy: Mint): string =>
  decimal(priceE18 * 10n ** BigInt(buy.decimals), E18 * 10n ** BigInt(pay.decimals));

/** A side from its prices in maxPrice's units, before and with the fee. */
const sideOf = (pay: Mint, buy: Mint, mid: bigint, taker: bigint): Side => ({
  pay: pay.symbol,
  buy: buy.symbol,
  mid: whole(mid, pay, buy),
  taker: whole(taker, pay, buy),
  maxPrice: taker.toString(),
});

/** Both sides of a pool whose price is a Q64.64 sqrt price of the higher-key token per the lower. */
function clmmSides(sqrt: bigint, fee: bigint, lower: Mint, first: Mint, second: Mint): Side[] {
  const kept = 1_000_000n - fee;
  const side = (pay: Mint, buy: Mint): Side =>
    pay === lower
      ? sideOf(
          pay,
          buy,
          (Q128 * E18) / (sqrt * sqrt),
          (Q128 * E18 * 1_000_000n) / (sqrt * sqrt * kept),
        )
      : sideOf(
          pay,
          buy,
          (sqrt * sqrt * E18) / Q128,
          (sqrt * sqrt * E18 * 1_000_000n) / (Q128 * kept),
        );
  return [side(first, second), side(second, first)];
}

/** A concentrated-liquidity pool: skipped, or listed with its sides and slots. */
async function clmmPool(
  rpc: Rpc,
  ask: Ask,
  venue: SvmVenue,
  pool: Address,
  data: Uint8Array,
  lower: Mint,
  higher: Mint,
  first: Mint,
  second: Mint,
  load: (key: Address) => Promise<Uint8Array | null>,
): Promise<Listed | { why: string }> {
  const layout = CLMM[venue.layout as Exclude<Layout, "phoenix">];
  const liquidity = le(data, layout.liquidity, 16);
  const sqrt = le(data, layout.price, 16);
  let fee: bigint;
  if (venue.layout === "raydium") {
    if ((data[389]! & 16) !== 0) return { why: "swaps are switched off" };
    if (le(data, 393, 4) !== 0n || le(data, 1096, 16) !== 0n)
      return {
        why: "its fee is more than one rate (a pool rate, decay, imbalance or dynamic fee)",
      };
    const config = await load(keyAt(data, 9));
    if (config === null) return { why: "its config account is missing" };
    fee = le(config, 47, 4);
  } else if (venue.layout === "whirlpool") {
    if (le(data, 41, 2) !== le(data, 43, 2))
      return { why: "an adaptive fee, which rises with volatility" };
    fee = le(data, 45, 2);
  } else if (venue.layout === "defituna") {
    fee = le(data, 143, 2);
  } else {
    if (data[747] !== 0) return { why: "paused" };
    fee = le(data, 172, 2);
  }
  if (liquidity === 0n || sqrt === 0n) return { why: "no liquidity at its price" };
  const slots: Record<string, SvmSlot> = {};
  const unfilled: Record<string, string> = {};
  for (const pay of [first, second]) {
    try {
      slots[pay.symbol] = await clmmSlot(rpc, ask, venue, pool, data, pay === lower, load);
    } catch (error) {
      unfilled[pay.symbol] = (error as Error).message;
    }
  }

  return {
    venue: venue.name,
    program: venue.program,
    pool,
    fee: Number(fee),
    liquidity: liquidity.toString(),
    sqrtPriceX64: sqrt.toString(),
    sides: clmmSides(sqrt, fee, lower, first, second),
    slots,
    ...(Object.keys(unfilled).length === 0 ? {} : { unfilled }),
  };
}

/** The nine accounts a concentrated-liquidity pool's slot takes, paying the lower-key token or not. */
async function clmmSlot(
  rpc: Rpc,
  ask: Ask,
  venue: SvmVenue,
  pool: Address,
  data: Uint8Array,
  paysLower: boolean,
  load: (key: Address) => Promise<Uint8Array | null>,
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

/**
 * A Raydium-layout pool's swap loads every account given as a tick array, so each must exist, and
 * starts at the first holding liquidity in its direction: the arrays the pool's bitmap (1,024 bits
 * at 904, bit 512 the array starting at tick 0) marks, nearest its price that way in walk order,
 * then the other way, then arrays near its price that exist with none, which the swap loads and
 * never reaches. An array is the program address of `["tick_array", pool, start]`, `start` a
 * big-endian i32.
 */
async function raydiumTickArrays(
  program: Address,
  pool: Address,
  data: Uint8Array,
  down: boolean,
  load: (key: Address) => Promise<Uint8Array | null>,
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
    throw new CliError(
      `it has ${chosen.length} tick arrays near its price, and its swap takes three`,
    );
  }
  return chosen as [Address, Address, Address];
}

/** A Phoenix market: skipped, or listed with its sides (its best offer each way) and slots. */
async function phoenixPool(
  venue: SvmVenue,
  market: Address,
  data: Uint8Array,
  first: Mint,
  second: Mint,
  load: (key: Address) => Promise<Uint8Array | null>,
): Promise<Listed | { why: string }> {
  if (le(data, 8, 8) !== 1n) return { why: "not open for taking (post-only, paused or closed)" };
  const cfg = await fetchPhoenixConfig(load, market);
  const base = keyAt(data, 48) === first.mint ? first : second;
  const quote = base === first ? second : first;
  const fee = le(data, 856, 8);
  const tickQuote = cfg.tickSizeInQuoteLotsPerBaseUnit * cfg.quoteLotSize; // quote atoms per base unit per tick
  const baseUnit = cfg.baseLotsPerBaseUnit * cfg.baseLotSize; // base atoms per base unit
  const best = (side: "baseIn" | "quoteIn"): bigint | undefined => {
    const order = cfg.windows[side].orders[0];
    if (order === undefined) return undefined;
    const nodes = side === "quoteIn" ? cfg.asksNodesBase : 912;
    return le(data, nodes + (order.nodeIndex - 1) * 64 + 16, 8);
  };
  const ask = best("quoteIn");
  const bid = best("baseIn");
  if (ask === undefined && bid === undefined) return { why: "no offers on its book" };
  const sides: Side[] = [];
  for (const pay of [first, second]) {
    const buy = pay === first ? second : first;
    // Paying quote buys base at the best ask, the fee on top; paying base sells at the best bid,
    // the fee taken from the quote.
    const buying = pay === quote;
    const ticks = buying ? ask : bid;
    if (ticks === undefined) continue;
    const quotePerBase = (ticks * tickQuote * E18) / baseUnit; // quote atoms per base atom, × 1e18
    sides.push(
      buying
        ? sideOf(pay, buy, quotePerBase, (quotePerBase * (10_000n + fee)) / 10_000n)
        : sideOf(
            pay,
            buy,
            (E18 * E18) / quotePerBase,
            (E18 * E18 * 10_000n) / (quotePerBase * (10_000n - fee)),
          ),
    );
  }
  const log = await memoizedGetProgramDerivedAddress(venue.program, [
    new TextEncoder().encode("log"),
  ]);
  const slot: SvmSlot = {
    program: venue.program,
    pool: market,
    config: log,
    vaultA: cfg.baseVault,
    vaultB: cfg.quoteVault,
    extra: SYSTEM,
    ticks: [SYSTEM, SYSTEM, SYSTEM],
  };

  return {
    venue: venue.name,
    program: venue.program,
    pool: market,
    fee: Number(fee) * 100,
    sides,
    slots: { [first.symbol]: slot, [second.symbol]: slot },
  };
}
