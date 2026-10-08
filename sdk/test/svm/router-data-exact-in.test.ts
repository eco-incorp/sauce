/**
 * `routerSvmDataTemplate` for the venues `@sauce/router` swaps an exact input at, against the
 * instructions eco-incorp/sauce-recipes builds (`std/router/fixtures/exact-in-vectors.json`; each
 * regenerates byte for byte at recipes main 57932a980): for every vector, the template written from
 * its direction and the floor the recipes write (Perena's token indices and Deriverse's instrument
 * read off its bytes) is the vector's prefix and suffix, byte for byte, around the whole amount. The
 * engine suite (`std/router/svm-exact-in.e2e.test.ts`) proves `<venue>Data` sends those same bytes;
 * this proves the TypeScript writes them too, and refuses a field past its slot, an option the
 * venue's swap does not carry, and the way a one-way venue does not swap.
 */
import { readFileSync } from "node:fs";

import { ROUTER_SVM_VENUES, routerSvmAccountOrder } from "../../src/svm/router-accounts.js";
import type { RouterSvmVenue } from "../../src/svm/router-accounts.js";
import { routerSvmDataTemplate } from "../../src/svm/router-data.js";
import type { RouterSvmDataOptions } from "../../src/svm/router-data.js";
import { svmExactInArguments } from "../std/router/harness.js";

interface Vector {
  venue: string;
  prefix: string;
  suffix: string;
  cfg: Record<string, unknown>;
  /** What the recipes divide the amount by, where it is not 1: Archer's base lot, selling base. */
  amountPatch?: { patchDivisorIn?: string };
}
const VECTORS = (
  JSON.parse(
    readFileSync(new URL("../std/router/fixtures/exact-in-vectors.json", import.meta.url), "utf8"),
  ) as { vectors: Record<string, Vector> }
).vectors;
const LIMIT_VENUES = new Set(
  (
    JSON.parse(
      readFileSync(
        new URL("../std/router/fixtures/recipes-swap-templates.json", import.meta.url),
        "utf8",
      ),
    ) as { templates: { venue: string }[] }
  ).templates.map((t) => t.venue),
);

/** Whether a vector pays the pool's first token, from the direction its key names, as
 *  `router-accounts-exact-in.test.ts` reads it. */
const FIRST: Record<string, boolean> = {
  "0to1": true,
  "1to0": false,
  coinToPc: true,
  pcToCoin: false,
  AtoB: true,
  BtoA: false,
  aToB: true,
  bToA: false,
  baseToQuote: true,
  quoteToBase: false,
  xToY: true,
  yToX: false,
  deposit: true,
  withdraw: false,
  buy: false,
  sell: true,
  "0": true,
  "1": false,
  baseIn: true,
  quoteIn: false,
  orcaToXorca: true,
  delegate: true,
  undelegate: false,
  assetToLp: true,
  lpToAsset: false,
  redeem: false,
  lstToSol: true,
  issue0: true,
  redeem0: false,
  wmToDawn: true,
  dawnToWm: true,
  solToUsdc: true,
  usdcToSol: true,
  usdc: true,
  wsolToJito: true,
  jitoToWsol: true,
  jupToSctm: true,
  sellBase: true,
  sellQuote: false,
  zeroIn: true,
  oneIn: false,
};
const PAYS_FIRST: Record<string, boolean> = { "helium-treasury:Aon7:redeem": true };

/** The floor the recipes' instruction writes where the venue's swap carries one: 1, but 0 here. */
const FLOOR: Record<string, bigint> = {
  hadron: 0n,
  denali: 0n,
  "helium-treasury": 0n,
  archer: 0n,
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const leHex = (text: string, byte: number, width: number): bigint =>
  BigInt(
    `0x${Buffer.from(text.slice(2 * byte, 2 * (byte + width)), "hex")
      .reverse()
      .toString("hex")}`,
  );

/** The arguments past the amount the venue's data carries: its `…Data`'s, or, for a venue a Pot
 *  cannot send and `@sauce/router` therefore has no function for, its instruction's. */
const INSTRUCTION_ONLY: Record<string, string[]> = {
  "one-intro-swap": ["minOut"],
  woofi: ["minOut"],
  metric: ["minOut", "aToB"],
  quantum: ["minOut", "aToB"],
  obsidian: [],
  alphaq: ["aToB"],
  "pumpfun-bonding-curve": ["minOut", "aToB"],
  "boop-fun": ["minOut", "aToB"],
  moonit: ["minOut", "aToB"],
  bisonfi: ["minOut", "aToB"],
  "sanctum-stake-pool": [],
  "sanctum-stake-pool-2": [],
  "sanctum-stake-pool-3": [],
};
const dataArguments = (venue: string): string[] => {
  const data = ROUTER_SVM_VENUES[venue as RouterSvmVenue].data;
  return data === null ? INSTRUCTION_ONLY[venue]! : svmExactInArguments(data)!;
};

const optionsOf = (key: string, vector: Vector): RouterSvmDataOptions => {
  const aToB = PAYS_FIRST[key] ?? FIRST[key.split(":").pop()!];
  if (aToB === undefined) throw new Error(`${key} names no direction`);
  const args = dataArguments(vector.venue);
  return {
    aToB,
    ...(args.includes("minOut") ? { minOut: FLOOR[vector.venue] ?? 1n } : {}),
    // Sanctum Infinity's counts and indices lead its data; Perena's indices follow its discriminator.
    ...(args.includes("inCalcAccounts")
      ? {
          inCalcAccounts: leHex(vector.prefix, 1, 1),
          outCalcAccounts: leHex(vector.prefix, 2, 1),
          inIndex: leHex(vector.prefix, 3, 4),
          outIndex: leHex(vector.prefix, 7, 4),
        }
      : args.includes("inIndex")
        ? { inIndex: leHex(vector.prefix, 8, 1), outIndex: leHex(vector.prefix, 9, 1) }
        : {}),
    ...(args.includes("instrId") ? { instrId: leHex(vector.prefix, 4, 4) } : {}),
    ...(args.includes("baseLot") ? { baseLot: BigInt(vector.cfg.baseLotSize as string) } : {}),
  };
};

/** A RangeError, with its message. */
const pastItsSlot = (write: () => unknown, message: string): void => {
  expect(write).toThrow(RangeError);
  expect(write).toThrow(message);
};

const EXACT_IN = [...new Set(Object.values(VECTORS).map((v) => v.venue))] as RouterSvmVenue[];
/** A value for each field past the amount and the floor a venue's data carries. */
const fieldsOf = (venue: string): Partial<RouterSvmDataOptions> => {
  const args = dataArguments(venue);
  return {
    ...(args.includes("inIndex") ? { inIndex: 0n, outIndex: 1n } : {}),
    ...(args.includes("inCalcAccounts") ? { inCalcAccounts: 5n, outCalcAccounts: 1n } : {}),
    ...(args.includes("instrId") ? { instrId: 1n } : {}),
    ...(args.includes("baseLot") ? { baseLot: 1n } : {}),
  };
};

describe("routerSvmDataTemplate at an exact input: the recipes' own bytes", () => {
  it.each(Object.entries(VECTORS))("%s", (key, vector) => {
    const written = routerSvmDataTemplate(vector.venue as RouterSvmVenue, optionsOf(key, vector));
    expect({
      prefix: hex(written.prefix),
      suffix: hex(written.suffix),
      divisor: String(written.divisor),
    }).toEqual({
      prefix: vector.prefix,
      suffix: vector.suffix,
      divisor: vector.amountPatch?.patchDivisorIn ?? "1",
    });
  });

  it("covers every venue: each one swaps at a limit or has the recipes' exact-input vector", () => {
    for (const venue of Object.keys(ROUTER_SVM_VENUES))
      expect([
        venue,
        LIMIT_VENUES.has(venue) || EXACT_IN.includes(venue as RouterSvmVenue),
      ]).toEqual([venue, true]);
  });
});

describe("routerSvmDataTemplate at an exact input: what it refuses when the program is written", () => {
  it.each(EXACT_IN)("%s: a floor past 64 bits, where its swap carries one", (venue) => {
    const fields = { aToB: true, ...fieldsOf(venue) };
    if (!dataArguments(venue).includes("minOut")) {
      expect(() => routerSvmDataTemplate(venue, { ...fields, minOut: 1n })).toThrow(
        `${venue}'s swap takes no minOut`,
      );
      return;
    }
    pastItsSlot(
      () => routerSvmDataTemplate(venue, { ...fields, minOut: 1n << 64n }),
      `${venue}: minOut ${1n << 64n} is past its 64 bits`,
    );
    pastItsSlot(
      () => routerSvmDataTemplate(venue, { ...fields, minOut: -1n }),
      `${venue}: minOut -1 is past its 64 bits`,
    );
    const most = routerSvmDataTemplate(venue, { ...fields, minOut: (1n << 64n) - 1n });
    expect(hex(most.prefix) + hex(most.suffix)).toContain("ff".repeat(8));
  });

  it.each(EXACT_IN)("%s: a price limit, which an exact input does not carry", (venue) => {
    expect(() =>
      routerSvmDataTemplate(venue, { aToB: true, ...fieldsOf(venue), limit: 1n }),
    ).toThrow(`${venue}'s swap takes no limit`);
  });

  it.each(EXACT_IN)("%s: the way it does not swap, as its account order refuses it", (venue) => {
    const fields = fieldsOf(venue);
    let refused: string | undefined;
    try {
      routerSvmAccountOrder(venue, { aToB: false });
    } catch (error) {
      refused = (error as Error).message;
    }
    if (refused === undefined)
      expect(() => routerSvmDataTemplate(venue, { aToB: false, ...fields })).not.toThrow();
    else expect(() => routerSvmDataTemplate(venue, { aToB: false, ...fields })).toThrow(refused);
  });

  it("Perena's token indices, a byte each, and both required", () => {
    const indices = { aToB: true, inIndex: 255n, outIndex: 254n };
    expect(hex(routerSvmDataTemplate("perena", indices).prefix)).toBe("68688356a1bdb4d8fffe");
    pastItsSlot(
      () => routerSvmDataTemplate("perena", { ...indices, inIndex: 256n }),
      "perena: inIndex 256 is past its byte",
    );
    pastItsSlot(
      () => routerSvmDataTemplate("perena", { ...indices, outIndex: 256n }),
      "perena: outIndex 256 is past its byte",
    );
    expect(() => routerSvmDataTemplate("perena", { aToB: true, inIndex: 0n })).toThrow(
      "perena's swap takes its outIndex",
    );
    expect(() => routerSvmDataTemplate("raydium-cp-swap", { aToB: true, inIndex: 0n })).toThrow(
      "raydium-cp-swap's swap takes no inIndex",
    );
  });

  it("Deriverse's instrument id, 32 bits, and required", () => {
    const most = routerSvmDataTemplate("deriverse", {
      aToB: true,
      instrId: (1n << 32n) - 1n,
    });
    expect(hex(most.prefix)).toBe(`1a000000ffffffff${"00".repeat(8)}`);
    pastItsSlot(
      () => routerSvmDataTemplate("deriverse", { aToB: true, instrId: 1n << 32n }),
      `deriverse: instrId ${1n << 32n} is past its 32 bits`,
    );
    expect(() => routerSvmDataTemplate("deriverse", { aToB: true })).toThrow(
      "deriverse's swap takes its instrId",
    );
  });

  it("Sanctum Infinity's calculators' account counts, a byte each, and its tokens' indices, 32 bits", () => {
    const fields = { aToB: true, inCalcAccounts: 5n, outCalcAccounts: 1n, minOut: 1n };
    const most = routerSvmDataTemplate("sanctum-infinity", {
      ...fields,
      inIndex: (1n << 32n) - 1n,
      outIndex: 2n,
    });
    expect([hex(most.prefix), hex(most.suffix)]).toEqual([
      "170501ffffffff020000000100000000000000",
      "",
    ]);
    pastItsSlot(
      () =>
        routerSvmDataTemplate("sanctum-infinity", { ...fields, inIndex: 1n << 32n, outIndex: 0n }),
      `sanctum-infinity: inIndex ${1n << 32n} is past its 32 bits`,
    );
    pastItsSlot(
      () =>
        routerSvmDataTemplate("sanctum-infinity", {
          ...fields,
          outCalcAccounts: 256n,
          inIndex: 0n,
          outIndex: 1n,
        }),
      "sanctum-infinity: outCalcAccounts 256 is past its byte",
    );
    expect(() =>
      routerSvmDataTemplate("sanctum-infinity", { aToB: true, inIndex: 0n, outIndex: 1n }),
    ).toThrow("sanctum-infinity's swap takes its inCalcAccounts");
  });
});
