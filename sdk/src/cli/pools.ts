/**
 * `sauce pools`: every price-limit pool of a pair on a chain, at each venue the registry records
 * there — Uniswap V3 and PancakeSwap V3 at every fee tier, Aerodrome Slipstream at every tick
 * spacing of every CLFactory, and hookless Uniswap V4 pools at the standard keys and any given —
 * each with its fee, liquidity and price both ways round, before and after the fee, and the
 * distributed swap's `maxPrice` at that price.
 *
 * Everything is read in five rounds (`chain.ts#readAll`, each `eth_call` carrying up to 32 reads):
 * the pools the V3-style factories have and the tick spacings Slipstream's enable, beside the
 * tokens' decimals; the Slipstream pools; every pool's state; then, for its depth, the tick bitmap
 * around each pool's price and the ticks set in it. The venues are the registry's (`descriptors`),
 * at the addresses a program reaches them by, so a pool listed here is one
 * `UniswapV3.Factory.getPool` (and the rest) finds in a program.
 */
import { encodeAbiParameters, getAddress, keccak256, parseAbi, zeroAddress } from "viem";
import type { Abi, Address, Hex, PublicClient } from "viem";

import type { CanonicalChain } from "../chains/canonical.js";
import { addressOn, listContracts } from "../descriptors/query.js";
import { pascalOfSlug } from "../routes/builder.js";
import { UsageError } from "./args.js";
import { readAll, type ViewCall, type ViewResult } from "./chain.js";
import type { CommandOutput } from "./commands.js";
import { resolvePriceTokens, tokenGiven, type PriceToken } from "./price.js";

/** How a venue's pools are found: a V3-style factory by fee, Slipstream's by tick spacing, or
 *  Uniswap V4's StateView by pool key. */
export type VenueKind = "v3" | "slipstream" | "v4";

/** One contract a venue's pools are found through, on one chain. */
export interface Venue {
  readonly kind: VenueKind;
  /** The protocol's name: `Uniswap V3`. */
  readonly name: string;
  /** How a program names the contract: `UniswapV3.Factory`. */
  readonly contract: string;
  readonly address: Address;
}

/** The registry's price-limit venues, and which of each protocol's contracts finds its pools. */
const VENUE_CONTRACTS: ReadonlyArray<{
  readonly protocol: string;
  readonly kind: VenueKind;
  readonly finds: (contract: string) => boolean;
}> = [
  { protocol: "uniswap-v3", kind: "v3", finds: (contract) => contract === "Factory" },
  { protocol: "pancakeswap-v3", kind: "v3", finds: (contract) => contract === "Factory" },
  // Every generation of Slipstream's factory: each has pools of its own.
  { protocol: "aerodrome-slipstream", kind: "slipstream", finds: (c) => c.startsWith("CLFactory") },
  { protocol: "uniswap-v4", kind: "v4", finds: (contract) => contract === "StateView" },
];

/** The venues the registry records on `chain`, in {@link VENUE_CONTRACTS}' order. */
export function venuesOn(chain: CanonicalChain): Venue[] {
  return VENUE_CONTRACTS.flatMap(({ protocol, kind, finds }) =>
    listContracts(protocol).flatMap((descriptor) => {
      const address = addressOn(descriptor, chain);

      return finds(descriptor.contract) && address !== undefined
        ? [
            {
              kind,
              name: descriptor.protocolName,
              contract: `${pascalOfSlug(protocol)}.${descriptor.contract}`,
              address: getAddress(address),
            },
          ]
        : [];
    }),
  );
}

/**
 * The fee tiers a V3-style factory is asked for, in millionths. A factory's tiers are a mapping
 * with no list, so these are the ones deployments enable: Uniswap's four, the 0.02/0.03/0.04%
 * Base adds, and PancakeSwap's 0.25%. A tier a factory lacks has no pool.
 */
export const V3_FEES = [100, 200, 300, 400, 500, 2500, 3000, 10_000] as const;

/** A hookless Uniswap V4 pool's key, beside the pair's two currencies. */
export interface V4Key {
  /** The LP fee, in millionths. */
  readonly fee: number;
  readonly tickSpacing: number;
}

/** The keys a hookless V4 pool is usually created at: Uniswap V3's tiers with their spacings. */
export const STANDARD_V4_KEYS: readonly V4Key[] = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10_000, tickSpacing: 200 },
];

/** At most this many keys beyond the standard ones. */
export const MAX_V4_KEYS = 32;

/** `<fee>:<tickSpacing>`, a hookless V4 pool's key: `3000:60`. */
export function parseV4Key(raw: string, flag = "--v4-key"): V4Key {
  const match = /^(\d{1,7}):(\d{1,5})$/.exec(raw.trim());
  const fee = Number(match?.[1]);
  const tickSpacing = Number(match?.[2]);
  // V4's bounds: an LP fee up to 100%, a spacing from 1 to 32767.
  if (match === null || fee > 1_000_000 || tickSpacing < 1 || tickSpacing > 32_767) {
    throw new UsageError(
      `${flag} ${raw}: a hookless V4 pool's key is <fee>:<tickSpacing>, the fee in millionths ` +
        "(0 to 1000000) and the spacing 1 to 32767: 3000:60 is 0.3% at spacing 60",
    );
  }

  return { fee, tickSpacing };
}

const FACTORY = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
  "function feeAmountTickSpacing(uint24 fee) view returns (int24)",
]);
const SLIPSTREAM_FACTORY = parseAbi([
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)",
  "function tickSpacings() view returns (int24[])",
]);
/** The reads every V3-style pool shares. Their `slot0` structs differ after the tick (PancakeSwap's
 *  `feeProtocol` is wider, Slipstream's is gone), so only the first two words are decoded. */
const POOL = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick)",
  "function liquidity() view returns (uint128)",
  "function fee() view returns (uint24)",
  "function tickSpacing() view returns (int24)",
  "function tickBitmap(int16 wordPosition) view returns (uint256)",
  // Every fork's tick struct starts with these two, whatever follows.
  "function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet)",
]);
const STATE_VIEW = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
  "function getTickBitmap(bytes32 poolId, int16 tick) view returns (uint256)",
  "function getTickLiquidity(bytes32 poolId, int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet)",
]);

const call = (address: Address, abi: Abi, functionName: string, args?: readonly unknown[]) =>
  ({ address, abi, functionName, ...(args === undefined ? {} : { args }) }) as ViewCall;

/** A hookless V4 pool's id: `keccak256(abi.encode(PoolKey))`. */
export function v4PoolId(currency0: Address, currency1: Address, key: V4Key): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [currency0, currency1, key.fee, key.tickSpacing, zeroAddress],
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// The arithmetic: a pool's state as prices, both ways round, before and after its fee
// ---------------------------------------------------------------------------------------------

const Q96 = 1n << 96n;
const Q192 = 1n << 192n;
const PPM = 1_000_000n;
const E18 = 10n ** 18n;

/** `numerator / denominator` to `places` decimal places, rounded half up, without trailing zeros. */
export function decimalOf(numerator: bigint, denominator: bigint, places: number): string {
  const unit = 10n ** BigInt(places);
  const rounded = (2n * numerator * unit + denominator) / (2n * denominator);
  const whole = rounded / unit;
  const fraction = (rounded % unit).toString().padStart(places, "0").replace(/0+$/, "");

  return fraction === "" ? whole.toString() : `${whole}.${fraction}`;
}

/** `numerator / denominator` to `digits` significant digits (a whole number in full), for a
 *  person: 151.234, 0.00661225. */
export function significant(numerator: bigint, denominator: bigint, digits = 6): string {
  if (numerator === 0n) return "0";
  const floor = 10n ** BigInt(digits - 1);
  let places = 0;
  while (places < 60 && (numerator * 10n ** BigInt(places)) / denominator < floor) places++;

  return decimalOf(numerator, denominator, places);
}

/** A decimal string to `digits` significant digits, for a person. */
export function shortDecimal(text: string, digits = 6): string {
  const [whole = "0", fraction = ""] = text.split(".");

  return significant(BigInt(`${whole}${fraction}`), 10n ** BigInt(fraction.length), digits);
}

/** `floor(sqrt(value))`. */
function sqrtFloor(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }

  return x;
}

/** √1.01, times 1e18: the sqrt price's step for a 1% move. */
const ROOT_101 = sqrtFloor(101n * 10n ** 34n);

/** TickMath's factors: √1.0001^-(2^i), times 2^128, for i = 0 … 19. */
const TICK_FACTORS = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
] as const;

/** The sqrt price at `tick`, as a pool computes it (`TickMath.getSqrtRatioAtTick`). */
export function sqrtPriceAtTick(tick: number): bigint {
  const abs = Math.abs(tick);
  if (!Number.isInteger(tick) || abs > 887_272)
    throw new RangeError(`tick ${tick} is out of range`);
  let ratio = 1n << 128n;
  TICK_FACTORS.forEach((factor, bit) => {
    if ((abs & (1 << bit)) !== 0) ratio = bit === 0 ? factor : (ratio * factor) >> 128n;
  });
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;

  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

/** An initialized tick near a pool's price, and the liquidity crossing it adds going up. */
export interface TickLiquidity {
  readonly tick: number;
  readonly liquidityNet: bigint;
}

/**
 * How much of the token paid moves a pool's price 1% against the taker, before the fee, walking
 * its liquidity through `ticks` (every initialized tick within 1% of the price). Paying token1
 * lifts the price, crossing ticks above it; paying token0 lowers it, crossing those at or below.
 */
export function depthToMove1Pct(
  state: { readonly sqrtPriceX96: bigint; readonly liquidity: bigint; readonly tick: number },
  ticks: readonly TickLiquidity[],
  paysToken1: boolean,
): bigint {
  let sqrt = state.sqrtPriceX96;
  let liquidity = state.liquidity;
  let amount = 0n;
  // Rounded up, as a pool rounds what it is paid.
  const up = (n: bigint, d: bigint) => (n + d - 1n) / d;
  if (paysToken1) {
    const target = (sqrt * ROOT_101) / E18;
    const crossed = ticks.filter((each) => each.tick > state.tick).sort((x, y) => x.tick - y.tick);
    for (const { tick, liquidityNet } of crossed) {
      const next = sqrtPriceAtTick(tick);
      if (next >= target) break;
      amount += up(liquidity * (next - sqrt), Q96);
      sqrt = next;
      liquidity = liquidity + liquidityNet < 0n ? 0n : liquidity + liquidityNet;
    }

    return amount + up(liquidity * (target - sqrt), Q96);
  }
  const target = (sqrt * E18) / ROOT_101;
  const crossed = ticks.filter((each) => each.tick <= state.tick).sort((x, y) => y.tick - x.tick);
  for (const { tick, liquidityNet } of crossed) {
    const next = sqrtPriceAtTick(tick);
    if (next <= target) break;
    amount += up(liquidity * Q96 * (sqrt - next), sqrt * next);
    sqrt = next;
    liquidity = liquidity - liquidityNet < 0n ? 0n : liquidity - liquidityNet;
  }

  return amount + up(liquidity * Q96 * (sqrt - target), sqrt * target);
}

/** One direction of trade at a pool: paying one token for the other. */
export interface PoolSide {
  readonly pay: PriceToken;
  readonly buy: PriceToken;
  /** What a taker pays, in millionths: the pool's fee (V4: its LP fee and protocol fee). */
  readonly feePpm: number;
  /** Pay tokens per buy token at the pool's price, in whole tokens, before the fee, to 18
   *  significant digits. */
  readonly mid: string;
  /** The same with the fee paid: what a unit costs a taker now. */
  readonly taker: string;
  /**
   * The taker price as the distributed swap's `maxPrice`: pay base units per buy base unit, times
   * 1e18 — the price in whole tokens times 10^(18 + pay decimals − buy decimals) — rounded up. The
   * pool sells only to a `maxPrice` above it.
   */
  readonly maxPrice: bigint;
  /** Whole pay tokens, fee included, a taker spends before the price moves 1% against them,
   *  through the pool's ticks; absent where they could not be read. */
  readonly depth1Pct?: string;
}

/**
 * The two sides of a pool of `a` and `b`: paying `a` for `b`, then `b` for `a`. `feePpm` is what a
 * taker pays each way, `[a for b, b for a]`; `ticks`, the pool's initialized ticks within 1% of its
 * price, gives each side its depth.
 */
export function poolSides(
  a: PriceToken,
  b: PriceToken,
  state: { readonly sqrtPriceX96: bigint; readonly liquidity: bigint; readonly tick: number },
  feePpm: readonly [number, number],
  ticks?: readonly TickLiquidity[],
): [PoolSide, PoolSide] {
  const square = state.sqrtPriceX96 * state.sqrtPriceX96;
  const side = (pay: PriceToken, buy: PriceToken, fee: number): PoolSide => {
    const buysToken0 = BigInt(buy.address) < BigInt(pay.address);
    // Pay base units per buy base unit, as numerator / denominator: the pool's price is token1 per
    // token0, in base units, times 2^192.
    const [num, den] = buysToken0 ? [square, Q192] : [Q192, square];
    const keep = PPM - BigInt(fee);
    // In whole tokens: times 10^buy.decimals / 10^pay.decimals.
    const whole = (n: bigint, d: bigint) =>
      [n * 10n ** BigInt(buy.decimals), d * 10n ** BigInt(pay.decimals)] as const;
    const [midN, midD] = whole(num, den);
    const [takerN, takerD] = whole(num * PPM, den * keep);
    const unit = 10n ** BigInt(pay.decimals);

    return {
      pay,
      buy,
      feePpm: fee,
      // To 18 significant digits: a price a millionth of a cent is as exact as one of thousands.
      mid: significant(midN, midD, 18),
      taker: significant(takerN, takerD, 18),
      maxPrice: (num * PPM * E18 + den * keep - 1n) / (den * keep),
      // The pool is paid the depth with its fee on top.
      ...(ticks === undefined
        ? {}
        : {
            depth1Pct: decimalOf(
              depthToMove1Pct(state, ticks, buysToken0) * PPM,
              keep * unit,
              pay.decimals,
            ),
          }),
    };
  };

  return [side(a, b, feePpm[0]), side(b, a, feePpm[1])];
}

/**
 * A V4 pool's fee one way: its LP fee with the protocol's taken on top, as the PoolManager charges
 * it (`ProtocolFeeLibrary.calculateSwapFee`). `protocolFee` packs both directions: zero-for-one in
 * its low 12 bits, one-for-zero in the next 12.
 */
export function v4SwapFee(lpFee: number, protocolFee: number, zeroForOne: boolean): number {
  const protocol = zeroForOne ? protocolFee & 0xfff : protocolFee >>> 12;

  return protocol === 0 ? lpFee : protocol + lpFee - Math.floor((protocol * lpFee) / 1_000_000);
}

// ---------------------------------------------------------------------------------------------
// Reading the chain
// ---------------------------------------------------------------------------------------------

/** A pool of the pair, found and read. */
export interface Pool {
  readonly venue: Venue;
  /** A V3-style pool's address, or a V4 pool's id. */
  readonly pool: Hex;
  /** A V4 pool's key; a V3-style pool has an address instead. */
  readonly key?: {
    readonly currency0: Address;
    readonly currency1: Address;
    readonly fee: number;
    readonly tickSpacing: number;
    readonly hooks: Address;
  };
  /** The pool's fee in millionths: a V3-style pool's own, a V4 pool's LP fee. */
  readonly fee: number;
  /** Where the fee came from: the pool (`fee()`), or a V4 pool's slot0 through StateView. */
  readonly feeFrom: "pool" | "stateView";
  /** A V4 pool's protocol fee, as `getSlot0` packs it; 0 elsewhere. */
  readonly protocolFee: number;
  readonly tickSpacing: number;
  readonly liquidity: bigint;
  readonly sqrtPriceX96: bigint;
  readonly tick: number;
  /** The initialized ticks within 1% of its price, for its depth; absent where unread. */
  readonly ticks?: readonly TickLiquidity[];
}

export interface PoolsInput {
  readonly chain: CanonicalChain;
  readonly client: PublicClient;
  /** The pair, as written: registry symbols, addresses, or addresses with `:<decimals>`. */
  readonly tokens: readonly [string, string];
  /** Hookless V4 keys to try beyond {@link STANDARD_V4_KEYS}. */
  readonly v4Keys?: readonly V4Key[];
}

/** What was asked of each venue: the tiers, spacings or keys a pool of the pair was looked for at. */
interface Checked {
  readonly venue: Venue;
  /** Fee tiers the factory enables, spacings it enables, or keys tried. */
  readonly at: readonly string[];
  /** Why the venue could not be read, when it could not. */
  readonly error?: string;
}

const value = <T>(result: ViewResult | undefined): T | undefined =>
  result?.ok === true ? (result.value as T) : undefined;

/** `sauce pools`: the pair's pools on the chain, deepest first. */
export async function poolsCommand(input: PoolsInput): Promise<CommandOutput> {
  const { chain, client } = input;
  if (chain.kind !== "evm") {
    throw new UsageError(
      `sauce pools lists Uniswap V3- and V4-style pools, on an EVM chain; ${chain.slug} has none`,
    );
  }
  const extra = input.v4Keys ?? [];
  if (extra.length > MAX_V4_KEYS) throw new UsageError(`at most ${MAX_V4_KEYS} V4 keys`);
  const venues = venuesOn(chain);
  const [first, second] = input.tokens.map((raw) => {
    const token = tokenGiven(raw, chain);

    return typeof token === "string" ? token : token.address;
  }) as [Address, Address];
  if (first === second) throw new UsageError(`a pool is of two tokens: ${input.tokens[0]} is both`);
  const checked: Checked[] = [];
  const found: Array<{ venue: Venue; pool: Address }> = [];

  // 1. The V3-style factories' pools at every tier, and Slipstream's tick spacings — beside the
  // tokens' decimals and symbols, where the chain is asked for them.
  const v3 = venues.filter((venue) => venue.kind === "v3");
  const slipstream = venues.filter((venue) => venue.kind === "slipstream");
  const [tokens, factories] = await Promise.all([
    resolvePriceTokens(input.tokens, chain, client),
    readAll(client, "the pools' factories", [
      ...v3.flatMap((venue) =>
        V3_FEES.flatMap((fee) => [
          call(venue.address, FACTORY, "feeAmountTickSpacing", [fee]),
          call(venue.address, FACTORY, "getPool", [first, second, fee]),
        ]),
      ),
      ...slipstream.map((venue) => call(venue.address, SLIPSTREAM_FACTORY, "tickSpacings")),
    ]),
  ]);
  const [a, b] = tokens as [PriceToken, PriceToken];
  const [token0, token1] = BigInt(a.address) < BigInt(b.address) ? [a, b] : [b, a];
  v3.forEach((venue, index) => {
    const answers = factories.slice(index * 2 * V3_FEES.length, (index + 1) * 2 * V3_FEES.length);
    const tiers = answers.filter((_, at) => at % 2 === 0);
    const byTier = answers.filter((_, at) => at % 2 === 1);
    // A factory that answers no lookup is unread; one that does not say its tiers was asked them all.
    const unread = byTier.every((answer) => !answer.ok) ? byTier[0] : undefined;
    const enabled = tiers.every((answer) => answer.ok)
      ? V3_FEES.filter((_, at) => (value<number>(tiers[at]) ?? 0) > 0)
      : V3_FEES;
    checked.push({
      venue,
      at: enabled.map(String),
      ...(unread?.ok === false ? { error: unread.error } : {}),
    });
    byTier.forEach((answer) => {
      const pool = value<Address>(answer);
      if (pool !== undefined && pool !== zeroAddress) found.push({ venue, pool });
    });
  });
  const spacings = slipstream.map((venue, index) => {
    const answer = factories[v3.length * 2 * V3_FEES.length + index];
    const each = (value<readonly number[]>(answer) ?? []).map(Number);
    checked.push({
      venue,
      at: each.map(String),
      ...(answer?.ok === false ? { error: answer.error } : {}),
    });

    return each;
  });

  // 2. Slipstream's pools, at each spacing its factory enables.
  const lookups = slipstream.flatMap((venue, index) =>
    spacings[index]!.map((spacing) => ({ venue, spacing })),
  );
  const bySpacing = await readAll(
    client,
    "Slipstream's pools",
    lookups.map(({ venue, spacing }) =>
      call(venue.address, SLIPSTREAM_FACTORY, "getPool", [first, second, spacing]),
    ),
  );
  lookups.forEach(({ venue }, index) => {
    const pool = value<Address>(bySpacing[index]);
    if (pool !== undefined && pool !== zeroAddress) found.push({ venue, pool });
  });

  // 3. Every pool's state: the V3-style pools found, and V4's at each key.
  const keys = [...STANDARD_V4_KEYS];
  for (const key of extra) {
    if (!keys.some((k) => k.fee === key.fee && k.tickSpacing === key.tickSpacing)) keys.push(key);
  }
  const stateViews = venues.filter((venue) => venue.kind === "v4");
  const v4 = stateViews.flatMap((venue) =>
    keys.map((key) => ({ venue, key, id: v4PoolId(token0.address, token1.address, key) })),
  );
  const unique = found.filter(
    (each, index) => found.findIndex((other) => other.pool === each.pool) === index,
  );
  const third = await readAll(client, "the pools", [
    ...unique.flatMap(({ pool }) =>
      (["slot0", "liquidity", "fee", "tickSpacing"] as const).map((read) => call(pool, POOL, read)),
    ),
    ...v4.flatMap(({ venue, id }) => [
      call(venue.address, STATE_VIEW, "getSlot0", [id]),
      call(venue.address, STATE_VIEW, "getLiquidity", [id]),
    ]),
  ]);
  const pools: Pool[] = [];
  const unread: string[] = [];
  const v4Failed = new Map<Venue, string>();
  unique.forEach(({ venue, pool }, index) => {
    const [slot0, liquidity, fee, spacing] = third.slice(4 * index, 4 * index + 4);
    const failed = [slot0, liquidity, fee, spacing].find((answer) => answer?.ok !== true);
    if (failed?.ok === false) {
      unread.push(`${venue.name} pool ${pool}: ${failed.error}`);
      return;
    }
    const [sqrtPriceX96, tick] = value<readonly [bigint, number]>(slot0)!;
    pools.push({
      venue,
      pool,
      fee: Number(value<number>(fee)),
      feeFrom: "pool",
      protocolFee: 0,
      tickSpacing: Number(value<number>(spacing)),
      liquidity: value<bigint>(liquidity)!,
      sqrtPriceX96,
      tick: Number(tick),
    });
  });
  v4.forEach(({ venue, key, id }, index) => {
    const [slot0, liquidity] = third.slice(4 * unique.length + 2 * index);
    if (slot0?.ok !== true || liquidity?.ok !== true) {
      // StateView answers every id, a pool or not: a failure is the venue's, not the key's.
      v4Failed.set(
        venue,
        slot0?.ok === false ? slot0.error : (liquidity as { error: string }).error,
      );
      return;
    }
    const [sqrtPriceX96, tick, protocolFee, lpFee] =
      value<readonly [bigint, number, number, number]>(slot0)!;
    // A V4 pool exists once initialized: no price, no pool.
    if (sqrtPriceX96 === 0n) return;
    pools.push({
      venue,
      pool: id,
      key: {
        currency0: token0.address,
        currency1: token1.address,
        fee: key.fee,
        tickSpacing: key.tickSpacing,
        hooks: zeroAddress,
      },
      fee: Number(lpFee),
      feeFrom: "stateView",
      protocolFee: Number(protocolFee),
      tickSpacing: key.tickSpacing,
      liquidity: value<bigint>(liquidity)!,
      sqrtPriceX96,
      tick: Number(tick),
    });
  });

  for (const venue of stateViews) {
    const error = v4Failed.get(venue);
    checked.push({
      venue,
      at: keys.map((key) => `${key.fee}:${key.tickSpacing}`),
      ...(error === undefined ? {} : { error }),
    });
  }

  return report({
    chain,
    a,
    b,
    token0,
    token1,
    venues,
    pools: await withTicks(client, pools, unread),
    checked,
    unread,
  });
}

/** Ticks either side of a price that a 1% move can reach: log(1.01) / log(1.0001) is 99.5. */
const BAND = 101;

/**
 * `pools` with the ticks a 1% move from each live pool's price can cross, in two requests: the
 * tick bitmap words around its price, then the liquidity of each tick set in them.
 */
async function withTicks(
  client: PublicClient,
  pools: readonly Pool[],
  unread: string[],
): Promise<Pool[]> {
  const live = pools.filter((pool) => emptiness(pool) === undefined);
  // A tick's bit is at (tick / spacing, floored) in word (that >> 8).
  const compress = (tick: number, spacing: number) => Math.floor(tick / spacing);
  const words = live.map((pool) => {
    const [low, high] = [-BAND, BAND].map((d) => compress(pool.tick + d, pool.tickSpacing) >> 8);

    return Array.from({ length: high! - low! + 1 }, (_, index) => low! + index);
  });
  const bitmapOf = (pool: Pool, word: number) =>
    pool.key === undefined
      ? call(pool.pool as Address, POOL, "tickBitmap", [word])
      : call(pool.venue.address, STATE_VIEW, "getTickBitmap", [pool.pool, word]);
  const bitmaps = await readAll(
    client,
    "the pools' tick bitmaps",
    live.flatMap((pool, index) => words[index]!.map((word) => bitmapOf(pool, word))),
  );
  let at = 0;
  const set = live.map((pool, index) => {
    const ticks: number[] = [];
    let failed = false;
    for (const word of words[index]!) {
      const bits = value<bigint>(bitmaps[at++]);
      if (bits === undefined) failed = true;
      for (let bit = 0; bits !== undefined && bit < 256; bit++) {
        if (((bits >> BigInt(bit)) & 1n) === 0n) continue;
        const tick = (word * 256 + bit) * pool.tickSpacing;
        if (Math.abs(tick - pool.tick) <= BAND) ticks.push(tick);
      }
    }

    return failed ? undefined : ticks;
  });
  const liquidityOf = (pool: Pool, tick: number) =>
    pool.key === undefined
      ? call(pool.pool as Address, POOL, "ticks", [tick])
      : call(pool.venue.address, STATE_VIEW, "getTickLiquidity", [pool.pool, tick]);
  const nets = await readAll(
    client,
    "the pools' ticks",
    live.flatMap((pool, index) => (set[index] ?? []).map((tick) => liquidityOf(pool, tick))),
  );
  at = 0;
  const near = new Map<Pool, readonly TickLiquidity[] | undefined>();
  live.forEach((pool, index) => {
    const ticks = set[index];
    const read = (ticks ?? []).map((tick) => {
      const answer = value<readonly [bigint, bigint]>(nets[at++]);

      return answer === undefined ? undefined : { tick, liquidityNet: answer[1] };
    });
    if (ticks === undefined || read.some((each) => each === undefined)) {
      unread.push(`${pool.venue.name} pool ${pool.pool}'s ticks: its depth is left out`);
      near.set(pool, undefined);
    } else {
      near.set(pool, read as TickLiquidity[]);
    }
  });

  return pools.map((pool) => {
    const ticks = near.get(pool);

    return ticks === undefined ? pool : { ...pool, ticks };
  });
}

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

const percent = (ppm: number): string => `${significant(BigInt(ppm), 10_000n, 4)}%`;

/** Where a pool stands: listed with its prices, or empty and why. */
const emptiness = (pool: Pool): string | undefined =>
  pool.sqrtPriceX96 === 0n
    ? "not initialized: it has no price"
    : pool.liquidity === 0n
      ? "no liquidity at its price"
      : pool.fee >= 1_000_000
        ? "its fee is 100%: nothing paid reaches the pool"
        : undefined;

function report(found: {
  readonly chain: CanonicalChain;
  readonly a: PriceToken;
  readonly b: PriceToken;
  readonly token0: PriceToken;
  readonly token1: PriceToken;
  readonly venues: readonly Venue[];
  readonly pools: readonly Pool[];
  readonly checked: readonly Checked[];
  readonly unread: readonly string[];
}): CommandOutput {
  const { chain, a, b, token0, token1 } = found;
  // Deepest first: by the liquidity at each pool's current price, which for one pair is in the
  // same units at every venue (√(token0 · token1) base units). Ties by the lower fee.
  const live = found.pools
    .filter((pool) => emptiness(pool) === undefined)
    .sort((x, y) =>
      x.liquidity === y.liquidity ? x.fee - y.fee : x.liquidity > y.liquidity ? -1 : 1,
    );
  const empty = found.pools.filter((pool) => emptiness(pool) !== undefined);
  const sidesOf = (pool: Pool) => {
    // Paying a for b sells token0 exactly when a is token0.
    const aSellsToken0 = a.address === token0.address;
    const fees: [number, number] =
      pool.feeFrom === "stateView"
        ? [
            v4SwapFee(pool.fee, pool.protocolFee, aSellsToken0),
            v4SwapFee(pool.fee, pool.protocolFee, !aSellsToken0),
          ]
        : [pool.fee, pool.fee];

    return poolSides(a, b, pool, fees, pool.ticks);
  };
  const where = (pool: Pool) => ({
    venue: pool.venue.name,
    contract: pool.venue.contract,
    contractAddress: pool.venue.address,
    ...(pool.key === undefined ? { pool: pool.pool } : { poolId: pool.pool, key: pool.key }),
    fee: pool.fee,
    ...(pool.feeFrom === "stateView" ? { protocolFee: pool.protocolFee } : {}),
    tickSpacing: pool.tickSpacing,
    liquidity: pool.liquidity.toString(),
    sqrtPriceX96: pool.sqrtPriceX96.toString(),
    tick: pool.tick,
  });
  const tokenJson = (token: PriceToken) => ({
    ...token,
    position: token.address === token0.address ? "token0" : "token1",
  });
  const json = {
    chain: chain.slug,
    tokens: [tokenJson(a), tokenJson(b)],
    sortedBy: "liquidity",
    units: {
      fee: "millionths of the amount paid: 500 is 0.05%",
      mid: "pay tokens per buy token, in whole tokens, at the pool's price before its fee (18 significant digits)",
      taker: "the same with the fee: what a unit costs a taker now",
      maxPrice:
        "the taker price as the distributed swap's maxPrice: pay base units per buy base unit, " +
        "times 1e18 (the price times 10^(18 + pay decimals - buy decimals)), rounded up",
      depth1Pct:
        "whole pay tokens, fee included, a taker spends before the pool's price is 1% worse, " +
        "through its ticks",
    },
    pools: live.map((pool) => ({
      ...where(pool),
      sides: sidesOf(pool).map((side) => ({
        pay: side.pay.symbol,
        buy: side.buy.symbol,
        feePpm: side.feePpm,
        mid: side.mid,
        taker: side.taker,
        means: `${side.taker} ${side.pay.symbol} per ${side.buy.symbol}, fee included`,
        maxPrice: side.maxPrice.toString(),
        depth1Pct: side.depth1Pct ?? null,
      })),
    })),
    empty: empty.map((pool) => ({ ...where(pool), why: emptiness(pool) })),
    checked: found.checked.map((each) => ({
      venue: each.venue.name,
      contract: each.venue.contract,
      address: each.venue.address,
      kind: each.venue.kind,
      [each.venue.kind === "v3"
        ? "fees"
        : each.venue.kind === "slipstream"
          ? "tickSpacings"
          : "keys"]: each.at,
      ...(each.error === undefined ? {} : { error: each.error }),
    })),
  };

  const tokenLine = (token: PriceToken) =>
    `  ${(token.address === token0.address ? "token0" : "token1").padEnd(6)}  ` +
    `${token.symbol.padEnd(Math.max(a.symbol.length, b.symbol.length))}  ${token.address}  ` +
    `${token.decimals} decimals${token.readFromChain === true ? ", read from the token" : ""}`;
  const human = (side: PoolSide, text: string) => `${shortDecimal(text)} ${side.pay.symbol}`;
  const feeText = (pool: Pool) =>
    `fee ${percent(pool.fee)}` +
    (pool.feeFrom === "stateView"
      ? pool.protocolFee === 0
        ? " (LP fee read through StateView; no protocol fee)"
        : (pool.protocolFee & 0xfff) === pool.protocolFee >>> 12
          ? ` + protocol fee ${percent(pool.protocolFee & 0xfff)}`
          : ` + protocol fee ${percent(pool.protocolFee & 0xfff)} selling token0, ` +
            `${percent(pool.protocolFee >>> 12)} selling token1`
      : " (read from the pool)");
  const name = (pool: Pool) =>
    pool.key === undefined
      ? `${pool.venue.name} ${pool.pool}`
      : `${pool.venue.name} key ${pool.key.fee}:${pool.key.tickSpacing} (pool id ${pool.pool})`;
  const lines = [
    `${a.symbol}/${b.symbol} on ${chain.slug}: ${live.length} pool${live.length === 1 ? "" : "s"} ` +
      `with liquidity, deepest first (by liquidity at the pool's price)`,
    tokenLine(token0),
    tokenLine(token1),
    ...live.flatMap((pool, index) => {
      const indent = " ".repeat(String(live.length).length + 2);

      return [
        "",
        `${`${index + 1}.`.padEnd(indent.length)}${name(pool)}`,
        `${indent}${pool.venue.contract} ${pool.venue.address}`,
        `${indent}${feeText(pool)}, tick spacing ${pool.tickSpacing}, ` +
          `liquidity ${pool.liquidity}, tick ${pool.tick}`,
        `${indent}sqrtPriceX96  ${pool.sqrtPriceX96}`,
        ...sidesOf(pool).flatMap((side) => {
          const label = `buy ${side.buy.symbol} with ${side.pay.symbol}`;

          return [
            `${indent}${label}  ${human(side, side.taker)} each, ` +
              `${shortDecimal(side.mid)} before the fee` +
              (side.depth1Pct === undefined ? "" : `; ${human(side, side.depth1Pct)} moves it 1%`),
            `${indent}${" ".repeat(label.length)}  maxPrice ${side.maxPrice}`,
          ];
        }),
      ];
    }),
    ...(empty.length === 0
      ? []
      : [
          "",
          `No liquidity at their price, skipped (${empty.length}):`,
          ...empty.map((pool) => `  ${name(pool)}  fee ${percent(pool.fee)}: ${emptiness(pool)}`),
        ]),
    "",
    found.venues.length === 0
      ? `${chain.slug} has none of the venues this lists (Uniswap V3 and V4, PancakeSwap V3, ` +
        "Aerodrome Slipstream) in the registry"
      : "Looked at:",
    ...found.checked.map(
      (each) =>
        `  ${each.venue.contract} ${each.venue.address}: ` +
        (each.error !== undefined
          ? `could not be read (${each.error})`
          : each.venue.kind === "v3"
            ? `fee tiers ${each.at.join(", ")}`
            : each.venue.kind === "slipstream"
              ? `tick spacings ${each.at.join(", ")}`
              : `hookless keys ${each.at.join(", ")}`),
    ),
    ...(live.length === 0
      ? []
      : [
          "",
          "maxPrice is the price as the distributed swap takes it: pay base units per buy base",
          "unit, times 1e18, fee included, at the pool's price now. A pool sells to a program only",
          "while its price with its fee is below the maxPrice given. What moves it 1% is what a",
          "taker pays, fee included, before the pool's price is 1% worse, through its ticks.",
        ]),
  ];

  return {
    text: lines.join("\n"),
    json,
    ...(found.unread.length === 0
      ? {}
      : { notes: found.unread.map((each) => `could not read the ${each}`) }),
  };
}
