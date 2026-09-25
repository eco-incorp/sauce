/**
 * E2.5: unification of the svm venue accessor tree onto the SAME `Solana`
 * accessor that already carries `.route(...)` (E3.5) and `ChainContracts`
 * (E2.3). Proves: the composed accessor resolves the real adapter's statics,
 * `.route` and `.RaydiumCpSwap` coexist on one object, EVM chains are
 * unaffected (both at runtime and, in routes-chain-exports-types.test.ts, at
 * the type level), and the OPT-IN install/uninstall bookkeeping still covers
 * the venue namespaces.
 *
 * The tree is reached by IMPORT — `import { Solana }` — not off `globalThis`;
 * the install cases below opt in explicitly and clean up after themselves.
 */
import { venueAdapter } from "../src/svm/venues/registry.js";
import { chainAccessors, pascalOfSlug } from "../src/routes/index.js";
import { installRouteGlobals, uninstallRouteGlobals } from "../src/routes/globals.js";
import { Base, Solana } from "../src/index.js";
import type { IntentOptions } from "../src/routes/index.js";

const PORTAL = "0x2222222222222222222222222222222222222222" as const;

const g = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  uninstallRouteGlobals();
});

describe("svm venue accessors: on the imported Solana accessor", () => {
  it("Solana.<Venue>.programId/kind/slug equal the real adapter's own values", () => {
    const solana = Solana as unknown as Record<string, unknown>;
    const raydium = solana.RaydiumCpSwap as { programId: unknown; slug: unknown; kind: unknown };
    const adapter = venueAdapter("raydium-cp-swap");
    expect(raydium.programId).toBe(adapter.programId);
    expect(raydium.slug).toBe(adapter.slug);
    expect(raydium.kind).toBe(adapter.kind);

    const dammV2 = solana.MeteoraDammV2 as { kind: unknown };
    expect(dammV2.kind).toBe("sqrt-price");
  });

  it("every registered venue slug appears on the Solana accessor under its PascalCase name", () => {
    const solana = Solana as unknown as Record<string, unknown>;
    for (const slug of [
      "raydium-cp-swap",
      "raydium-amm-v4",
      "pumpswap",
      "orca-legacy-token-swap",
      "meteora-damm-v2",
      "saber-stableswap",
      "meteora-damm-v1-stable",
      "meteora-dbc",
      "stabble-stable-swap",
      "stabble-weighted-swap",
    ]) {
      expect(solana[pascalOfSlug(slug)]).toBeDefined();
    }
  });
});

describe("svm venue accessors: coexistence with .route", () => {
  it("the SAME Solana object answers .route(...) AND carries .RaydiumCpSwap", () => {
    const solana = Solana as unknown as {
      route: (s: string, o: IntentOptions) => { reward: (r: bigint) => unknown };
      RaydiumCpSwap: unknown;
      chain: { slug: string };
    };
    expect(solana.chain.slug).toBe("solana");
    expect(solana.RaydiumCpSwap).toBeDefined();
    const built = solana
      .route("function main() { return 1n; }", {
        execution: {
          code: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          accounts: [],
        },
        deadline: 2000n,
        portal: PORTAL,
        source: "base",
        creator: "0x3333333333333333333333333333333333333333",
        prover: "0x4444444444444444444444444444444444444444",
        rewardDeadline: 1000n,
      })
      .reward(0n);
    expect(built).toBeDefined();
  });

  it("composition never mutates the imported chainAccessors.Solana object", () => {
    expect(Object.keys(chainAccessors.Solana).sort()).toEqual(["chain", "route"]);
  });
});

describe("svm venue accessors: EVM chains unaffected", () => {
  it("Base.Uniswap.UniversalRouter still resolves (regression) and carries no svm venue namespace", () => {
    const base = Base as unknown as {
      Uniswap: { UniversalRouter: { address: unknown } };
      UniswapV4: { UniversalRouter: unknown };
    };
    expect(base.Uniswap.UniversalRouter.address).toBeDefined();
    expect(base.Uniswap.UniversalRouter).toBe(base.UniswapV4.UniversalRouter);
    expect((base as unknown as Record<string, unknown>).RaydiumCpSwap).toBeUndefined();
  });
});

describe("svm venue accessors: opt-in install bookkeeping", () => {
  it("uninstall then reinstall restores the venue namespaces on globalThis", () => {
    installRouteGlobals();
    uninstallRouteGlobals();
    const report = installRouteGlobals();
    expect(report.installed).toContain("Solana");
    expect(report.skipped).toEqual([]);
    const solana = g.Solana as { RaydiumCpSwap: unknown };
    expect(solana.RaydiumCpSwap).toBeDefined();
  });

  it("installRouteGlobals({ target: {} }) reports Solana with the venue tree attached", () => {
    const target: Record<string, unknown> = {};
    const report = installRouteGlobals({ target });
    expect(report.installed).toContain("Solana");
    const solana = target.Solana as { RaydiumCpSwap: unknown; route: unknown };
    expect(solana.RaydiumCpSwap).toBeDefined();
    expect(typeof solana.route).toBe("function");
  });
});
