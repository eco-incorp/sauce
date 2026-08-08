/**
 * E2.5: the svm venue accessor tree (`venues()`/`venue(slug)`, src/svm/accessors.ts) — the
 * SVM twin of E2.3's descriptors/accessors.ts. Covers: registry-derived tree membership (both
 * directions), statics resolving to the real adapter's own values, delegation identity on real
 * fixtures (proving the wrapper adds/drops nothing), error passthrough, and laziness/memoisation.
 * No globals, no engine, no RPC.
 */
import { resolve } from "path";
import { address } from "@solana/kit";
import { venue, venues } from "../src/svm/accessors.js";
import { listVenues, venueAdapter } from "../src/svm/venues/registry.js";
import { meteoraDammV2 } from "../src/svm/venues/meteora-damm-v2/index.js";
import { raydiumCpSwap } from "../src/svm/venues/raydium-cp-swap/index.js";
import { fixtureBytesMap, fixtureLoader, loadFixtures } from "./svm/fixtures.js";
import { pascalOfSlug } from "../src/routes/builder.js";

describe("svm venue accessors: registry-derived tree membership", () => {
  it("venues() has exactly one PascalCase namespace per listVenues() slug, in order, hand-listing nothing", () => {
    const tree = venues() as unknown as Record<string, unknown>;
    expect(Object.keys(tree)).toEqual(listVenues().map(pascalOfSlug));
  });

  it("venue(slug) resolves for every registered slug", () => {
    for (const slug of listVenues()) {
      expect(venue(slug as never).slug).toBe(slug);
    }
  });

  it("venue() rejects an unregistered slug with the registry's own error", () => {
    expect(() => venue("not-a-real-venue" as never)).toThrow(/unknown venue 'not-a-real-venue'/);
  });
});

describe("svm venue accessors: statics are the adapter's own", () => {
  it("slug/kind/programId/adapter identity match venueAdapter(slug) for every registered venue", () => {
    for (const slug of listVenues()) {
      const accessor = venue(slug as never);
      const adapter = venueAdapter(slug);
      expect(accessor.slug).toBe(adapter.slug);
      expect(accessor.kind).toBe(adapter.kind);
      expect(accessor.programId).toBe(adapter.programId);
      expect(accessor.adapter).toBe(adapter);
    }
  });
});

describe("svm venue accessors: laziness / memoisation", () => {
  it("two reads of the same namespace off one venues() call are toBe-identical", () => {
    const tree = venues() as unknown as Record<string, unknown>;
    const first = tree.RaydiumCpSwap;
    const second = tree.RaydiumCpSwap;
    expect(first).toBe(second);
  });

  it("two separate venues() calls each build their own, independent tree", () => {
    const treeA = venues() as unknown as Record<string, unknown>;
    const treeB = venues() as unknown as Record<string, unknown>;
    expect(treeA.RaydiumCpSwap).not.toBe(treeB.RaydiumCpSwap);
  });
});

describe("svm venue accessors: delegation identity on a real fixture (meteora-damm-v2)", () => {
  const POOL = address("8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie");
  const ONE_SOL = 1_000_000_000n;
  const NOW = 1_780_000_000n;
  const user = { inAta: "user-in", outAta: "user-out", owner: "user-owner" };

  const fixtures = loadFixtures(resolve(process.cwd(), "test/svm/fixtures/meteora-damm-v2"));
  const loader = fixtureLoader(fixtures);
  const state = fixtureBytesMap(fixtures);

  it("poolConfig deep-equals adapter.fetchPoolConfig", async () => {
    const tree = venues();
    const viaAccessor = await tree.MeteoraDammV2.poolConfig(loader, POOL);
    const viaAdapter = await meteoraDammV2.fetchPoolConfig(loader, POOL);
    expect(viaAccessor).toEqual(viaAdapter);
  });

  it("quoteAccounts / quoteSource / swap / referenceQuote all forward unchanged", async () => {
    const tree = venues();
    const cfg = await meteoraDammV2.fetchPoolConfig(loader, POOL);

    expect(tree.MeteoraDammV2.quoteAccounts(cfg)).toEqual(meteoraDammV2.quoteAccounts(cfg));
    expect(tree.MeteoraDammV2.quoteSource(cfg, 0, ONE_SOL)).toBe(meteoraDammV2.emitQuote(cfg, 0, ONE_SOL));
    expect(tree.MeteoraDammV2.swap(cfg, user, ONE_SOL)).toEqual(meteoraDammV2.buildSwap(cfg, user, ONE_SOL));
    expect(tree.MeteoraDammV2.referenceQuote(cfg, state, ONE_SOL, NOW)).toBe(
      meteoraDammV2.referenceQuote(cfg, state, ONE_SOL, NOW),
    );
  });

  it("errors pass through unchanged: poolConfig rejects on a missing pool with the adapter's own message", async () => {
    const missing = address("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
    await expect(venues().MeteoraDammV2.poolConfig(loader, missing)).rejects.toThrow(
      `meteora-damm-v2 pool ${missing} account not found`,
    );
  });
});

describe("svm venue accessors: delegation identity on a second venue (raydium-cp-swap)", () => {
  it(".adapter is the real, live-registered adapter object", () => {
    expect(venues().RaydiumCpSwap.adapter).toBe(raydiumCpSwap);
    expect(venue("raydium-cp-swap").adapter).toBe(raydiumCpSwap);
  });
});
