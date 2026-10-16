/**
 * `sauce pools --chain solana <pay> <buy>`: a pair's pools at every Solana venue whose swap takes a
 * price limit that stops it — Raydium CLMM, PancakeSwap CLMM, Byreal and Stabble CLMM (one pool
 * layout), Orca Whirlpools and Cropper (another), DefiTuna, Crema, Phoenix's order book, and Meteora
 * DLMM, whose bins the swap walks to its limit — read now
 * through an endpoint, each with its price both ways, its fee and the nine accounts a swap at it
 * takes in each direction (program, pool, config, two vaults, one more account, three tick arrays),
 * its slot. `--pay` chooses the pools a distributed swap paying one of the pair takes and gives them
 * in slot order, padded with the System Program (an empty slot), for the program's `--args`: a
 * program that takes a pool as an `Address` argument has its slot derived from the pool as the cook
 * is built. It gives their slots' accounts too, for a program that takes its slots as accounts.
 *
 * A pool is found by `getProgramAccounts` on its venue's program, filtered by its size and the
 * pair at its mints' offsets (the concentrated-liquidity venues keep the pair in key order, the
 * lower first; a Phoenix market its base and quote and a DLMM pool its X and Y, either way). What a
 * pool is skipped for is what the skill's program skips it for: no liquidity at its price, swaps
 * switched off, a fee that is not one rate (or, on a DLMM pool, taken from the token bought), a
 * paused pool, a market not open for taking, a DLMM pool not active yet or priced past its bitmap.
 * A DLMM pool's liquidity is its active bin's, in the concentrated-liquidity pools' units: what it
 * holds, in token Y, over the rise of the square root of its price across the bin.
 */
import {
  address,
  createSolanaRpc,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
} from "@solana/kit";
import type { Address } from "@solana/kit";

import type { CanonicalChain } from "../chains/canonical.js";
import { svmTokenRows } from "../routes/token-registry.js";
import { svmPublicKey } from "../svm/account-names.js";
import { coalescingAccountLoader, kitBatchAccountLoader } from "../svm/loader.js";
import {
  PHOENIX_BASE_MINT_AT,
  SVM_CLMM_LAYOUT,
  SVM_DLMM_LAYOUT,
  SVM_PRICE_LIMIT_VENUES,
  svmClmmSlot,
  svmDlmmSlot,
  svmPhoenixSlot,
  type SvmPoolLayout,
  type SvmPriceLimitVenue,
  type SvmSlot,
} from "../svm/pool-slot.js";
import {
  dlmmPriceFromId,
  fetchPhoenixConfig,
  LB_PAIR_DISCRIMINATOR,
  METEORA_DLMM_PROGRAM_ID,
} from "../svm/venues/index.js";
import { memoizedGetProgramDerivedAddress } from "../svm/venues/pda-memo.js";
import { CliError, UsageError } from "./args.js";
import type { CommandOutput } from "./commands.js";
import { svmReader } from "./solana.js";

type Rpc = ReturnType<typeof createSolanaRpc>;

const SYSTEM = address("11111111111111111111111111111111");
const Q64 = 1n << 64n;
const Q128 = 1n << 128n;
const E18 = 10n ** 18n;
/** The discriminant every Phoenix market's header opens with, little-endian. */
const PHOENIX_MARKET = 8_167_313_896_524_341_111n;

type Layout = SvmPoolLayout;
type SvmVenue = SvmPriceLimitVenue;
const CLMM = SVM_CLMM_LAYOUT;

export { SVM_PRICE_LIMIT_VENUES, type SvmSlot };

export interface SvmPoolsInput {
  readonly chain: CanonicalChain;
  readonly rpcUrl: string;
  /** The pair, as written: registry symbols or base58 mints; the first is the one paid first. */
  readonly tokens: readonly [string, string];
  /**
   * Chooses the pools for a distributed swap paying `pay` (one of the pair): those whose price with
   * the fee is within `maxPrice` (its units), the deepest first, one a venue with `perVenue`, the
   * first `slots` (4) of them; and returns them in slot order as the program's pool arguments, and
   * the accounts a program that takes its slots as accounts takes for them, every slot past the
   * last chosen the System program.
   */
  readonly choose?: {
    readonly pay: string;
    readonly maxPrice?: bigint;
    readonly perVenue?: boolean;
    readonly slots?: number;
  };
  /** How long to wait before each retry of a venue's refused scan (default 1, 2 and 4 seconds). */
  readonly retryMs?: readonly number[];
}

/** The waits before each retry of a refused scan: an endpoint's rate limit lifts in seconds. */
const SCAN_RETRY_MS = [1_000, 2_000, 4_000];

/** Makes each request, naming what it reads when it fails (the endpoint never named). */
type Ask = <T>(what: string, request: () => Promise<T>) => Promise<T>;

interface Mint {
  readonly symbol: string;
  readonly mint: Address;
  readonly decimals: number;
}

const le = (data: Uint8Array, offset: number, length: number): bigint => {
  let value = 0n;
  for (let i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(data[offset + i]!);
  return value;
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
        input.retryMs ?? SCAN_RETRY_MS,
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
          : venue.layout === "dlmm"
            ? await dlmmPool(venue, pubkey, data, first, second, load)
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
  // An order book is listed beside the pools only while an offer on it is near the pair's price at
  // its deepest pool: a book whose every offer costs half as much again (a stale one) fills nothing
  // that a limit near the pair's price allows.
  const deepest = listed.find((pool) => pool.liquidity !== undefined);
  for (const book of deepest === undefined
    ? []
    : listed.filter((pool) => pool.liquidity === undefined)) {
    const near = book.sides.some((side) => {
      const there = deepest!.sides.find((one) => one.pay === side.pay);
      return there !== undefined && BigInt(side.maxPrice) * 2n <= BigInt(there.maxPrice) * 3n;
    });
    if (near) continue;
    listed.splice(listed.indexOf(book), 1);
    skipped.push({
      venue: book.venue,
      pool: book.pool,
      why: "every offer on its book costs more than half as much again as the pair's price at its deepest pool",
    });
  }

  // A pool none of whose slots could be read cannot be traded: it is skipped, with why.
  for (const pool of [...listed]) {
    if (Object.keys(pool.slots).length > 0) continue;
    listed.splice(listed.indexOf(pool), 1);
    skipped.push({
      venue: pool.venue,
      pool: pool.pool,
      why: `its slot's accounts could not be read: ${Object.values(pool.unfilled ?? {})[0] ?? "no reason given"}`,
    });
  }
  const chosen = input.choose === undefined ? undefined : choose(input.choose, listed, mints);
  const unread = checked.filter((one) => one.error !== undefined);
  const json = {
    chain: chain.slug,
    tokens: mints.map((m) => ({ symbol: m.symbol, mint: m.mint, decimals: m.decimals })),
    sortedBy: "liquidity at the pool's price, the order books after",
    ...(chosen === undefined
      ? {}
      : { chosen: chosen.pools, poolArgs: chosen.poolArgs, accounts: chosen.accounts }),
    pools: listed,
    skipped,
    checked,
  };
  const lines = [
    `${first.symbol}/${second.symbol} on ${chain.slug}: ${listed.length} pools to trade, ` +
      `${skipped.length} skipped. Prices are ${first.symbol} per ${second.symbol} paying ` +
      `${first.symbol}, then the reverse; a slot is the nine accounts a swap at the pool takes, ` +
      "paying the token named.",
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
  if (chosen !== undefined) {
    lines.push(
      "",
      `Chosen, paying ${chosen.pay}${input.choose?.maxPrice === undefined ? "" : ` within maxPrice ${input.choose.maxPrice}`}: ` +
        (chosen.pools.length === 0
          ? "no pool"
          : chosen.pools.map((pool, k) => `slot ${k} ${pool.venue} ${pool.pool}`).join(", ")),
      `The pools for main's --args, in slot order: ${chosen.poolArgs.join(" ")}`,
      "Their slots' accounts, for a program that takes its slots as accounts (--accounts, beside " +
        "the shared ones):",
      JSON.stringify(chosen.accounts, null, 2),
    );
  }

  // A venue that could not be read leaves the listing partial: said, and the exit is not 0.
  return {
    text: lines.join("\n"),
    json,
    ...(unread.length === 0
      ? {}
      : {
          notes: [
            `${unread.length} of ${checked.length} venues could not be read (${unread
              .map((one) => one.venue)
              .join(", ")}), even asked again, so the listing is partial: the endpoint refused ` +
              "their scans (getProgramAccounts). Give your own endpoint, with --rpc-url <url> or " +
              "--config <file>, and run it again",
          ],
          exitCode: 1,
        }),
  };
}

/**
 * The pools a distributed swap paying `want` takes: in slot order as its pool arguments, every slot
 * past the last chosen the System program, an empty slot; and as the accounts of a program's slots.
 */
function choose(
  want: NonNullable<SvmPoolsInput["choose"]>,
  listed: readonly Listed[],
  mints: readonly Mint[],
): {
  pay: string;
  pools: { venue: string; pool: Address; taker: string }[];
  poolArgs: Address[];
  accounts: Record<string, string>;
} {
  const symbol = want.pay.toUpperCase() === "SOL" ? "WSOL" : want.pay.toUpperCase();
  const key = svmPublicKey(want.pay);
  const pay = mints.find((mint) => mint.symbol.toUpperCase() === symbol || mint.mint === key);
  if (pay === undefined)
    throw new UsageError(
      `--pay ${want.pay} is not one of the pair (${mints.map((m) => m.symbol).join(", ")})`,
    );
  const slots = want.slots ?? 4;
  const venues = new Set<string>();
  const pools: { venue: string; pool: Address; taker: string }[] = [];
  for (const pool of listed) {
    if (pools.length === slots) break;
    const side = pool.sides.find((one) => one.pay === pay.symbol);
    if (side === undefined || pool.slots[pay.symbol] === undefined) continue;
    if (want.maxPrice !== undefined && BigInt(side.maxPrice) > want.maxPrice) continue;
    if (want.perVenue && venues.has(pool.venue)) continue;
    venues.add(pool.venue);
    pools.push({ venue: pool.venue, pool: pool.pool, taker: side.taker });
  }
  const accounts: Record<string, string> = {};
  for (let k = 0; k < slots; k++) {
    const slot =
      pools[k] === undefined
        ? undefined
        : listed.find((one) => one.pool === pools[k]!.pool)!.slots[pay.symbol]!;
    const each =
      slot === undefined
        ? Array<Address>(9).fill(SYSTEM)
        : [
            slot.program,
            slot.pool,
            slot.config,
            slot.vaultA,
            slot.vaultB,
            slot.extra,
            ...slot.ticks,
          ];
    ["program", "pool", "config", "vaultA", "vaultB", "extra"].forEach(
      (name, i) => (accounts[`${name}${k}`] = each[i]!),
    );
    [0, 1, 2].forEach((i) => (accounts[`ticks${k}${i}`] = each[6 + i]!));
  }

  const poolArgs = Array.from({ length: slots }, (_, k) => pools[k]?.pool ?? SYSTEM);

  return { pay: pay.symbol, pools, poolArgs, accounts };
}

/** A registry symbol or a base58 mint, with its decimals. */
async function mintOf(
  chain: CanonicalChain,
  token: string,
  load: (key: Address) => Promise<Uint8Array | null>,
): Promise<Mint> {
  // A pool holds SOL wrapped, so SOL names WSOL here.
  const symbol = token.toUpperCase() === "SOL" ? "WSOL" : token.toUpperCase();
  const row = svmTokenRows(chain).find((one) => one.symbol.toUpperCase() === symbol);
  if (row !== undefined)
    return { symbol: row.symbol, mint: address(row.mint), decimals: row.decimals };
  const mint = svmPublicKey(token);
  if (mint === undefined) {
    throw new UsageError(
      `${token} is not a mint ${chain.slug} registers: give its symbol (sauce globals --chain ` +
        `${chain.slug}) or its address`,
    );
  }
  const data = await load(mint);
  if (data === null || data.length < 82)
    throw new CliError(`${token} is not a mint on ${chain.slug}`);
  return { symbol: mint, mint, decimals: data[44]! };
}

/** The accounts two scans found, each once. */
const both = <T extends { pubkey: Address }>(one: T[], other: T[]): T[] => [
  ...new Map([...one, ...other].map((found) => [found.pubkey, found])).values(),
];

/** The venue's accounts holding the pair, with their data. */
async function programAccounts(
  rpc: Rpc,
  ask: Ask,
  venue: SvmVenue,
  lower: Address,
  higher: Address,
  first: Address,
  second: Address,
  retryMs: readonly number[],
): Promise<{ pubkey: Address; data: Uint8Array }[]> {
  // A scan an endpoint refuses (a rate limit, most often) is asked again after a wait, one venue at
  // a time: a public endpoint answers each venue's scan when they are not sent together.
  const query = async (filters: readonly unknown[]) => {
    let found: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        found = await ask(`${venue.name}'s pools`, () =>
          rpc
            .getProgramAccounts(venue.program, { encoding: "base64", filters: filters as never })
            .send(),
        );
        break;
      } catch (error) {
        if (attempt >= retryMs.length) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryMs[attempt]));
      }
    }
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
    return both(await query(pair(first, second)), await query(pair(second, first)));
  }
  if (venue.layout === "dlmm") {
    const L = SVM_DLMM_LAYOUT;
    const pair = (x: Address, y: Address) => [
      { dataSize: BigInt(L.size) },
      {
        memcmp: {
          offset: 0n,
          bytes: getBase58Decoder().decode(new Uint8Array(LB_PAIR_DISCRIMINATOR)),
          encoding: "base58",
        },
      },
      { memcmp: { offset: BigInt(L.mintX), bytes: x, encoding: "base58" } },
      { memcmp: { offset: BigInt(L.mintY), bytes: y, encoding: "base58" } },
    ];
    return both(await query(pair(first, second)), await query(pair(second, first)));
  }
  const layout = CLMM[venue.layout];
  return query([
    { dataSize: BigInt(layout.size) },
    {
      memcmp: {
        offset: 0n,
        bytes: getBase58Decoder().decode(new Uint8Array(layout.discriminator)),
        encoding: "base58",
      },
    },
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
  const layout = CLMM[venue.layout as Exclude<Layout, "phoenix" | "dlmm">];
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
      slots[pay.symbol] = await svmClmmSlot(venue, pool, data, pay === lower, load);
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

/**
 * A Meteora DLMM pool: skipped, or listed with its sides at its active bin's price and fee (its base
 * and its volatility term, as `update_references` leaves it now), its liquidity there, and slots.
 */
async function dlmmPool(
  venue: SvmVenue,
  pool: Address,
  data: Uint8Array,
  first: Mint,
  second: Mint,
  load: (key: Address) => Promise<Uint8Array | null>,
): Promise<Listed | { why: string }> {
  const L = SVM_DLMM_LAYOUT;
  if (data[82] !== 0) return { why: "swaps are switched off" };
  if (data[36] !== 0) return { why: "it takes its fee from the token bought" };
  const now = BigInt(Math.floor(Date.now() / 1000));
  const point = le(data, 816, 8);
  if (data[86] === 1 && point > now) return { why: "not active yet" };
  const active = Number(BigInt.asIntN(32, le(data, L.active, 4)));
  const index = Math.floor(active / 70);
  if (index < -512 || index > 511) {
    return { why: "its price is past its bitmap, which a swap here does not read past" };
  }
  const step = Number(le(data, 80, 2));
  const price = dlmmPriceFromId(active, step);
  // Its fee at the active bin: the base, and the volatility term as the swap would find it now.
  const last = le(data, 56, 8);
  const elapsed = now > last ? now - last : 0n;
  let volatility = le(data, 44, 4);
  if (elapsed >= le(data, 10, 2)) {
    volatility = elapsed < le(data, 12, 2) ? (le(data, 40, 4) * le(data, 14, 2)) / 10_000n : 0n;
  }
  if (volatility > le(data, 20, 4)) volatility = le(data, 20, 4);
  const crossed = volatility * BigInt(step);
  let rate =
    le(data, 8, 2) * BigInt(step) * 10n * 10n ** BigInt(data[34]!) +
    (le(data, 16, 4) * crossed * crossed + 99_999_999_999n) / 100_000_000_000n;
  if (rate > 100_000_000n) rate = 100_000_000n;
  // Its active bin's reserves, valued in token Y.
  const seed = new Uint8Array(8);
  new DataView(seed.buffer).setBigInt64(0, BigInt(index), true);
  const bins = await load(
    await memoizedGetProgramDerivedAddress(METEORA_DLMM_PROGRAM_ID, [
      new TextEncoder().encode("bin_array"),
      new Uint8Array(getAddressEncoder().encode(pool)),
      seed,
    ]),
  );
  const cell = 56 + (active - index * 70) * 144;
  const held = bins === null ? 0n : (le(bins, cell, 8) * price) / Q64 + le(bins, cell + 8, 8);
  if (held === 0n) return { why: "no liquidity at its price" };
  const sqrt = isqrt(price << 64n);
  const x = keyAt(data, L.mintX) === first.mint ? first : second;
  const y = x === first ? second : first;
  const kept = 1_000_000_000n - rate;
  const sides = [first, second].map((pay) =>
    pay === x
      ? sideOf(pay, y, (Q64 * E18) / price, (Q64 * E18 * 1_000_000_000n) / (price * kept))
      : sideOf(pay, x, (price * E18) / Q64, (price * E18 * 1_000_000_000n) / (Q64 * kept)),
  );
  const slots: Record<string, SvmSlot> = {};
  const unfilled: Record<string, string> = {};
  for (const pay of [first, second]) {
    try {
      slots[pay.symbol] = await svmDlmmSlot(pool, data, pay === x);
    } catch (error) {
      unfilled[pay.symbol] = (error as Error).message;
    }
  }

  return {
    venue: venue.name,
    program: venue.program,
    pool,
    fee: Number(rate / 1_000n),
    // What it holds over the rise of its square root across the bin, (1 + step / 10,000)^½ − 1, about
    // half the step.
    liquidity: ((held * Q64 * 20_000n) / (sqrt * BigInt(step))).toString(),
    sqrtPriceX64: sqrt.toString(),
    sides,
    slots,
    ...(Object.keys(unfilled).length === 0 ? {} : { unfilled }),
  };
}

/** The integer square root, rounded down: Newton's iteration from a power of two above it. */
function isqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let root = 1n << BigInt((value.toString(2).length + 1) >> 1);
  let next = (root + value / root) / 2n;
  while (next < root) {
    root = next;
    next = (root + value / root) / 2n;
  }
  return root;
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
  const base = keyAt(data, PHOENIX_BASE_MINT_AT) === first.mint ? first : second;
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
  const slot = await svmPhoenixSlot(market, load);

  return {
    venue: venue.name,
    program: venue.program,
    pool: market,
    fee: Number(fee) * 100,
    sides,
    slots: { [first.symbol]: slot, [second.symbol]: slot },
  };
}
