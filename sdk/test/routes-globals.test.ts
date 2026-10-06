/**
 * `routes/globals.ts` -- the OPT-IN `globalThis` install. Pure in-process
 * assertions, no compiler/forge/network involved.
 *
 * The headline case is the first one: importing the SDK installs NOTHING.
 * Everything below it has to ask for the install explicitly, and every test
 * that does puts `globalThis` back afterwards (see the top-level `afterEach`),
 * because the no-install invariant is what the rest of the suite -- and
 * `routes-chain-exports.test.ts` -- rests on.
 */
import { canonicalChains, requireChain } from "../src/chains/canonical.js";
import { chainAccessors, pascalOfSlug } from "../src/routes/index.js";
import { installRouteGlobals, uninstallRouteGlobals, routeGlobals } from "../src/routes/globals.js";
import { Base as BaseExport } from "../src/routes/chain-exports.generated.js";

/** Every chain name, plus the two non-chain names this module installs by default: `chain`
 *  and the universal `Token` interface. Kept derived, not a magic number, so a future
 *  chain/global addition can't silently mask a real regression here. */
const CHAIN_PLUS_CHAIN_PLUS_TOKEN = canonicalChains.length + 2;
const CHAIN_PLUS_TOKEN = canonicalChains.length + 1;

const g = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  uninstallRouteGlobals();
  delete g.__ECO_ROUTES_TEST_SENTINEL__;
});

describe("routes globals: nothing is installed on import", () => {
  it("importing the SDK leaves globalThis alone -- no chain name, no `chain`, no `Token`", () => {
    for (const c of canonicalChains) {
      expect(g[pascalOfSlug(c.slug)]).toBeUndefined();
    }
    expect(g.chain).toBeUndefined();
    expect(g.Token).toBeUndefined();
  });

  it("routeGlobals reports an empty install until a host asks for one", () => {
    expect(routeGlobals.installed).toEqual([]);
    expect(routeGlobals.skipped).toEqual([]);
  });

  it("routeGlobals is a LIVE view: it follows an install and an uninstall, never a stale claim", () => {
    installRouteGlobals();
    expect(routeGlobals.installed).toHaveLength(CHAIN_PLUS_CHAIN_PLUS_TOKEN);
    expect(routeGlobals.installed).toContain("Token");
    uninstallRouteGlobals();
    expect(routeGlobals.installed).toEqual([]);
  });
});

describe("routes globals: installRouteGlobals installs the composed accessors", () => {
  it("every canonical chain's PascalCase name lands on globalThis over the SAME CanonicalChain", () => {
    installRouteGlobals();
    for (const c of canonicalChains) {
      const key = pascalOfSlug(c.slug);
      const composed = g[key] as { chain: unknown; Portal: unknown };
      const origin = chainAccessors[key as keyof typeof chainAccessors];
      expect(composed.chain).toEqual(origin.chain);
      expect(composed.Portal).toBe(origin.Portal);
    }
  });

  it("installs the SAME object the named export hands out -- one composition, two spellings", () => {
    installRouteGlobals();
    expect(g.Base).toBe(BaseExport);
  });

  it("the installed global carries BOTH its Portal and the native contract accessor tree", () => {
    installRouteGlobals();
    const base = g.Base as {
      Portal: { send: unknown };
      UniswapV4: { UniversalRouter: unknown };
      Uniswap: { UniversalRouter: unknown };
    };
    expect(typeof base.Portal.send).toBe("function");
    expect(base.UniswapV4.UniversalRouter).toBeDefined();
    // Family alias forwards to the SAME underlying accessor as the canonical namespace.
    expect(base.Uniswap.UniversalRouter).toBe(base.UniswapV4.UniversalRouter);
  });

  it("composition never mutates the imported chainAccessors.Base object", () => {
    installRouteGlobals();
    expect(Object.keys(chainAccessors.Base).sort()).toEqual(["Portal", "chain"]);
  });

  it("contract namespaces install as lazy, memoising getters (not eagerly constructed)", () => {
    installRouteGlobals();
    const desc = Object.getOwnPropertyDescriptor(g.Base, "UniswapV4");
    expect(typeof desc?.get).toBe("function");
    const base = g.Base as { UniswapV4: unknown };
    expect(base.UniswapV4).toBe(base.UniswapV4);
  });

  it("`chain` the front door installs too and behaves identically to the named import", () => {
    installRouteGlobals();
    expect(typeof g.chain).toBe("function");
    const viaGlobal = (g.chain as (ref: unknown) => { chain: unknown })("base");
    expect(viaGlobal.chain).toEqual(requireChain("base"));
  });

  it("installed properties are non-enumerable (don't pollute Object.keys(globalThis))", () => {
    installRouteGlobals();
    const enumerableKeys = Object.keys(globalThis);
    for (const c of canonicalChains) {
      expect(enumerableKeys).not.toContain(pascalOfSlug(c.slug));
    }
    expect(enumerableKeys).not.toContain("chain");
    expect(enumerableKeys).not.toContain("Token");
  });
});

describe("routes globals: the universal Token global", () => {
  it("Token installs non-enumerably and is the SAME object as the named import", () => {
    installRouteGlobals();
    expect(typeof (g.Token as { transfer: unknown }).transfer).toBe("function");
    expect(Object.keys(globalThis)).not.toContain("Token");
    const desc = Object.getOwnPropertyDescriptor(globalThis, "Token");
    expect(desc?.enumerable).toBe(false);
  });

  it("Token.transfer/.approve/.balanceOf each return a TokenCall builder", () => {
    installRouteGlobals();
    const token = g.Token as {
      transfer: (s: unknown) => { source: (t: string) => string };
      approve: (s: unknown) => { source: (t: string) => string };
      balanceOf: (s: unknown) => { source: (t: string) => string };
    };
    const t = token.transfer({
      token: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      amount: 1n,
    });
    expect(t.source("evm")).toContain("IERC20");
  });

  it("a pre-existing globalThis.Token is SKIPPED, not clobbered", () => {
    const SENTINEL = { marker: "pre-existing" };
    g.Token = SENTINEL;
    try {
      const report = installRouteGlobals();
      expect(report.skipped).toContain("Token");
      expect(g.Token).toBe(SENTINEL);
    } finally {
      uninstallRouteGlobals();
      delete g.Token;
    }
  });

  it("installRouteGlobals({ includeToken: false }) omits Token only", () => {
    const report = installRouteGlobals({ includeToken: false });
    expect(report.installed).not.toContain("Token");
    expect(report.installed).toHaveLength(CHAIN_PLUS_TOKEN);
    expect(g.Token).toBeUndefined();
  });
});

describe("routes globals: installRouteGlobals / uninstallRouteGlobals", () => {
  it("never clobbers a name already present on the target -- skip, don't overwrite", () => {
    const SENTINEL = Symbol("sentinel");
    g.Zora = SENTINEL;
    try {
      const report = installRouteGlobals();
      expect(report.skipped).toContain("Zora");
      expect(report.installed).not.toContain("Zora");
      expect(g.Zora).toBe(SENTINEL);
    } finally {
      uninstallRouteGlobals();
      delete g.Zora;
    }
  });

  it("`in` semantics: an inherited/getter-only property on the target still counts as taken", () => {
    const proto = {
      get Base() {
        return "inherited";
      },
    };
    const target = Object.create(proto) as Record<string, unknown>;

    const report = installRouteGlobals({ target });

    expect(report.skipped).toContain("Base");
    expect(target.Base).toBe("inherited");
  });

  it("includeChain: false omits the `chain` front door only", () => {
    const report = installRouteGlobals({ includeChain: false });
    expect(report.installed).not.toContain("chain");
    expect(report.installed).toHaveLength(CHAIN_PLUS_TOKEN);
  });

  it("uninstallRouteGlobals removes exactly what this module installed, and re-install is idempotent (not self-skipping)", () => {
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
    installRouteGlobals();
    uninstallRouteGlobals();
    expect(g.__ECO_ROUTES_TEST_SENTINEL__).toBe("untouched");
  });

  it("a custom target object is populated instead of globalThis, and globalThis is unaffected", () => {
    const target: Record<string, unknown> = {};
    const report = installRouteGlobals({ target });
    expect(report.skipped).toEqual([]);
    expect((target.Base as { chain: unknown }).chain).toEqual(chainAccessors.Base.chain);
    expect(g.Base).toBeUndefined();
  });
});
