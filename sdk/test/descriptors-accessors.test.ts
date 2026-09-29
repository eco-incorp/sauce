/**
 * E2.3: the native on-chain accessor tree — `Base.Uniswap.UniversalRouter.method(...)` — built
 * over the E2.1 descriptor layer. Covers: real-method resolution + address per chain, the family
 * alias (with ambiguity exclusion), per-chain HOLES failing clearly, the widened-coverage caveat
 * gate, `kind:"interface"`/`"address-only"` behavior, and `toCall`/`toSauceScript` output shapes.
 */
import { encodeFunctionData } from "viem";
import { chainContracts, on, type ContractAccessor } from "../src/descriptors/accessors.js";
import type { ContractCall } from "../src/descriptors/call.js";
import { getDescriptor, methodOf, selectorOf } from "../src/descriptors/query.js";
import { UniswapV4UniversalRouterABI } from "../src/protocols/uniswap-v4/abis.js";
import { compileWithRs } from "../src/routes/rs-compile.js";

/** Method names are typed `unknown` on `ContractAccessor` (see accessors.ts's own doc comment) —
 *  this test file's job is RUNTIME behavior, so every call site casts through this one helper
 *  rather than sprinkling `as any` inline. */
function invoke(accessor: ContractAccessor, method: string, ...args: unknown[]): ContractCall {
  return (accessor[method] as (...a: unknown[]) => ContractCall)(...args);
}

describe("descriptors accessors: the motivating path", () => {
  it("Base.UniswapV4.UniversalRouter.execute(...) resolves the real Base address and encodes correctly", () => {
    const base = chainContracts("base");
    const call = invoke(base.UniswapV4.UniversalRouter, "execute", "0x00", ["0x01"], 999n);
    expect(call.address).toBe("0x6fF5693b99212Da76ad316178A184AB56D299b43");
    expect(call.protocol).toBe("uniswap-v4");
    expect(call.contract).toBe("UniversalRouter");
    expect(call.fidelity).toBe("exact");
    const expected = encodeFunctionData({
      abi: UniswapV4UniversalRouterABI,
      functionName: "execute",
      args: ["0x00", ["0x01"], 999n],
    });
    expect(call.data).toBe(expected);
    expect(call.encode()).toBe(expected);
  });

  // The Universal Router declares two `execute`s, with and without a deadline. The call must
  // report the overload it encodes: the selector on the `ContractCall` and the one its data starts
  // with are the same, for each argument count.
  it("an overloaded method dispatches on argument count, and reports the overload it encodes", () => {
    const router = chainContracts("base").UniswapV4.UniversalRouter;
    const withDeadline = invoke(router, "execute", "0x00", ["0x01"], 999n);
    const withoutDeadline = invoke(router, "execute", "0x00", ["0x01"]);

    expect(withDeadline.method.signature).toBe("execute(bytes,bytes[],uint256)");
    expect(withDeadline.method.selector).toBe("0x3593564c");
    expect(withDeadline.data.startsWith(withDeadline.method.selector)).toBe(true);
    expect(withoutDeadline.method.signature).toBe("execute(bytes,bytes[])");
    expect(withoutDeadline.method.selector).toBe("0x24856bc3");
    expect(withoutDeadline.data.startsWith(withoutDeadline.method.selector)).toBe(true);
    expect(withoutDeadline.data).toBe(
      encodeFunctionData({
        abi: UniswapV4UniversalRouterABI,
        functionName: "execute",
        args: ["0x00", ["0x01"]],
      }),
    );
    expect(() => invoke(router, "execute", "0x00")).toThrow(
      "uniswap-v4.UniversalRouter.execute takes 3 or 2 arguments, got 1",
    );
  });

  it("methodOf and selectorOf pick an overload by arity, and the first declared without one", () => {
    const router = getDescriptor("uniswap-v4", "UniversalRouter")!;
    expect(methodOf(router, "execute", 2)?.selector).toBe("0x24856bc3");
    expect(methodOf(router, "execute", 3)?.selector).toBe("0x3593564c");
    expect(methodOf(router, "execute", 1)).toBeUndefined();
    expect(selectorOf(router, "execute")).toBe("0x3593564c");
  });

  it("`on(...)` (the import-based front door) is equivalent to chainContracts(...)", () => {
    const call = invoke(on("base").UniswapV4.UniversalRouter, "execute", "0x00", [], 1n);
    expect(call.address).toBe("0x6fF5693b99212Da76ad316178A184AB56D299b43");
  });
});

describe("descriptors accessors: family alias", () => {
  it("Base.Uniswap.UniversalRouter and Base.UniswapV4.UniversalRouter are the SAME accessor object", () => {
    const base = chainContracts("base");
    expect(base.Uniswap.UniversalRouter).toBe(base.UniswapV4.UniversalRouter);
  });

  it("an ambiguous family contract name (Factory, owned by both uniswap-v2 and uniswap-v3) is EXCLUDED from the type (TS2339) and throws at runtime", () => {
    const base = chainContracts("base");
    // @ts-expect-error -- "Factory" is deliberately excluded from FamilyContracts<"Uniswap"> (ambiguous: uniswap-v2 AND uniswap-v3 both own it).
    expect(() => base.Uniswap.Factory).toThrow(
      /ambiguous under Uniswap.*uniswap-v2.*uniswap-v3|UniswapV2\.Factory or UniswapV3\.Factory/,
    );
  });

  it("the unambiguous canonical path still works for the same contract name", () => {
    const base = chainContracts("base");
    expect(base.UniswapV3.Factory).toBeDefined();
    expect(base.UniswapV3.Factory.descriptor.contract).toBe("Factory");
  });
});

describe("descriptors accessors: per-chain holes fail clearly", () => {
  it("Ethereum.Aerodrome.Router (Aerodrome is Base-only) throws naming the chain and the available chains, only on a method call", () => {
    const ethereum = chainContracts("ethereum");
    const router = ethereum.Aerodrome.Router;
    expect(router.available).toBe(false);
    expect(router.address).toBeUndefined();
    expect(router.chains).toContain("base");
    expect(() => router.swapExactTokensForTokens).not.toThrow();
    expect(() => invoke(router, "swapExactTokensForTokens", 1n, 0n, [], "0x0", 0n)).toThrow(
      /not deployed on 'ethereum'.*available: base/,
    );
  });

  it("the same contract IS available on Base", () => {
    const base = chainContracts("base");
    expect(base.Aerodrome.Router.available).toBe(true);
    expect(base.Aerodrome.Router.address).toBeDefined();
  });
});

/**
 * No registry ABI is widened any more (test/registry-abi.test.ts pins every selector against the
 * deployed code), so the gate is exercised by marking a real descriptor widened for one test.
 */
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

describe("descriptors accessors: widened-coverage caveat is observable and gated", () => {
  const getPool = () =>
    invoke(
      chainContracts("base").UniswapV3.Factory,
      "getPool",
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      3000n,
    );

  it("a widened descriptor carries fidelity/caveats, and encode() refuses without the opt-in", () => {
    whileWidened("uniswap-v3", "Factory", () => {
      const call = getPool();
      expect(call.fidelity).toBe("widened");
      expect(call.caveats.length).toBeGreaterThan(0);
      expect(() => call.encode()).toThrow(/WRONG|WIDENED|allowWidened/i);
      expect(() => call.data).toThrow(/allowWidened/);
      expect(call.encode({ allowWidened: true })).toMatch(/^0x1698ee82/);
    });
  });

  it("UniswapV3.Factory is exact: getPool(address,address,uint24), the deployed selector", () => {
    const call = getPool();
    expect(call.fidelity).toBe("exact");
    expect(call.method.selector).toBe("0x1698ee82");
    expect(call.encode()).toMatch(/^0x1698ee82/);
  });

  it("an exact-fidelity descriptor needs no opt-in", () => {
    const base = chainContracts("base");
    const call = invoke(base.UniswapV4.UniversalRouter, "execute", "0x00", [], 1n);
    expect(call.fidelity).toBe("exact");
    expect(() => call.encode()).not.toThrow();
  });
});

describe("descriptors accessors: interface + address-only kinds", () => {
  it("Base.Erc20.ERC20.transfer throws before binding an instance", () => {
    const base = chainContracts("base");
    expect(() =>
      invoke(base.Erc20.ERC20, "transfer", "0x1111111111111111111111111111111111111111", 1n),
    ).toThrow(/bind an instance/);
  });

  it("Base.Erc20.ERC20.at(addr).transfer(...) encodes correctly once bound", () => {
    const base = chainContracts("base");
    const bound = base.Erc20.ERC20.at("0x1111111111111111111111111111111111111111");
    const call = invoke(bound, "transfer", "0x2222222222222222222222222222222222222222", 5n);
    expect(call.address).toBe("0x1111111111111111111111111111111111111111");
    expect(call.data.startsWith("0xa9059cbb")).toBe(true);
  });

  it("an address-only descriptor (AaveV3.PoolAddressesProvider) has zero methods but a real address", () => {
    const base = chainContracts("base");
    const accessor = base.AaveV3.PoolAddressesProvider;
    expect(accessor.methods.length).toBe(0);
    expect(accessor.abi.length).toBe(0);
  });
});

describe("descriptors accessors: toCall / toSauceScript", () => {
  it("toCall() returns the routes CallInput shape", () => {
    const base = chainContracts("base");
    const call = invoke(base.UniswapV4.UniversalRouter, "execute", "0x00", [], 1n);
    const asCall = call.toCall();
    expect(asCall).toEqual({ target: call.address, data: call.data, value: 0n });
  });

  it("toSauceScript() emits an import line + at(...).method(...) statement using real ABI json path", () => {
    const base = chainContracts("base");
    const call = invoke(
      base.AaveV3.Pool,
      "supply",
      "0x1111111111111111111111111111111111111111",
      100n,
      "0x2222222222222222222222222222222222222222",
      0,
    );
    const script = call.toSauceScript();
    expect(script.imports[0]).toBe('import { Pool } from "./protocols/aave-v3/PoolABI.json";');
    expect(script.statement).toMatch(/^Pool\.at\(\d+n\)\.supply\(/);
    // The route compiler serves that import itself: the program compiles with no resolver option.
    expect(
      compileWithRs({ source: script.source, target: "v12" }).bytecode[0]!.length,
    ).toBeGreaterThan(0);
  });

  it("toSauceScript() renders an unsafe number argument as no literal at all", () => {
    // The rendered text becomes compiled bytecode, and the number has already been rounded:
    // BigInt() would bake 1234567890123456768n, .toString() 1234567890123456800n.
    const base = chainContracts("base");
    const call = invoke(
      base.AaveV3.Pool,
      "supply",
      "0x1111111111111111111111111111111111111111",
      // The imprecise literal IS the input under test: it asserts the safe-integer guard
      // rejects it before anything reads a rounded value.
      // eslint-disable-next-line no-loss-of-precision
      1234567890123456789,
      "0x2222222222222222222222222222222222222222",
      0,
    );
    expect(() => call.toSauceScript()).toThrow(
      "toSauceScript: number argument for supply: expected a safe integer, got 1234567890123456800 — pass a bigint or a string instead",
    );
  });

  it("toSauceScript() renders a number argument at MAX_SAFE_INTEGER exactly", () => {
    const base = chainContracts("base");
    const call = invoke(
      base.AaveV3.Pool,
      "supply",
      "0x1111111111111111111111111111111111111111",
      Number.MAX_SAFE_INTEGER,
      "0x2222222222222222222222222222222222222222",
      0,
    );
    expect(call.toSauceScript().statement).toContain("9007199254740991n");
  });

  it("a widened call refuses toSauceScript too", () => {
    whileWidened("uniswap-v3", "Factory", () => {
      const call = invoke(
        chainContracts("base").UniswapV3.Factory,
        "getPool",
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
        3000n,
      );
      expect(() => call.toSauceScript()).toThrow(/allowWidened/);
    });
  });
});

describe("descriptors accessors: laziness", () => {
  it("a namespace access is a memoising getter, not eager construction", () => {
    const base = chainContracts("base");
    const desc = Object.getOwnPropertyDescriptor(base, "UniswapV4");
    expect(typeof desc?.get).toBe("function");
    expect(base.UniswapV4).toBe(base.UniswapV4);
    expect(base.UniswapV4.UniversalRouter).toBe(base.UniswapV4.UniversalRouter);
  });
});
