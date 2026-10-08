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
 * The venues `@sauce/router` swaps an exact input at write theirs the same way, with no divisor: the
 * venue takes the whole amount, and the data carries the floor where the venue's swap takes one.
 *
 * `routerSvmAccountOrder` (`router-accounts.ts`) gives the same instruction's accounts.
 */
import type { RouterSvmExactInVenue, RouterSvmVenue } from "./router-accounts.js";

export interface RouterSvmDataOptions {
  /**
   * The swap pays the pool's first token: token 0 or A, Invariant's X, a market's base;
   * `routerSvmAccountOrder`'s `aToB`. At a staking or vault venue, the stake or deposit.
   */
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
  /** Perena: the indices among the pool's tokens of the one paid and the one bought, a byte each. */
  readonly inIndex?: bigint;
  readonly outIndex?: bigint;
  /** Deriverse: the instrument's id, 32 bits. */
  readonly instrId?: bigint;
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

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
/** A flag's byte, in hex. */
const bit = (on: boolean): string => (on ? "01" : "00");

/** The exact-input venues' instructions, the selling and buying of a launchpad or Scale pool. */
const SELL = "33e685a4017f83ad";
const BUY = "66063d1201daebea";
/** Bonkswap's and Guacswap's price limit past the amount, one the swap never reaches, and whether
 *  the swap sells X: 0 selling X (the price only falls), u128's most buying it. */
const NEVER_SELLING_X = `${"00".repeat(16)}01`;
const NEVER_BUYING_X = `${"ff".repeat(16)}00`;
/** Hadron's deadline, one that never passes: i64's most. */
const NEVER = "ffffffffffffff7f";

/** What an exact-input venue's `data` writes from: the direction, the floor's eight bytes in hex,
 *  and a further field of `width` bytes, checked. */
interface ExactInFields {
  readonly aToB: boolean;
  readonly floor: string;
  readonly field: (name: "inIndex" | "outIndex" | "instrId", width: number) => string;
}

/** An exact-input venue's data, as `<venue>Data` writes it. */
interface ExactInData {
  /** The options past `aToB` its swap's data carries. */
  readonly takes: readonly (keyof RouterSvmDataOptions)[];
  /** Why it swaps only the first way, where it does. */
  readonly oneWay?: string;
  /** The data before the amount and after it, in hex. */
  readonly data: (fields: ExactInFields) => readonly [prefix: string, suffix: string];
}

const EXACT_IN: { readonly [V in RouterSvmExactInVenue]: ExactInData } = {
  "raydium-cp-swap": { takes: ["minOut"], data: ({ floor }) => ["8fbe5adac41e33de", floor] },
  gamma: { takes: ["minOut"], data: ({ floor }) => ["ef52c0bba01adfdf", floor] },
  "raydium-amm-v4": { takes: ["minOut"], data: ({ floor }) => ["10", floor] },
  "orca-legacy-token-swap": { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  "orca-legacy-token-swap-stable": { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  "token-swap-v1": { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  "orca-v1": { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  penguin: { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  stepn: { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  saros: { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  fluxbeam: { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  dexlab: { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  "meteora-damm-v2": { takes: ["minOut"], data: ({ floor }) => [SWAP, floor] },
  "meteora-damm-v1-cp": { takes: ["minOut"], data: ({ floor }) => [SWAP, floor] },
  "meteora-damm-v1-stable": { takes: ["minOut"], data: ({ floor }) => [SWAP, floor] },
  aldrin: { takes: ["minOut"], data: ({ aToB, floor }) => [SWAP, floor + bit(aToB)] },
  omnipair: { takes: ["minOut"], data: ({ floor }) => [SWAP, floor] },
  "saber-stableswap": { takes: ["minOut"], data: ({ floor }) => ["01", floor] },
  "saber-decimals-wrapper": {
    takes: [],
    data: ({ aToB }) => [aToB ? "f223c68952e1f2b6" : "b712469c946da122", ""],
  },
  "stabble-stable-swap": { takes: ["minOut"], data: ({ floor }) => [`${SWAP}01`, floor] },
  "stabble-weighted-swap": { takes: ["minOut"], data: ({ floor }) => [`${SWAP}01`, floor] },
  mercurial: { takes: ["minOut"], data: ({ floor }) => ["04", floor] },
  perena: {
    takes: ["inIndex", "outIndex", "minOut"],
    data: ({ field, floor }) => [
      `68688356a1bdb4d8${field("inIndex", 1)}${field("outIndex", 1)}`,
      floor,
    ],
  },
  "metadao-futarchy": {
    takes: ["minOut"],
    data: ({ aToB, floor }) => ["a7610ce7ed4ea6fb", bit(aToB) + floor],
  },
  "scale-amm": { takes: ["minOut"], data: ({ aToB, floor }) => [aToB ? BUY : SELL, floor] },
  pumpswap: {
    takes: ["minOut"],
    data: ({ aToB, floor }) => (aToB ? [SELL, floor] : ["c62e1552b4d9e870", `${floor}00`]),
  },
  bonkswap: { takes: [], data: ({ aToB }) => [SWAP, aToB ? NEVER_SELLING_X : NEVER_BUYING_X] },
  guacswap: { takes: [], data: ({ aToB }) => [SWAP, aToB ? NEVER_SELLING_X : NEVER_BUYING_X] },
  "meteora-dlmm": { takes: ["minOut"], data: ({ floor }) => [SWAP, floor] },
  "saros-dlmm": { takes: ["minOut"], data: ({ aToB, floor }) => [SWAP, `${floor}${bit(aToB)}00`] },
  "solfi-v2": { takes: ["minOut"], data: ({ aToB, floor }) => ["07", floor + bit(!aToB)] },
  hadron: { takes: ["minOut"], data: ({ aToB, floor }) => [`03${bit(aToB)}`, floor + NEVER] },
  taurusfi: { takes: [], data: () => ["08", "0001"] },
  riptide: { takes: [], data: ({ aToB }) => ["02", `${bit(aToB)}0001`] },
  denali: {
    takes: ["minOut"],
    data: ({ aToB, floor }) => [`68688356a1bdb4d8${bit(!aToB)}`, floor],
  },
  gavel: { takes: ["minOut"], data: ({ aToB, floor }) => [`00${bit(aToB)}00`, floor] },
  tesserav: {
    takes: ["minOut"],
    oneWay: "Tessera V sells only its token A",
    data: ({ floor }) => ["1001", floor],
  },
  flint: { takes: [], data: () => ["0b", "0000"] },
  deriverse: {
    takes: ["instrId", "minOut"],
    data: ({ aToB, field, floor }) => [
      `1a${bit(!aToB)}0000${field("instrId", 4)}${"00".repeat(8)}`,
      floor,
    ],
  },
  "goonfi-v2": { takes: ["minOut"], data: ({ aToB, floor }) => [`01${bit(!aToB)}`, `${floor}00`] },
  "meteora-dbc": { takes: ["minOut"], data: ({ floor }) => [SWAP, floor] },
  trends: { takes: ["minOut"], data: ({ floor }) => [SWAP, floor] },
  heaven: { takes: ["minOut"], data: ({ aToB, floor }) => [aToB ? SELL : BUY, `${floor}00000000`] },
  virtuals: {
    takes: ["minOut"],
    oneWay: "Virtuals' buy takes the tokens bought, not what to pay",
    data: ({ floor }) => [SELL, floor],
  },
  "raydium-launchlab": {
    takes: ["minOut"],
    data: ({ aToB, floor }) => [
      aToB ? "9527de9bd37c981a" : "faea0d7bd59c13ec",
      floor + "00".repeat(8),
    ],
  },
  "runner-rodeo": { takes: ["minOut"], data: ({ floor }) => [SWAP, floor] },
  "scale-vmm": { takes: ["minOut"], data: ({ aToB, floor }) => [aToB ? BUY : SELL, floor] },
  xorca: { takes: [], oneWay: "xORCA only stakes", data: () => ["00", ""] },
  solayer: { takes: [], data: ({ aToB }) => [aToB ? "fe00de2891766e14" : "d511d75105727c4e", ""] },
  voltr: {
    takes: [],
    data: ({ aToB }) => (aToB ? ["7ee015ffe4357521", ""] : ["dd3873a880dcebf5", "0100"]),
  },
  "vault-liquid-unstake": {
    takes: [],
    oneWay: "the liquid-unstake vault only unstakes",
    data: () => ["64034fd1bf9db40b", "00"],
  },
  "hylo-stability-pool": {
    takes: [],
    data: ({ aToB }) => [aToB ? "bac68ce981276299" : "35fe1af277ed4921", "00"],
  },
  huma: {
    takes: [],
    oneWay: "Huma only deposits here",
    data: () => ["f223c68952e1f2b6", "0d0000004e4f5f434f4d4d49544d454e5400"],
  },
  "helium-treasury": {
    takes: ["minOut"],
    oneWay: "Helium's treasury only redeems",
    data: ({ floor }) => ["eb7fab8b774deb76", floor],
  },
  "jupiter-lend-earn": {
    takes: [],
    data: ({ aToB }) => [aToB ? "f223c68952e1f2b6" : "b80c569546c461e1", ""],
  },
  hylo: { takes: [], data: ({ aToB }) => [aToB ? "0e0ea31ae0b69f9b" : "aaed62683c5248a1", "00"] },
  carrot: { takes: [], data: ({ aToB }) => [aToB ? "be0162d65163def7" : "b80c569546c461e1", ""] },
};

const isExactIn = (venue: RouterSvmVenue): venue is RouterSvmExactInVenue =>
  Object.hasOwn(EXACT_IN, venue);

/** An exact-input venue's data around its amount, every other field checked and written. */
const exactInTemplate = (
  venue: RouterSvmExactInVenue,
  options: RouterSvmDataOptions,
): RouterSvmDataTemplate => {
  const { takes, oneWay, data } = EXACT_IN[venue];
  for (const name of Object.keys(options) as (keyof RouterSvmDataOptions)[])
    if (name !== "aToB" && options[name] !== undefined && !takes.includes(name))
      throw new Error(`${venue}'s swap takes no ${name}`);
  if (oneWay !== undefined && !options.aToB) throw new Error(oneWay);
  const minOut = within(venue, "minOut", options.minOut ?? 0n, U64, "64 bits");
  const field = (name: "inIndex" | "outIndex" | "instrId", width: number): string => {
    const value = options[name];
    if (value === undefined) throw new Error(`${venue}'s swap takes its ${name}`);
    const max = (1n << BigInt(8 * width)) - 1n;
    return toHex(
      le(within(venue, name, value, max, width === 1 ? "byte" : `${8 * width} bits`), width),
    );
  };
  const [prefix, suffix] = data({ aToB: options.aToB, floor: toHex(le(minOut, 8)), field });
  return { prefix: hex(prefix), suffix: hex(suffix), divisor: 1n };
};

/**
 * The data of `venue`'s swap around its amount, every other field checked and written. Throws for a
 * field the venue's instruction does not carry, or one past its slot.
 */
export function routerSvmDataTemplate(
  venue: RouterSvmVenue,
  options: RouterSvmDataOptions,
): RouterSvmDataTemplate {
  if (isExactIn(venue)) return exactInTemplate(venue, options);
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
