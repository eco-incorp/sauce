/**
 * The data of each Solana swap `@sauce/router` sends, for a program compiled for one trade: every
 * field but the amount is known when it compiles, so they are written here, checked here, and the
 * program carries them as two byte strings around the amount. The swap's data is
 *
 *   prefix ‖ (amountIn ÷ divisor), 8 bytes little-endian ‖ suffix
 *
 * byte for byte what `router.svm.js`'s `<venue>Data` builds on chain for the same fields, and what
 * eco-incorp/sauce-recipes' templates carry. A field its slot cannot carry throws here, when the
 * program is generated: the check `<venue>Data` makes on every swap (a floor past 64 bits, a sqrt
 * price limit past 128, which cut to its field would be no limit at all) runs once, before the
 * program exists, and costs the program nothing.
 *
 * `routerSvmAccountOrder` (`router-accounts.ts`) gives the same instruction's accounts.
 */
import type { RouterSvmVenue } from "./router-accounts.js";

export interface RouterSvmDataOptions {
  /** The swap pays the pool's first token: token 0 or A, Invariant's X, a market's base. */
  readonly aToB: boolean;
  /**
   * The pool's own limit: a Q64.64 sqrt price on the concentrated-liquidity venues, a sqrt price
   * times 10^24 on Invariant. 0, or absent, is none, where the venue takes that.
   */
  readonly limit?: bigint;
  /** The least the venue may deliver, where its instruction carries one. 0, or absent, is none. */
  readonly minOut?: bigint;
  /** Orca Whirlpools: its `swap_v2`, in place of the classic `swap`. */
  readonly v2?: boolean;
  /** Phoenix: the order's price in the market's ticks; 0, or absent, takes the book at any price. */
  readonly ticks?: bigint;
  /** Phoenix: the market's lot size of the token paid. */
  readonly lot?: bigint;
  /** OpenBook v2: the market's base and quote lot sizes. */
  readonly baseLot?: bigint;
  readonly quoteLot?: bigint;
  /** OpenBook v2: the order's price in lots (0, or absent: a market order), and the most resting
   *  orders it may match. */
  readonly priceLots?: bigint;
  readonly orders?: bigint;
}

/** A swap's data around its amount: `prefix ‖ u64le(amountIn / divisor) ‖ suffix`. */
export interface RouterSvmDataTemplate {
  readonly prefix: Uint8Array;
  readonly suffix: Uint8Array;
  readonly divisor: bigint;
}

const U64 = (1n << 64n) - 1n;
const U128 = (1n << 128n) - 1n;
const I64 = (1n << 63n) - 1n;

const hex = (text: string): Uint8Array =>
  Uint8Array.from({ length: text.length / 2 }, (_, i) =>
    parseInt(text.slice(2 * i, 2 * i + 2), 16),
  );
const le = (value: bigint, bytes: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = Number((value >> BigInt(8 * i)) & 0xffn);
  return out;
};
const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
const flag = (on: boolean): Uint8Array => Uint8Array.of(on ? 1 : 0);

const SWAP = "f8c69e91e17587c8";
const SWAP_V2 = "2b04ed0b1ac91e62";
const PLACE_TAKE_ORDER = "032c47031ac7cb55";
/** Phoenix's order past its sizes: no minimum fill, a self-trade cancels the resting order, no match
 *  limit, client id 0, no deposited funds, no expiry. */
const PHOENIX_REST = `${"00".repeat(16)}01${"00".repeat(20)}`;

/** `name` within `[0, max]`, or a RangeError naming the field. */
const within = (venue: string, name: string, value: bigint, max: bigint, field: string): bigint => {
  if (value < 0n || value > max) {
    throw new RangeError(`${venue}: ${name} ${value} is past its ${field}`);
  }
  return value;
};

/**
 * The data of `venue`'s swap around its amount, every other field checked and written. Throws for a
 * field the venue's instruction does not carry, or one past its slot.
 */
export function routerSvmDataTemplate(
  venue: RouterSvmVenue,
  options: RouterSvmDataOptions,
): RouterSvmDataTemplate {
  const { aToB } = options;
  const takes = (names: (keyof RouterSvmDataOptions)[]): void => {
    for (const name of Object.keys(options) as (keyof RouterSvmDataOptions)[])
      if (name !== "aToB" && options[name] !== undefined && !names.includes(name))
        throw new Error(`${venue}'s swap takes no ${name}`);
  };
  const minOut = within(venue, "minOut", options.minOut ?? 0n, U64, "64 bits");
  const limit = within(venue, "limit", options.limit ?? 0n, U128, "128 bits");
  // The concentrated-liquidity order: the floor and the limit, little-endian.
  const order = join(le(minOut, 8), le(limit, 16));
  switch (venue) {
    case "raydium-clmm":
    case "pancakeswap-clmm":
    case "byreal":
    case "stabble-clmm":
      takes(["limit", "minOut"]);
      return { prefix: hex(SWAP_V2), suffix: join(order, hex("01")), divisor: 1n };
    case "orca-whirlpool":
      takes(["limit", "minOut", "v2"]);
      return options.v2 === true
        ? {
            prefix: hex(SWAP_V2),
            suffix: join(order, hex("01"), flag(aToB), hex("00")),
            divisor: 1n,
          }
        : { prefix: hex(SWAP), suffix: join(order, hex("01"), flag(aToB)), divisor: 1n };
    case "cropper":
      takes(["limit", "minOut"]);
      return { prefix: hex(SWAP), suffix: join(order, hex("01"), flag(aToB)), divisor: 1n };
    case "defituna":
      takes(["limit", "minOut"]);
      return {
        prefix: hex(SWAP),
        suffix: join(order, hex("01"), flag(aToB), hex("00")),
        divisor: 1n,
      };
    case "crema":
      takes(["limit", "minOut"]);
      return { prefix: join(hex(SWAP), flag(aToB), hex("01")), suffix: order, divisor: 1n };
    case "invariant":
      takes(["limit"]);
      return {
        prefix: join(hex(SWAP), flag(aToB)),
        suffix: join(hex("01"), le(limit, 16)),
        divisor: 1n,
      };
    case "manifest":
      takes(["minOut"]);
      return { prefix: hex("04"), suffix: join(le(minOut, 8), flag(aToB), hex("01")), divisor: 1n };
    case "phoenix": {
      takes(["ticks", "lot"]);
      const ticks = within(venue, "ticks", options.ticks ?? 0n, U64, "64 bits");
      const lot = options.lot;
      if (lot === undefined || lot <= 0n) throw new Error("phoenix's swap takes a lot size");
      const head = join(
        hex("0002"),
        flag(aToB),
        ticks === 0n ? hex("00") : join(hex("01"), le(ticks, 8)),
      );
      const rest = hex(PHOENIX_REST);
      // Base lots selling base, quote lots buying it; the other size 0.
      return aToB
        ? { prefix: head, suffix: join(le(0n, 8), rest), divisor: lot }
        : { prefix: join(head, le(0n, 8)), suffix: rest, divisor: lot };
    }
    case "openbook-v2": {
      takes(["baseLot", "quoteLot", "priceLots", "orders"]);
      const priceLots = within(venue, "priceLots", options.priceLots ?? 0n, I64, "63 bits");
      const orders = within(venue, "orders", options.orders ?? 0n, 255n, "byte");
      const { baseLot, quoteLot } = options;
      if (baseLot === undefined || baseLot <= 0n || quoteLot === undefined || quoteLot <= 0n)
        throw new Error("openbook-v2's swap takes the market's base and quote lot sizes");
      // A market order's price is 1 and its type 3; an order at a price is immediate-or-cancel.
      const price = le(priceLots === 0n ? 1n : priceLots, 8);
      const tail = Uint8Array.of(priceLots === 0n ? 3 : 1, Number(orders));
      const most = I64;
      return aToB
        ? {
            prefix: join(hex(PLACE_TAKE_ORDER), hex("01"), price),
            suffix: join(le(most / quoteLot, 8), tail),
            divisor: baseLot,
          }
        : {
            prefix: join(hex(PLACE_TAKE_ORDER), hex("00"), price, le(most / baseLot, 8)),
            suffix: tail,
            divisor: quoteLot,
          };
    }
    default: {
      const unknown: never = venue;
      throw new Error(`not a venue @sauce/router swaps at a limit: ${String(unknown)}`);
    }
  }
}
