/**
 * E2.3: the native on-chain accessor tree — `Base.Uniswap.UniversalRouter.method(...)` — built
 * over the E2.1 descriptor layer. Covers: real-method resolution + address per chain, the family
 * alias (with ambiguity exclusion), per-chain HOLES failing clearly, the widened-coverage caveat
 * gate, `kind:"interface"`/`"address-only"` behavior, and `toCall`/`toSauceScript` output shapes.
 */
import { encodeFunctionData } from "viem";
import { chainContracts, on, type ContractAccessor } from "../src/descriptors/accessors.js";
import type { ContractCall } from "../src/descriptors/call.js";
import { UniswapV4UniversalRouterABI } from "../src/protocols/uniswap-v4/abis.js";

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

describe("descriptors accessors: widened-coverage caveat is observable and gated", () => {
  it("UniswapV3.Factory carries fidelity/caveats, and encode() refuses without the opt-in", () => {
    const base = chainContracts("base");
    const call = invoke(
      base.UniswapV3.Factory,
      "getPool",
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      3000n,
    );
    expect(call.fidelity).toBe("widened");
    expect(call.caveats.length).toBeGreaterThan(0);
    expect(call.method.selector).toBe("0x71c54fc9");
    expect(() => call.encode()).toThrow(/WRONG|WIDENED|allowWidened/i);
    expect(() => call.data).toThrow(/allowWidened/);
    expect(call.encode({ allowWidened: true })).toMatch(/^0x71c54fc9/);
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
    expect(script.baseDirs.length).toBe(2);
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
    const base = chainContracts("base");
    const call = invoke(
      base.UniswapV3.Factory,
      "getPool",
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
      3000n,
    );
    expect(() => call.toSauceScript()).toThrow(/allowWidened/);
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
