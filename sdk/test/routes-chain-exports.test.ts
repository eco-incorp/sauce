/**
 * The chain accessors as NAMED EXPORTS -- `import { Base, Solana } from
 * "@eco-incorp/sauce"` -- which is the whole TypeScript surface for them.
 * Runtime assertions only; the type-level half is
 * `routes-chain-exports-types.test.ts`.
 *
 * Imports the package ROOT (`../src/index.js`), not `routes/`, because the
 * thing under test is what a consumer actually gets from one import: the full
 * composed accessor (callable + `.chain`/`.route` + the lazy contract tree,
 * plus the svm venue tree on an svm chain) and an untouched `globalThis`.
 */
import * as sauce from "../src/index.js";
import { Base, Ethereum, Solana, Token, chain, canonicalChains } from "../src/index.js";
import { chainAccessors, pascalOfSlug } from "../src/routes/index.js";
import { requireChain } from "../src/chains/canonical.js";
import { TOKEN_REGISTRY, resolveTokenMap } from "../src/routes/token-registry.js";
import { venueAdapter } from "../src/svm/venues/registry.js";
import type { IntentOptions } from "../src/routes/index.js";

/** The same module namespace, indexable by a chain name computed at run time. */
const sdk = sauce as unknown as Record<string, unknown>;
const g = globalThis as unknown as Record<string, unknown>;

function evmOptions(): IntentOptions {
  return {
    pot: "0x1111111111111111111111111111111111111111",
    engine: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    deadline: 2000n,
    portal: "0x3333333333333333333333333333333333333333",
    source: "base",
    creator: "0x5555555555555555555555555555555555555555",
    prover: "0x6666666666666666666666666666666666666666",
    rewardDeadline: 1000n,
  };
}

describe("chain accessors: one named export per canonical chain", () => {
  it("every canonical chain is exported under its PascalCase name, over the SAME CanonicalChain", () => {
    for (const c of canonicalChains) {
      const key = pascalOfSlug(c.slug);
      const exported = sdk[key] as { chain: unknown; route: unknown } | undefined;
      expect(exported).toBeDefined();
      expect(exported!.chain).toEqual(chainAccessors[key as keyof typeof chainAccessors].chain);
      expect(typeof exported!.route).toBe("function");
    }
  });

  it("importing the SDK installs nothing on globalThis -- the names exist only as imports", () => {
    for (const c of canonicalChains) {
      expect(g[pascalOfSlug(c.slug)]).toBeUndefined();
    }
    expect(g.chain).toBeUndefined();
    expect(g.Token).toBeUndefined();
  });

  it("the export is CALLABLE and `Base(...)` === `Base.route(...)` in behavior", () => {
    const opts = evmOptions();
    const viaCall = Base("return 1n;", opts).reward(0n);
    const viaRoute = Base.route("return 1n;", opts).reward(0n);
    const viaAccessor = chainAccessors.Base("return 1n;", opts).reward(0n);
    expect(viaCall.intent).toEqual(viaAccessor.intent);
    expect(viaRoute.intent).toEqual(viaAccessor.intent);
  });

  it("carries the native contract accessor tree, with the family alias resolving to the SAME accessor", () => {
    expect(Base.UniswapV4.UniversalRouter).toBeDefined();
    expect(Base.Uniswap.UniversalRouter).toBe(Base.UniswapV4.UniversalRouter);
    expect(Base.Uniswap.UniversalRouter.address).toBeDefined();
  });

  it("the contract namespaces stay LAZY memoising getters -- composition copies descriptors, it does not invoke them", () => {
    const desc = Object.getOwnPropertyDescriptor(Ethereum, "UniswapV4");
    expect(typeof desc?.get).toBe("function");
    expect(Ethereum.UniswapV4).toBe(Ethereum.UniswapV4);
  });

  it("composing never mutates the underlying chainAccessors entry", () => {
    expect(Object.keys(chainAccessors.Base).sort()).toEqual(["chain", "route"]);
    expect(Object.keys(chainAccessors.Solana).sort()).toEqual(["chain", "route"]);
  });

  it("an svm chain ALSO carries the venue tree; an EVM chain provably does not", () => {
    expect(Solana.RaydiumCpSwap.programId).toBe(venueAdapter("raydium-cp-swap").programId);
    expect((Base as unknown as Record<string, unknown>).RaydiumCpSwap).toBeUndefined();
  });

  it("composition is memoised: the same export object every time, on both spellings", () => {
    expect(sdk.Base).toBe(Base);
    expect(sdk.Solana).toBe(Solana);
  });
});

describe("chain accessors: the chain's registry tokens", () => {
  it("Base.USDC is the registry row a compiled program's USDC resolves to on Base", () => {
    expect(Base.USDC).toEqual({
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      symbol: "USDC",
      chain: requireChain("base"),
    });
    expect(BigInt(Base.USDC.address)).toBe(resolveTokenMap(requireChain("base")).get("USDC"));
  });

  it("every registered token on every chain, and nothing else", () => {
    for (const c of canonicalChains) {
      const exported = sdk[pascalOfSlug(c.slug)] as Record<string, unknown>;
      const rows = TOKEN_REGISTRY[c.id] ?? [];
      for (const row of rows) {
        expect(exported[row.symbol]).toEqual({
          address: row.address,
          decimals: row.decimals,
          symbol: row.symbol,
          chain: c,
        });
      }
      const symbols = new Set(Object.values(TOKEN_REGISTRY).flatMap((r) => r.map((t) => t.symbol)));
      for (const symbol of symbols) {
        if (!rows.some((row) => row.symbol === symbol)) expect(exported[symbol]).toBeUndefined();
      }
    }
  });

  it("a token is one frozen object per chain, and its property cannot be reassigned", () => {
    expect(Base.USDC).toBe(Base.USDC);
    expect(Object.isFrozen(Base.USDC)).toBe(true);
    expect(() => {
      (Base as unknown as Record<string, unknown>).USDC = 1;
    }).toThrow(TypeError);
  });
});

describe("chain accessors: the non-chain exports alongside them", () => {
  it("`chain(ref)` is exported and resolves through the registry", () => {
    expect(typeof chain).toBe("function");
    expect(chain("base").chain).toEqual(requireChain("base"));
    expect(chain(8453).chain).toEqual(requireChain("base"));
  });

  it("`Token` is exported with the host builder API intact", () => {
    const call = Token.transfer({
      token: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      amount: 1n,
    });
    expect(call.source("evm")).toContain("IERC20");
    expect(typeof Token.TOKEN_PROGRAM).toBe("bigint");
  });
});
