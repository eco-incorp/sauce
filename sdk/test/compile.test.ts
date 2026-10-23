import {
  getProtocol,
  getProtocolsByCategory,
  getProtocolsByChain,
} from "../src/protocols/index.js";

describe("protocol registry", () => {
  it("returns undefined for an unknown protocol", () => {
    expect(getProtocol("nonexistent-protocol")).toBeUndefined();
  });

  it("filters exchanges without including lending protocols", () => {
    const exchanges = getProtocolsByCategory("dex");
    expect(exchanges.map((protocol) => protocol.slug)).toContain("uniswap-v3");
    expect(exchanges.map((protocol) => protocol.slug)).not.toContain("aave-v3");
    for (const protocol of exchanges) expect(protocol.category).toBe("dex");
  });

  it("filters lending protocols without including exchanges", () => {
    const lending = getProtocolsByCategory("lending");
    expect(lending.map((protocol) => protocol.slug)).toContain("aave-v3");
    expect(lending.map((protocol) => protocol.slug)).not.toContain("uniswap-v3");
    for (const protocol of lending) expect(protocol.category).toBe("lending");
  });

  it.each([1, 42161])("returns only protocols deployed on chain %i", (chainId) => {
    const deployed = getProtocolsByChain(chainId);
    expect(deployed.map((protocol) => protocol.slug)).toContain("uniswap-v3");
    for (const protocol of deployed) {
      expect(protocol.chains.some((chain) => chain.chainId === chainId)).toBe(true);
    }
  });
});
