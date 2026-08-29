/**
 * eco-routes DEFAULT GLOBALS -- runtime install tests. Pure in-process
 * `globalThis` assertions, no compiler/forge/network involved.
 *
 * `sdk/src/index.ts` installs on import (module-eval time), so by the time
 * this file's imports resolve, the globals are already live -- most of this
 * file exercises `installRouteGlobals`/`uninstallRouteGlobals` directly to
 * probe collision/idempotence/gating behavior without disturbing that
 * already-installed baseline for other test files in the same worker.
 */
import { canonicalChains, requireChain } from "../src/chains/canonical.js";
import { chainAccessors, pascalOfSlug } from "../src/routes/index.js";
import {
  installRouteGlobals,
  uninstallRouteGlobals,
  routeGlobals,
} from "../src/routes/globals.js";
import type { IntentOptions } from "../src/routes/index.js";

/** Every chain global, plus the two non-chain globals this module installs by default: `chain`
 *  and the universal `Token` interface (E-token). Kept derived, not a magic number, so a future
 *  chain/global addition can't silently mask a real regression here. */
const CHAIN_PLUS_CHAIN_PLUS_TOKEN = canonicalChains.length + 2;
const CHAIN_PLUS_TOKEN = canonicalChains.length + 1;

const POT = "0x1111111111111111111111111111111111111111" as const;
const PORTAL = "0x3333333333333333333333333333333333333333" as const;
const CREATOR = "0x5555555555555555555555555555555555555555" as const;
const PROVER = "0x6666666666666666666666666666666666666666" as const;

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: CREATOR,
    prover: PROVER,
    rewardDeadline: 1000n,
    ...overrides,
  };
}

const g = globalThis as unknown as Record<string, unknown>;

describe("routes globals: installed by default on import", () => {
  it("routeGlobals (the install-on-import result) installed every chain + chain, nothing skipped", () => {
    expect(routeGlobals.skipped).toEqual([]);
    expect(routeGlobals.installed).toHaveLength(CHAIN_PLUS_CHAIN_PLUS_TOKEN);
    expect(routeGlobals.installed).toContain("Token");
  });

  it("every canonical chain's PascalCase name resolves on globalThis to a composed origin over the SAME CanonicalChain", () => {
    // Composed, not identical: E2.3 wraps each origin with its native
    // contract-accessor tree, so this is no longer the SAME object as
    // `chainAccessors[key]` -- only the same underlying chain/route.
    for (const c of canonicalChains) {
      const key = pascalOfSlug(c.slug);
      const composed = g[key] as { chain: unknown; route: unknown };
      const origin = chainAccessors[key as keyof typeof chainAccessors];
      expect(composed.chain).toEqual(origin.chain);
      expect(typeof composed.route).toBe("function");
    }
  });

  it("E2.3: the installed global carries BOTH the eco-routes DSL and the native contract accessor tree", () => {
    const base = g.Base as { route: unknown; UniswapV4: { UniversalRouter: unknown }; Uniswap: { UniversalRouter: unknown } };
    expect(typeof base.route).toBe("function");
    expect(base.UniswapV4.UniversalRouter).toBeDefined();
    // Family alias forwards to the SAME underlying accessor as the canonical namespace.
    expect(base.Uniswap.UniversalRouter).toBe(base.UniswapV4.UniversalRouter);
  });

  it("composition never mutates the imported chainAccessors.Base object", () => {
    expect(Object.keys(chainAccessors.Base).sort()).toEqual(["chain", "route"]);
  });

  it("contract namespaces install as lazy, memoising getters (not eagerly constructed)", () => {
    const desc = Object.getOwnPropertyDescriptor(g.Base, "UniswapV4");
    expect(typeof desc?.get).toBe("function");
    const base = g.Base as { UniswapV4: unknown };
    expect(base.UniswapV4).toBe(base.UniswapV4);
  });

  it("`chain` the front door is also a global and behaves identically to the named import", () => {
    expect(typeof g.chain).toBe("function");
    const viaGlobal = (g.chain as (ref: unknown) => { chain: unknown })("base");
    expect(viaGlobal.chain).toEqual(requireChain("base"));
  });

  it("end-to-end: Base(sauce, opts).reward(...) through the bare global matches the named-import build, and === Base.route(...)", () => {
    const opts = evmOptions();

    type OriginLike = {
      (sauce: string, o: IntentOptions): { reward: (r: number | bigint) => unknown };
      route: (sauce: string, o: IntentOptions) => { reward: (r: number | bigint) => unknown };
    };
    const viaCall = (g.Base as OriginLike)("return 1n;", opts).reward(0n) as { intent: unknown };
    const viaRoute = (g.Base as OriginLike).route("return 1n;", opts).reward(0n) as { intent: unknown };
    const viaNamedImport = chainAccessors.Base("return 1n;", opts).reward(0n);
    expect(viaCall.intent).toEqual(viaNamedImport.intent);
    expect(viaRoute.intent).toEqual(viaNamedImport.intent);
  });

  it("installed properties are non-enumerable (don't pollute Object.keys(globalThis))", () => {
    const enumerableKeys = Object.keys(globalThis);
    for (const c of canonicalChains) {
      expect(enumerableKeys).not.toContain(pascalOfSlug(c.slug));
    }
    expect(enumerableKeys).not.toContain("chain");
    expect(enumerableKeys).not.toContain("Token");
  });

  // E-token: adding the Token global must not regress E3.5 (Base.route) or E2.3 (Base.Uniswap).
  it("REGRESSION (E3.5/E2.3): Base.route(...) and Base.Uniswap.UniversalRouter still resolve via the bare global", () => {
    const pending = (g.Base as { route: (s: string, o: IntentOptions) => unknown }).route("return 1n;", evmOptions());
    expect(pending).toBeDefined();
    const base = g.Base as { UniswapV4: { UniversalRouter: unknown }; Uniswap: { UniversalRouter: unknown } };
    expect(base.UniswapV4.UniversalRouter).toBeDefined();
    expect(base.Uniswap.UniversalRouter).toBe(base.UniswapV4.UniversalRouter);
  });
});

describe("routes globals: the universal Token global", () => {
  it("Token is installed on globalThis, non-enumerable, and is the SAME object as the named import", () => {
    expect(typeof (g.Token as { transfer: unknown }).transfer).toBe("function");
    expect(Object.keys(globalThis)).not.toContain("Token");
    const desc = Object.getOwnPropertyDescriptor(globalThis, "Token");
    expect(desc?.enumerable).toBe(false);
  });

  it("Token.transfer/.approve/.balanceOf each return a TokenCall builder", () => {
    const token = g.Token as {
      transfer: (s: unknown) => { source: (t: string) => string };
      approve: (s: unknown) => { source: (t: string) => string };
      balanceOf: (s: unknown) => { source: (t: string) => string };
    };
    const t = token.transfer({ token: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222", amount: 1n });
    expect(t.source("evm")).toContain("IERC20");
  });

  it("a pre-existing globalThis.Token is SKIPPED, not clobbered", () => {
    uninstallRouteGlobals();
    const SENTINEL = { marker: "pre-existing" };
    g.Token = SENTINEL;
    const report = installRouteGlobals();
    expect(report.skipped).toContain("Token");
    expect(g.Token).toBe(SENTINEL);
    delete g.Token;
    installRouteGlobals();
  });

  it("installRouteGlobals({ includeToken: false }) omits Token only", () => {
    uninstallRouteGlobals();
    const report = installRouteGlobals({ includeToken: false });
    expect(report.installed).not.toContain("Token");
    expect(g.Token).toBeUndefined();
    installRouteGlobals();
  });

  it("uninstallRouteGlobals() removes Token; re-install is idempotent", () => {
    uninstallRouteGlobals();
    expect(g.Token).toBeUndefined();
    const report = installRouteGlobals();
    expect(report.installed).toContain("Token");
    expect(typeof (g.Token as { transfer: unknown }).transfer).toBe("function");
  });
});

describe("routes globals: installRouteGlobals / uninstallRouteGlobals", () => {
  afterEach(() => {
    // Restore the baseline the whole suite (and other test files sharing
    // this worker's globalThis) expects: everything installed, nothing
    // left over from a test-local sentinel.
    delete g.__ECO_ROUTES_TEST_SENTINEL__;
    installRouteGlobals();
  });

  it("never clobbers a name already present on the target -- skip, don't overwrite", () => {
    uninstallRouteGlobals();
    const SENTINEL = Symbol("sentinel");
    g.Zora = SENTINEL;

    const report = installRouteGlobals();

    expect(report.skipped).toContain("Zora");
    expect(report.installed).not.toContain("Zora");
    expect(g.Zora).toBe(SENTINEL);
  });

  it("`in` semantics: an inherited/getter-only property on the target still counts as taken", () => {
    uninstallRouteGlobals();
    const proto = { get Base() { return "inherited"; } };
    const target = Object.create(proto) as Record<string, unknown>;

    const report = installRouteGlobals({ target });

    expect(report.skipped).toContain("Base");
    expect(target.Base).toBe("inherited");
  });

  it("includeChain: false omits the `chain` front door only", () => {
    uninstallRouteGlobals();
    const report = installRouteGlobals({ includeChain: false });
    expect(report.installed).not.toContain("chain");
    expect(report.installed).toHaveLength(CHAIN_PLUS_TOKEN);
  });

  it("includeToken: false omits the `Token` global only", () => {
    uninstallRouteGlobals();
    const report = installRouteGlobals({ includeToken: false });
    expect(report.installed).not.toContain("Token");
    expect(report.installed).toHaveLength(CHAIN_PLUS_TOKEN);
  });

  it("uninstallRouteGlobals removes exactly what this module installed, and re-install is idempotent (not self-skipping)", () => {
    uninstallRouteGlobals();
    const first = installRouteGlobals();
    expect(first.installed.length).toBe(CHAIN_PLUS_CHAIN_PLUS_TOKEN);

    uninstallRouteGlobals();
    for (const c of canonicalChains) {
      expect(g[pascalOfSlug(c.slug)]).toBeUndefined();
    }
    expect(g.chain).toBeUndefined();
    expect(g.Token).toBeUndefined();

    const second = installRouteGlobals();
    expect(second.skipped).toEqual([]);
    expect(second.installed.length).toBe(CHAIN_PLUS_CHAIN_PLUS_TOKEN);
  });

  it("uninstall leaves an unrelated pre-existing global alone", () => {
    g.__ECO_ROUTES_TEST_SENTINEL__ = "untouched";
    uninstallRouteGlobals();
    expect(g.__ECO_ROUTES_TEST_SENTINEL__).toBe("untouched");
    installRouteGlobals();
  });

  it("a custom target object is populated instead of globalThis, and globalThis is unaffected", () => {
    const target: Record<string, unknown> = {};
    const report = installRouteGlobals({ target });
    expect(report.skipped).toEqual([]);
    expect((target.Base as { chain: unknown }).chain).toEqual(chainAccessors.Base.chain);
    // globalThis's own Base is untouched by this call (still whatever the
    // top-level install-on-import set it to).
    expect((g.Base as { chain: unknown }).chain).toEqual(chainAccessors.Base.chain);
  });
});
