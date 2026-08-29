/**
 * E2.5: unification of the svm venue accessor tree onto the SAME global
 * `Solana` that already carries `.route(...)` (E3.5) and `ChainContracts`
 * (E2.3). Proves: the ambient no-import global resolves the real adapter's
 * statics, `.route` and `.RaydiumCpSwap` coexist on one object, EVM chain
 * globals are unaffected (both at runtime and, in routes-globals-ambient-
 * types.test.ts, at the type level), and install/uninstall bookkeeping still
 * covers the venue namespaces.
 */
import { venueAdapter } from "../src/svm/venues/registry.js";
import { chainAccessors, pascalOfSlug } from "../src/routes/index.js";
import { installRouteGlobals, uninstallRouteGlobals } from "../src/routes/globals.js";
import type { IntentOptions } from "../src/routes/index.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: "0x3333333333333333333333333333333333333333",
    prover: "0x4444444444444444444444444444444444444444",
    rewardDeadline: 1000n,
    ...overrides,
  };
}

const g = globalThis as unknown as Record<string, unknown>;

describe("svm venue globals: ambient + runtime, no import of the tree", () => {
  it("Solana.<Venue>.programId/kind/slug on the installed global equal the real adapter's own values", () => {
    const solana = g.Solana as Record<string, unknown>;
    const raydium = solana.RaydiumCpSwap as { programId: unknown; slug: unknown; kind: unknown };
    const adapter = venueAdapter("raydium-cp-swap");
    expect(raydium.programId).toBe(adapter.programId);
    expect(raydium.slug).toBe(adapter.slug);
    expect(raydium.kind).toBe(adapter.kind);

    const dammV2 = solana.MeteoraDammV2 as { kind: unknown };
    expect(dammV2.kind).toBe("sqrt-price");
  });

  it("every registered venue slug appears on the installed Solana global under its PascalCase name", () => {
    const solana = g.Solana as Record<string, unknown>;
    for (const slug of ["raydium-cp-swap", "raydium-amm-v4", "pumpswap", "orca-legacy-token-swap", "meteora-damm-v2", "saber-stableswap", "meteora-damm-v1-stable", "meteora-dbc", "stabble-stable-swap", "stabble-weighted-swap"]) {
      expect(solana[pascalOfSlug(slug)]).toBeDefined();
    }
  });
});

describe("svm venue globals: coexistence with .route", () => {
  it("the SAME Solana object answers .route(...) AND carries .RaydiumCpSwap", () => {
    const solana = g.Solana as {
      route: (s: string, o: IntentOptions) => { reward: (r: bigint) => unknown };
      RaydiumCpSwap: unknown;
      chain: { slug: string };
    };
    expect(solana.chain.slug).toBe("solana");
    expect(solana.RaydiumCpSwap).toBeDefined();
    const built = solana.route("function main() { return 1n; }", {
      execution: {
        buffer: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
        accounts: [],
      },
      deadline: 2000n,
      portal: PORTAL,
      source: "base",
      creator: "0x3333333333333333333333333333333333333333",
      prover: "0x4444444444444444444444444444444444444444",
      rewardDeadline: 1000n,
    }).reward(0n);
    expect(built).toBeDefined();
  });

  it("composition never mutates the imported chainAccessors.Solana object", () => {
    expect(Object.keys(chainAccessors.Solana).sort()).toEqual(["chain", "route"]);
  });
});

describe("svm venue globals: EVM chains unaffected", () => {
  it("Base.Uniswap.UniversalRouter still resolves (regression) and carries no svm venue namespace", () => {
    const base = g.Base as { Uniswap: { UniversalRouter: { address: unknown } }; UniswapV4: { UniversalRouter: unknown } };
    expect(base.Uniswap.UniversalRouter.address).toBeDefined();
    expect(base.Uniswap.UniversalRouter).toBe(base.UniswapV4.UniversalRouter);
    expect((base as unknown as Record<string, unknown>).RaydiumCpSwap).toBeUndefined();
  });
});

describe("svm venue globals: install bookkeeping", () => {
  it("uninstall then reinstall restores the venue namespaces on a fresh target", () => {
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
