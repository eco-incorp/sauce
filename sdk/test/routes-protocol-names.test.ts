/**
 * The registry's protocol names in a program — `Uniswap.UniversalRouter.execute(...)`,
 * `AaveV3.getUserAccountData(...)`, `Base.AaveV3.Pool`, `Erc4626.Vault.at(vault).deposit(...)` —
 * are contracts the chain's host declares (`src/routes/host.ts`, resolved by
 * `src/routes/protocol-names.ts`): an ABI and the chain's address for it. Nothing rewrites the
 * program: each case is held to the program the same call compiles to through a binding written
 * by hand, `IUniswapV4_UniversalRouter.at(<address>).execute(...)`.
 */
import { requireChain } from "../src/chains/canonical.js";
import { getDescriptor } from "../src/descriptors/query.js";
import { openRoute } from "../src/routes/intent-dsl.js";
import type { AccessorTarget } from "../src/routes/protocol-names.js";
import { compileSauceRoute, type SauceCompileOptions } from "../src/routes/sauce-route.js";

const BASE_UNIVERSAL_ROUTER = "0x6ff5693b99212da76ad316178a184ab56d299b43";
const BASE_AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const ETHEREUM_AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const BASE_CCTP_TOKEN_MESSENGER = 232410083228790048339504449763962118892241342301n;

const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;

function evmOptions() {
  return {
    pot: POT,
    engine: ENGINE,
    deadline: 2000n,
    portal: PORTAL,
    source: "base" as const,
    creator: "0x3333333333333333333333333333333333333333" as const,
    prover: "0x4444444444444444444444444444444444444444" as const,
    rewardDeadline: 1000n,
  };
}

const bytesOf = (chain: string, source: string, options: SauceCompileOptions = {}): number[] =>
  Array.from(
    compileSauceRoute(chain, source, { pot: POT, engine: ENGINE }, options).compiled.bytecode[0]!,
  );

/** `source`, with `binding` declared as `protocol`'s `contract` ABI, compiled with no host names. */
const bound = (
  chain: string,
  binding: string,
  protocol: string,
  contract: string,
  source: string,
): number[] =>
  bytesOf(chain, source, {
    accessors: false,
    contracts: { [binding]: { abi: getDescriptor(protocol, contract)!.abi as never } },
  });

const decimal = (address: string) => `${BigInt(address)}n`;

describe("a protocol name is the contract on the chain the program is compiled for", () => {
  it("Uniswap.UniversalRouter.execute(...) on Base is IUniswapV4_UniversalRouter.at(<Base's>).execute(...)", () => {
    expect(
      bytesOf("base", `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`),
    ).toEqual(
      bound(
        "base",
        "IUniswapV4_UniversalRouter",
        "uniswap-v4",
        "UniversalRouter",
        `function main() { IUniswapV4_UniversalRouter.at(${decimal(BASE_UNIVERSAL_ROUTER)}).execute("0x0a", ["0x00"], 0n); }`,
      ),
    );
  });

  it("openRoute end to end: one cook() call", () => {
    const built = openRoute(
      "base",
      `Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);`,
      evmOptions(),
    ).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
  });

  it("<Protocol>.<method> is the protocol's one contract", () => {
    expect(bytesOf("base", "function main() { AaveV3.getUserAccountData(ctx.self()); }")).toEqual(
      bytesOf("base", "function main() { AaveV3.Pool.getUserAccountData(ctx.self()); }"),
    );
  });

  it("the same name is a different address on Base and on Ethereum", () => {
    const source = "function main() { AaveV3.getUserAccountData(ctx.self()); }";
    expect(bytesOf("base", source)).toEqual(
      bound(
        "base",
        "IAaveV3_Pool",
        "aave-v3",
        "Pool",
        `function main() { IAaveV3_Pool.at(${decimal(BASE_AAVE_POOL)}).getUserAccountData(ctx.self()); }`,
      ),
    );
    expect(bytesOf("ethereum", source)).toEqual(
      bound(
        "ethereum",
        "IAaveV3_Pool",
        "aave-v3",
        "Pool",
        `function main() { IAaveV3_Pool.at(${decimal(ETHEREUM_AAVE_POOL)}).getUserAccountData(ctx.self()); }`,
      ),
    );
  });
});

describe("a chain-qualified name is the NAMED chain's contract", () => {
  it("Base.Uniswap.UniversalRouter, compiled for Optimism, is Base's", () => {
    expect(
      bytesOf(
        "optimism",
        `function main() { Base.Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`,
      ),
    ).toEqual(
      bound(
        "optimism",
        "IUniswapV4_UniversalRouter",
        "uniswap-v4",
        "UniversalRouter",
        `function main() { IUniswapV4_UniversalRouter.at(${decimal(BASE_UNIVERSAL_ROUTER)}).execute("0x0a", ["0x00"], 0n); }`,
      ),
    );
  });

  it("Base.AaveV3.<method>, compiled for Optimism, is Base's default contract", () => {
    expect(
      bytesOf("optimism", "function main() { Base.AaveV3.getUserAccountData(ctx.self()); }"),
    ).toEqual(bytesOf("base", "function main() { AaveV3.getUserAccountData(ctx.self()); }"));
  });
});

describe("a protocol name as a value is its address", () => {
  it("Cctp.TokenMessenger is the address the underscore name has", () => {
    expect(bytesOf("base", "function main(): Address { return Cctp.TokenMessenger; }")).toEqual(
      bytesOf("base", `function main(): Address { return ${BASE_CCTP_TOKEN_MESSENGER}n; }`),
    );
    expect(bytesOf("base", "function main(): Address { return Cctp_TokenMessenger; }")).toEqual(
      bytesOf("base", `function main(): Address { return ${BASE_CCTP_TOKEN_MESSENGER}n; }`),
    );
  });

  it("chain-qualified values resolve per the named chain", () => {
    expect(bytesOf("optimism", "function main(): Address { return Base.AaveV3; }")).toEqual(
      bytesOf("optimism", `function main(): Address { return ${decimal(BASE_AAVE_POOL)}; }`),
    );
    expect(bytesOf("optimism", "function main(): Address { return Ethereum.AaveV3; }")).toEqual(
      bytesOf("optimism", `function main(): Address { return ${decimal(ETHEREUM_AAVE_POOL)}; }`),
    );
  });

  it("an address-only contract is its address", () => {
    const provider = getDescriptor("aave-v3", "PoolAddressesProvider")!.perChainAddress[8453]!;
    expect(
      bytesOf("base", "function main(): Address { return AaveV3.PoolAddressesProvider; }"),
    ).toEqual(bytesOf("base", `function main(): Address { return ${decimal(provider)}; }`));
  });

  it("USDC.approve(Cctp.TokenMessenger, x) compiles through openRoute", () => {
    const built = openRoute(
      "base",
      "function main() { USDC.approve(Cctp.TokenMessenger, 1000000n); }",
      evmOptions(),
    ).reward(0n);
    expect(built.intent.route.calls).toHaveLength(1);
  });
});

describe("`self` is the contract running the program", () => {
  it("is ctx.self()", () => {
    expect(bytesOf("base", "function main(): Address { return self; }").length).toBeGreaterThan(0);
  });

  it("a program that binds `self` owns the name", () => {
    expect(bytesOf("base", "function main(): Uint256 { let self = 5n; return self; }")).toEqual(
      bytesOf("base", "function main(): Uint256 { let x = 5n; return x; }"),
    );
  });
});

describe("a name the registry refuses, and the names it leaves alone", () => {
  it("a name nothing gives meaning to is the compiler's unknown name", () => {
    expect(() =>
      bytesOf("base", "function main() { SomeRandomThing.Contract.method(1n); }"),
    ).toThrow();
  });

  it("a program that binds the namespace owns it", () => {
    expect(() =>
      bytesOf(
        "base",
        'function main() { let Uniswap = 1n; Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }',
      ),
    ).toThrow(/does not name a function/);
  });

  it("a protocol with several contracts names no single one", () => {
    expect(() => bytesOf("base", "function main() { Uniswap.NotAContract.method(1n); }")).toThrow(
      /names no single contract|ambiguous/,
    );
  });

  it("a contract not deployed on the chain is that chain's message, at the use", () => {
    expect(() =>
      bytesOf("linea", "function main() { AaveV3.getUserAccountData(ctx.self()); }"),
    ).toThrow(/is not deployed on 'linea'/);
  });

  // No registry ABI is widened any more, so the gate is exercised by marking a real descriptor
  // widened for one test.
  function whileWidened<T>(protocol: string, contract: string, run: () => T): T {
    const coverage = getDescriptor(protocol, contract)!.coverage as {
      typeFidelity: "exact" | "widened";
      caveats: readonly string[];
    };
    const saved = { typeFidelity: coverage.typeFidelity, caveats: coverage.caveats };
    coverage.typeFidelity = "widened";
    coverage.caveats = ["synthetic: computed selectors do not match the deployed contract"];
    try {
      return run();
    } finally {
      Object.assign(coverage, saved);
    }
  }

  it("a widened-selector descriptor is refused by default, quoting the caveat", () => {
    const source = "function main(): Uint256 { return UniswapV4.PoolManager.extsload(1n); }";
    whileWidened("uniswap-v4", "PoolManager", () =>
      expect(() => bytesOf("base", source)).toThrow(/widened.*synthetic/),
    );
  });

  it("allowWidenedSelectors opts in", () => {
    const source = "function main(): Uint256 { return UniswapV4.PoolManager.extsload(1n); }";
    whileWidened("uniswap-v4", "PoolManager", () =>
      expect(
        bytesOf("base", source, { accessors: { allowWidenedSelectors: true } }).length,
      ).toBeGreaterThan(0),
    );
  });

  it("a family-ambiguous contract", () => {
    expect(() => bytesOf("base", "function main() { Uniswap.Factory.method(1n); }")).toThrow(
      /ambiguous/,
    );
  });

  it("an interface is called through .at(address)", () => {
    expect(() =>
      bytesOf("base", "function main() { Erc4626.Vault.deposit(1n, ctx.self()); }"),
    ).toThrow(/Erc4626\.Vault\.at\(address\)/);
  });

  it("a method the ABI does not have", () => {
    expect(() => bytesOf("base", "function main() { AaveV3.Pool.nope(1n); }")).toThrow(/nope/);
  });

  it("accessors: false declares no protocol names", () => {
    expect(() =>
      bytesOf(
        "base",
        `function main() { Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n); }`,
        {
          accessors: false,
        },
      ),
    ).toThrow();
    expect(
      bytesOf("base", "function main(): Uint256 { return 5n; }", { accessors: false }),
    ).toEqual(bytesOf("base", "function main(): Uint256 { return 5n; }"));
  });
});

describe("every registry protocol, every contract kind", () => {
  it("PancakeswapV3.Factory on Base", () => {
    const factory = getDescriptor("pancakeswap-v3", "Factory")!.perChainAddress[8453]!;
    expect(
      bytesOf(
        "base",
        "function main(): Uint256 { return PancakeswapV3.Factory.getPool(1n, 2n, 500n); }",
      ),
    ).toEqual(
      bound(
        "base",
        "IPancakeswapV3_Factory",
        "pancakeswap-v3",
        "Factory",
        `function main(): Uint256 { return IPancakeswapV3_Factory.at(${decimal(factory)}).getPool(1n, 2n, 500n); }`,
      ),
    );
  });

  it("Uniswap V4's StateView and PoolManager.extsload read pool state, on every V4 chain", () => {
    const source = `function main(): Uint256 {
      const poolId = 0x1234n;
      const [sqrtPriceX96, tick, protocolFee, lpFee] = UniswapV4.StateView.getSlot0(poolId);
      const raw = UniswapV4.PoolManager.extsload(poolId);
      return sqrtPriceX96 + UniswapV4.StateView.getLiquidity(poolId) + raw;
    }`;
    for (const slug of getDescriptor("uniswap-v4", "StateView")!.chains) {
      expect(bytesOf(slug, source).length).toBeGreaterThan(0);
    }
    expect(getDescriptor("uniswap-v4", "StateView")!.chains).toEqual(
      getDescriptor("uniswap-v4", "PoolManager")!.chains,
    );
  });

  it("an interface is called at the address the program supplies", () => {
    expect(
      bytesOf(
        "base",
        "function main(): Uint256 { return Erc4626.Vault.at(0x1234n).deposit(1n, ctx.self()); }",
      ),
    ).toEqual(
      bound(
        "base",
        "IErc4626_Vault",
        "erc4626",
        "Vault",
        "function main(): Uint256 { return IErc4626_Vault.at(0x1234n).deposit(1n, ctx.self()); }",
      ),
    );
  });

  it("a deployed contract's ABI reaches another deployment", () => {
    expect(
      bytesOf(
        "base",
        "function main(): Uint256 { return UniswapV3.Factory.at(0x1234n).getPool(1n, 2n, 500n); }",
      ),
    ).toEqual(
      bound(
        "base",
        "IUniswapV3_Factory",
        "uniswap-v3",
        "Factory",
        "function main(): Uint256 { return IUniswapV3_Factory.at(0x1234n).getPool(1n, 2n, 500n); }",
      ),
    );
  });

  it("tells onContract each contract a compile resolves: as written, with its chain and address", () => {
    const heard: Array<[string, string, string, string]> = [];
    bytesOf(
      "base",
      `function main() {
        Uniswap.UniversalRouter.execute("0x0a", ["0x00"], 0n);
        USDC.approve(Cctp.TokenMessenger, 1n);
        Ethereum.AaveV3.Pool.supply(1n, 2n, 3n, 0n);
      }`,
      {
        accessors: {
          onContract: (reference: string, target: AccessorTarget) =>
            heard.push([
              reference,
              target.protocol,
              target.chain.slug,
              target.address.toLowerCase(),
            ]),
        },
      },
    );
    expect(heard).toEqual(
      expect.arrayContaining([
        ["Uniswap.UniversalRouter", "uniswap-v4", "base", BASE_UNIVERSAL_ROUTER],
        ["Ethereum.AaveV3.Pool", "aave-v3", "ethereum", ETHEREUM_AAVE_POOL.toLowerCase()],
        ["Cctp.TokenMessenger", "cctp", "base", expect.stringMatching(/^0x[0-9a-f]{40}$/)],
      ]),
    );
    expect(heard).toHaveLength(3);
  });

  it("the registry's chains are canonical", () => {
    expect(requireChain("base").id).toBe(8453);
  });
});
