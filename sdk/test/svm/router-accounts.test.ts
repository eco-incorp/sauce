/**
 * `routerSvmAccountOrder`/`routerSvmAccounts` against the swaps eco-incorp/sauce-recipes builds
 * (`std/router/fixtures/recipes-swap-templates.json`): for every template, both directions and both
 * builders, the order built from the template's own accounts by name is the template's, account for
 * account, writable for writable and signer for signer. The engine suite
 * (`std/router/svm-at-limit.e2e.test.ts`) proves `router.svm.js` sends those same instructions.
 */
import { readFileSync } from "node:fs";

import {
  ROUTER_SVM_VENUES,
  routerSvmAccountOrder,
  routerSvmAccounts,
} from "../../src/svm/router-accounts.js";
import type { RouterSvmAccountOptions, RouterSvmVenue } from "../../src/svm/router-accounts.js";
import { BYTES, le, pool } from "./venue-fixture.js";

interface Template {
  pool: string;
  venue: string;
  direction: string;
  builder: string;
  programId: string;
  accounts: { ref: string; address: string | null; writable: boolean; signer: boolean }[];
}
const TEMPLATES = (
  JSON.parse(
    readFileSync(
      new URL("../std/router/fixtures/recipes-swap-templates.json", import.meta.url),
      "utf8",
    ),
  ) as { templates: Template[] }
).templates;

const FIRST = new Set(["0to1", "aToB", "baseIn", "xToY"]);

/** The recipes' role names, by this module's names. */
const RECIPES: Record<string, Record<string, string>> = {
  raydium: {
    ammConfig: "cfg",
    observation: "obs",
    tokenProgram: "tp",
    token2022: "tp22",
    memo: "memo",
    bitmapExtension: "bmx",
  },
  whirlpool: { tokenProgram: "tp", vaultA: "va", vaultB: "vb", oracle: "orc" },
  defituna: {
    tokenProgramA: "tpa",
    tokenProgramB: "tpb",
    memo: "memo",
    mintA: "ma",
    mintB: "mb",
    vaultA: "va",
    vaultB: "vb",
  },
  crema: {
    clmmConfig: "cfg",
    mintA: "ma",
    mintB: "mb",
    vaultA: "va",
    vaultB: "vb",
    tickArrayMap: "tam",
    tokenProgram: "tp",
  },
  phoenix: {
    program: "prog",
    logAuthority: "log",
    pool: "mkt",
    vaultA: "bv",
    vaultB: "qv",
    tokenProgram: "tp",
  },
  invariant: {
    state: "state",
    tickmap: "tickmap",
    vaultA: "rx",
    vaultB: "ry",
    programAuthority: "auth",
    tokenProgram: "tp",
    tick0: "t0",
    tick1: "t1",
    tick2: "t2",
  },
  manifest: {
    pool: "mkt",
    systemProgram: "sys",
    vaultA: "bv",
    vaultB: "qv",
    tokenProgramA: "tp",
    mintA: "bm",
    tokenProgramB: "tpq",
    mintB: "qm",
  },
  openbook: {
    pool: "mkt",
    marketAuthority: "auth",
    bids: "bids",
    asks: "asks",
    vaultA: "bv",
    vaultB: "qv",
    eventHeap: "eh",
    oracleA: "oa",
    oracleB: "ob",
    tokenProgram: "tp",
    systemProgram: "sp",
    openOrdersAdmin: "ooa",
  },
};
const FAMILY: Record<string, string> = {
  "raydium-clmm": "raydium",
  "pancakeswap-clmm": "raydium",
  byreal: "raydium",
  "stabble-clmm": "raydium",
  "orca-whirlpool": "whirlpool",
  cropper: "whirlpool",
  defituna: "defituna",
  crema: "crema",
  phoenix: "phoenix",
  invariant: "invariant",
  manifest: "manifest",
  "openbook-v2": "openbook",
};

/** A template's role, without the recipes' slot prefix or a bounded swap's suffix. */
const roleOf = (ref: string): string => ref.replace(/^s0:/, "").replace(/:bounded$/, "");

/** Each of this module's names, as the template's own account. */
const refsOf = (t: Template): Record<string, string> => {
  const by = new Map(t.accounts.map((a) => [roleOf(a.ref), a.ref]));
  const first = FIRST.has(t.direction);
  const names: Record<string, string> = {
    authority: "user:owner",
    source: "user:in",
    recipient: "user:out",
    pool: "pool",
    tickArray0: "ta0",
    tickArray1: "ta1",
    tickArray2: "ta2",
    ...(FAMILY[t.venue] === "raydium"
      ? {
          vaultA: first ? "iv" : "ov",
          vaultB: first ? "ov" : "iv",
          mintA: first ? "im" : "om",
          mintB: first ? "om" : "im",
        }
      : {}),
    ...RECIPES[FAMILY[t.venue]!]!,
  };
  const refs: Record<string, string> = {};
  for (const [name, role] of Object.entries(names)) {
    const ref = role.startsWith("user:") ? role : by.get(role);
    if (ref !== undefined) refs[name] = ref;
  }
  return refs;
};

/** A whirlpool's fee is adaptive when its fee tier is not its tick spacing, as the router reads it. */
const adaptive = (t: Template): boolean => {
  const data = BYTES.get(pool(t.pool).pool)!;
  return le(data, 41, 2) !== le(data, 43, 2);
};

const optionsOf = (t: Template): RouterSvmAccountOptions => ({
  aToB: FIRST.has(t.direction),
  ...(FAMILY[t.venue] === "raydium" ? { bitmapExtension: t.accounts.length === 17 } : {}),
  ...(t.venue === "orca-whirlpool" ? { adaptive: adaptive(t) } : {}),
});

describe("routerSvmAccounts: the recipes' own account order", () => {
  it("reads one adaptive whirlpool among the fixture's", () => {
    const whirlpools = TEMPLATES.filter((t) => t.venue === "orca-whirlpool");
    expect(new Set(whirlpools.filter(adaptive).map((t) => t.pool))).toEqual(
      new Set(["orca-whirlpool-adaptive"]),
    );
  });

  it("covers every venue the fixture carries", () => {
    expect(new Set(TEMPLATES.map((t) => t.venue))).toEqual(new Set(Object.keys(ROUTER_SVM_VENUES)));
  });

  it.each(TEMPLATES.map((t) => [`${t.pool} ${t.direction} ${t.builder}`, t] as const))(
    "%s",
    (_, t) => {
      const venue = t.venue as RouterSvmVenue;
      expect(t.programId).toBe(ROUTER_SVM_VENUES[venue].program);
      const built = routerSvmAccounts(venue, optionsOf(t), refsOf(t));
      expect(built.map((a) => [a.ref, a.writable, a.signer])).toEqual(
        t.accounts.map((a) => [a.ref, a.writable, a.signer]),
      );
    },
  );
});

describe("routerSvmAccountOrder: the options", () => {
  const names = (venue: RouterSvmVenue, options: RouterSvmAccountOptions) =>
    routerSvmAccountOrder(venue, options).map((a) => a.name);

  it("puts the Raydium layout's bitmap extension before the tick arrays, and only when asked", () => {
    const without = names("raydium-clmm", { aToB: true });
    const extended = names("raydium-clmm", { aToB: true, bitmapExtension: true });
    expect(without).toHaveLength(16);
    expect(extended).toEqual([...without.slice(0, 13), "bitmapExtension", ...without.slice(13)]);
  });

  it("swaps a Raydium-layout pool's vaults and mints, not its token accounts, by direction", () => {
    const ab = names("byreal", { aToB: true });
    const ba = names("byreal", { aToB: false });
    expect(ab.slice(3, 7)).toEqual(["source", "recipient", "vaultA", "vaultB"]);
    expect(ba.slice(3, 7)).toEqual(["source", "recipient", "vaultB", "vaultA"]);
    expect(ab.slice(11, 13)).toEqual(["mintA", "mintB"]);
    expect(ba.slice(11, 13)).toEqual(["mintB", "mintA"]);
  });

  it("gives Orca's swap_v2 each mint and its token program and the oracle writable, and the classic swap an adaptive pool's oracle writable", () => {
    const v2 = routerSvmAccountOrder("orca-whirlpool", { aToB: false, v2: true });
    expect(v2.map((a) => a.name)).toEqual([
      "tokenProgramA",
      "tokenProgramB",
      "memo",
      "authority",
      "pool",
      "mintA",
      "mintB",
      "recipient",
      "vaultA",
      "source",
      "vaultB",
      "tickArray0",
      "tickArray1",
      "tickArray2",
      "oracle",
    ]);
    // `swap_v2` declares the oracle `mut` whatever the pool's fee.
    const oracle = (options: RouterSvmAccountOptions) =>
      routerSvmAccountOrder("orca-whirlpool", options).at(-1);
    for (const adaptive of [undefined, false, true])
      expect(oracle({ aToB: true, v2: true, adaptive })).toEqual({
        name: "oracle",
        writable: true,
        signer: false,
      });
    // The classic `swap` writes it only for an adaptive fee.
    expect(oracle({ aToB: true, adaptive: true })!.writable).toBe(true);
    expect(oracle({ aToB: true })!.writable).toBe(false);
    expect(oracle({ aToB: false, adaptive: false })!.writable).toBe(false);
  });

  it("takes fewer tick arrays on Crema and fewer ticks on Invariant", () => {
    expect(names("crema", { aToB: true, tickArrays: 1 }).slice(-2)).toEqual([
      "tokenProgram",
      "tickArray0",
    ]);
    expect(names("invariant", { aToB: false, tickArrays: 2 }).slice(-3)).toEqual([
      "tokenProgram",
      "tick0",
      "tick1",
    ]);
  });

  it("refuses an option the venue does not take", () => {
    expect(() => names("defituna", { aToB: true, tickArrays: 2 })).toThrow(
      "defituna's swap takes 3 tick arrays",
    );
    expect(() => names("crema", { aToB: true, tickArrays: 4 as never })).toThrow(
      "tickArrays is 1, 2 or 3, not 4",
    );
    expect(() => names("cropper", { aToB: true, v2: true })).toThrow(
      "v2 is Orca Whirlpools' alone",
    );
    expect(() => names("cropper", { aToB: true, adaptive: true })).toThrow(
      "adaptive is Orca Whirlpools' alone",
    );
    expect(() => names("crema", { aToB: true, bitmapExtension: true })).toThrow(
      "bitmapExtension is the Raydium layout's alone",
    );
  });

  it("refuses refs missing a name the swap takes", () => {
    expect(() => routerSvmAccounts("manifest", { aToB: true }, { authority: "a" })).toThrow(
      "manifest's swap takes pool, which refs does not name",
    );
  });
});
