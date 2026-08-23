/**
 * P8 — `loadPluginData()` as the single declarative accessor over the plugin manifest
 * (`ambient`/`nameParity`) plus the two in-place registries it re-exposes verbatim
 * (`descriptors/registry.ts#DESCRIPTORS`, `routes/token-registry.ts#resolveTokenMap`).
 */
import { requireChain } from "../src/chains/canonical.js";
import { getDescriptor, addressOn } from "../src/descriptors/query.js";
import { DESCRIPTORS } from "../src/descriptors/registry.js";
import { loadPlugin, loadPluginData, pluginNameParity } from "../src/plugin/index.js";
import { chainDefines } from "../src/routes/ambient.js";
import { pascalOfSlug } from "../src/routes/builder.js";
import { resolveTokenMap } from "../src/routes/token-registry.js";

describe("loadPluginData", () => {
  it("carries the manifest's ambient/nameParity unchanged, same as loadPlugin()", () => {
    const plugin = loadPlugin();
    const data = loadPluginData();
    expect(data.ambient).toEqual(plugin.ambient);
    expect(data.nameParity).toEqual(plugin.nameParity);
  });

  it("protocolAddresses is the SAME array reference as descriptors/registry.ts's DESCRIPTORS, not a copy", () => {
    expect(loadPluginData().protocolAddresses).toBe(DESCRIPTORS);
  });

  it("tokens is the SAME function reference as token-registry.ts's resolveTokenMap, not a copy", () => {
    expect(loadPluginData().tokens).toBe(resolveTokenMap);
  });

  it("a spot-check: a known protocol/chain address from protocolAddresses matches DESCRIPTORS read independently", () => {
    const descriptor = getDescriptor("uniswap-v4", "UniversalRouter");
    expect(descriptor).toBeDefined();
    const base = requireChain("base");
    const address = addressOn(descriptor!, base);
    expect(address).toBeDefined();

    const viaPlugin = loadPluginData().protocolAddresses.find(
      (d) => d.protocol === "uniswap-v4" && d.contract === "UniversalRouter",
    );
    expect(viaPlugin?.perChainAddress[base.id]).toBe(address);
  });

  it("a spot-check: tokens() resolves base's registry USDC the same as resolveTokenMap directly", () => {
    const base = requireChain("base");
    const direct = resolveTokenMap(base);
    const viaPlugin = loadPluginData().tokens(base);
    expect(viaPlugin.get("USDC")).toBe(direct.get("USDC"));
    expect(viaPlugin.get("USDC")).toBe(BigInt("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"));
  });
});

describe("pluginNameParity", () => {
  it("is live and matches the manifest's declared parity map", () => {
    expect(pluginNameParity()).toEqual({ emit: "log", throw: "revert" });
    expect(pluginNameParity().emit).toBe("log");
    expect(pluginNameParity().throw).toBe("revert");
  });
});

describe("chainDefines byte-identity after routing through loadPluginData()", () => {
  it("produces the exact same map for base as reading DESCRIPTORS/resolveTokenMap directly (pre-refactor shape)", () => {
    const base = requireChain("base");
    const defines = chainDefines(base);

    // Pre-refactor equivalent: build the expected map by hand from the same two registries
    // chainDefines used to import directly, proving the P8 indirection changed nothing observable.
    const expected: Record<string, bigint | boolean | number> = {
      chainId: BigInt(base.id),
      CHAIN_ID: BigInt(base.id),
    };
    for (const d of DESCRIPTORS) {
      const address = d.perChainAddress[base.id];
      if (address === undefined) continue;
      const key = `${pascalOfSlug(d.protocol)}_${d.contract}`;
      expected[key] = BigInt(address);
    }
    for (const [symbol, address] of resolveTokenMap(base)) {
      expected[symbol] = address;
    }

    expect(defines).toEqual(expected);
    expect(Object.keys(defines).sort()).toEqual(Object.keys(expected).sort());
  });

  it("known spot-checks unaffected: chainId, a real protocol address, and registry token defaults", () => {
    const base = requireChain("base");
    const defines = chainDefines(base);
    expect(defines.chainId).toBe(8453n);
    expect(defines.USDC).toBe(BigInt("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"));
    expect(defines.WETH).toBe(BigInt("0x4200000000000000000000000000000000000006"));
  });
});
