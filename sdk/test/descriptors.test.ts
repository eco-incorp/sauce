/**
 * CONTRACT for the descriptor layer's model + query API (../src/descriptors).
 *
 * Golden selectors, chain-ref equivalence, hole representation (E2.4 seam),
 * the three ContractKinds, and the reverse index.
 */
import {
  DESCRIPTORS,
  describeContract,
  requireContract,
  getDescriptor,
  listContracts,
  listDescriptors,
  listInterfaces,
  contractsOnChain,
  protocolsOnChain,
  addressOn,
  methodOf,
  selectorOf,
  descriptorChains,
} from "../src/descriptors/index.js";
import { chainById } from "../src/chains/canonical.js";
import { listProtocolSlugs } from "../src/protocols/index.js";

describe("descriptors: golden selectors", () => {
  it("correct: erc20.transfer", () => {
    const d = getDescriptor("erc20", "ERC20")!;
    expect(selectorOf(d, "transfer")).toBe("0xa9059cbb");
  });

  it("correct: aave-v3.Pool.supply", () => {
    const d = getDescriptor("aave-v3", "Pool")!;
    expect(selectorOf(d, "supply")).toBe("0x617ba037");
  });

  it("correct: uniswap-v4.UniversalRouter.execute", () => {
    const d = getDescriptor("uniswap-v4", "UniversalRouter")!;
    expect(selectorOf(d, "execute")).toBe("0x3593564c");
  });

  it("correct: uniswap-v3.Factory.getPool (uint24 fee, the deployed selector)", () => {
    const d = getDescriptor("uniswap-v3", "Factory")!;
    expect(selectorOf(d, "getPool")).toBe("0x1698ee82");
    expect(d.coverage.typeFidelity).toBe("exact");
  });

  it("correct: uniswap-v3.SwapRouter02.exactInputSingle has no deadline field", () => {
    const d = getDescriptor("uniswap-v3", "SwapRouter02")!;
    expect(selectorOf(d, "exactInputSingle")).toBe("0x04e45aaf");
  });

  it("no linked descriptor is widened", () => {
    expect(listDescriptors().filter((d) => d.coverage.typeFidelity === "widened")).toEqual([]);
  });
});

describe("descriptors: the epic's motivating path", () => {
  it("Base.Uniswap-v4.UniversalRouter resolves end to end", () => {
    const resolved = describeContract("base", "uniswap-v4", "UniversalRouter");
    expect(resolved).toBeDefined();
    expect(resolved!.address).toBeDefined();
    expect(resolved!.methods.size).toBe(1);
    expect(resolved!.methods.get("execute")).toBeDefined();
  });
});

describe("descriptors: chain-ref equivalence", () => {
  it("number, bigint, slug string, and mixed-case name all resolve identically", () => {
    const byNumber = describeContract(8453, "uniswap-v4", "UniversalRouter");
    const byBigint = describeContract(8453n, "uniswap-v4", "UniversalRouter");
    const bySlug = describeContract("base", "uniswap-v4", "UniversalRouter");
    const byName = describeContract("Base", "uniswap-v4", "UniversalRouter");
    expect(byNumber?.address).toBe(byBigint?.address);
    expect(byNumber?.address).toBe(bySlug?.address);
    expect(byNumber?.address).toBe(byName?.address);
    expect(byNumber?.address).toBeDefined();
  });

  it("chainById(8453) as a ChainRef resolves the same descriptor", () => {
    const canonical = chainById(8453)!;
    const resolved = describeContract(canonical, "uniswap-v4", "UniversalRouter");
    expect(resolved?.address).toBe(
      describeContract(8453, "uniswap-v4", "UniversalRouter")?.address,
    );
  });
});

describe("descriptors: contract-name normalization", () => {
  it("'universalrouter' / 'UniversalRouter' / 'universal-router' all resolve", () => {
    const a = getDescriptor("uniswap-v4", "universalrouter");
    const b = getDescriptor("uniswap-v4", "UniversalRouter");
    const c = getDescriptor("uniswap-v4", "universal-router");
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("an unknown contract returns undefined and requireContract throws listing the known set", () => {
    expect(getDescriptor("uniswap-v4", "NopeContract")).toBeUndefined();
    expect(() => requireContract("base", "uniswap-v4", "NopeContract")).toThrow(
      /Unknown contract 'NopeContract' in protocol 'uniswap-v4' \(known: /,
    );
  });

  it("an unknown protocol throws listing the known protocol set", () => {
    expect(() => requireContract("base", "not-a-real-protocol", "X")).toThrow(
      /Unknown protocol 'not-a-real-protocol'/,
    );
  });

  it("a known contract not deployed on a given chain throws naming the available chains", () => {
    expect(() => requireContract("ethereum", "aerodrome", "Router")).toThrow(
      /not deployed on 'ethereum' \(available: base\)/,
    );
  });
});

describe("descriptors: hole representation (E2.4 seam)", () => {
  it("uniswap-v3 QuoterV2 resolves on ethereum + monad + arc, undefined on base (the hole)", () => {
    const d = getDescriptor("uniswap-v3", "QuoterV2")!;
    // QuoterV2 is vendored only where the deploy record carries it — ethereum, monad and arc — and
    // is a genuine hole on base (whose entry omits quoterV2). The hole on base is the load-bearing
    // part.
    expect(d.chains).toEqual(["ethereum", "monad", "arc"]);
    expect(describeContract("ethereum", "uniswap-v3", "QuoterV2")).toBeDefined();
    expect(describeContract("monad", "uniswap-v3", "QuoterV2")).toBeDefined();
    expect(describeContract("arc", "uniswap-v3", "QuoterV2")).toBeDefined();
    expect(describeContract("base", "uniswap-v3", "QuoterV2")).toBeUndefined();
  });

  it("swapRouter (4 chains, no Base) vs swapRouter02 (5 chains, incl. Base) reflect the real uneven vendored coverage", () => {
    const swapRouter = getDescriptor("uniswap-v3", "SwapRouter")!;
    const swapRouter02 = getDescriptor("uniswap-v3", "SwapRouter02")!;
    expect(swapRouter.chains).not.toContain("base");
    expect(swapRouter02.chains).toContain("base");
    expect(swapRouter02.chains.length).toBeGreaterThan(swapRouter.chains.length);
  });
});

describe("descriptors: kind:'interface'", () => {
  it("erc20 has 9 methods, no addresses, no chains, absent from contractsOnChain, present in listInterfaces", () => {
    const d = getDescriptor("erc20", "ERC20")!;
    expect(d.kind).toBe("interface");
    expect(d.methods.length).toBe(9);
    expect(d.perChainAddress).toEqual({});
    expect(d.chains).toEqual([]);
    expect(contractsOnChain("base")).not.toContain(d);
    expect(listInterfaces()).toContain(d);
  });
});

describe("descriptors: kind:'address-only'", () => {
  it("aave-v3 PoolAddressesProvider has real addresses, zero abi/methods, and a caveat", () => {
    const d = getDescriptor("aave-v3", "PoolAddressesProvider")!;
    expect(d.kind).toBe("address-only");
    expect(d.abi).toEqual([]);
    expect(d.methods).toEqual([]);
    expect(d.chains.length).toBeGreaterThan(0);
    expect(d.coverage.caveats.length).toBeGreaterThan(0);
  });
});

describe("descriptors: many-to-one ABI sharing (compound-v3)", () => {
  it("cUSDCv3/cWETHv3/cUSDTv3 share CometABI, have distinct addresses, identical method sets", () => {
    // Named by role key: each Comet market is its own deployment of one ABI.
    const usdc = getDescriptor("compound-v3", "CUSDCv3")!;
    const weth = getDescriptor("compound-v3", "CWETHv3")!;
    const usdt = getDescriptor("compound-v3", "CUSDTv3")!;
    expect(usdc.abiExport).toBe("CometABI");
    expect(weth.abiExport).toBe("CometABI");
    expect(usdt.abiExport).toBe("CometABI");
    expect(usdc.methods.map((m) => m.name)).toEqual(weth.methods.map((m) => m.name));
    expect(usdc.methods.map((m) => m.name)).toEqual(usdt.methods.map((m) => m.name));
    const usdcAddr = addressOn(usdc, "ethereum");
    const wethAddr = addressOn(weth, "ethereum");
    expect(usdcAddr).toBeDefined();
    expect(wethAddr).toBeDefined();
    expect(usdcAddr).not.toBe(wethAddr);
  });
});

describe("descriptors: reverse index", () => {
  it("contractsOnChain('base') is non-empty and every descriptor has an address for 8453", () => {
    const onBase = contractsOnChain("base");
    expect(onBase.length).toBeGreaterThan(0);
    for (const d of onBase) {
      expect(addressOn(d, "base")).toBeDefined();
      expect(d.kind).not.toBe("interface");
    }
  });

  it("contractsOnChain('solana') is [] -- a Solana program id under a role is no EVM contract", () => {
    expect(contractsOnChain("solana")).toEqual([]);
  });

  it("protocolsOnChain('base') returns deduped ProtocolInfo entries backing at least one on-chain descriptor", () => {
    const protocolInfos = protocolsOnChain("base");
    const slugs = protocolInfos.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("uniswap-v4");
  });
});

describe("descriptors: registry totals + purity", () => {
  it("covers every registry protocol: a tripwire against silent table drift", () => {
    const protocolSlugs = new Set(DESCRIPTORS.map((d) => d.protocol));
    const kinds = (kind: string) => DESCRIPTORS.filter((d) => d.kind === kind).length;
    expect(protocolSlugs).toEqual(new Set(listProtocolSlugs()));
    expect(DESCRIPTORS.length).toBe(318);
    expect(kinds("singleton")).toBe(228);
    expect(kinds("address-only")).toBe(51);
    expect(kinds("interface")).toBe(39);
  });

  it("listDescriptors() is stable/reference-equal across calls, and mutating a returned perChainAddress does not corrupt the registry", () => {
    const a = listDescriptors();
    const b = listDescriptors();
    expect(a).toBe(b);
    const d = getDescriptor("uniswap-v4", "UniversalRouter")!;
    const mutableCopy = { ...d.perChainAddress };
    mutableCopy[999999] = "0x0000000000000000000000000000000000000000" as `0x${string}`;
    expect(getDescriptor("uniswap-v4", "UniversalRouter")!.perChainAddress[999999]).toBeUndefined();
  });

  it("(protocol, contract) pairs are unique across the whole registry", () => {
    const keys = DESCRIPTORS.map((d) => `${d.protocol}::${d.contract}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("descriptors: listContracts / descriptorChains", () => {
  it("listContracts('uniswap-v3') returns all 6 uniswap-v3 descriptors", () => {
    expect(listContracts("uniswap-v3").length).toBe(6);
  });

  it("descriptorChains resolves to real CanonicalChain records matching descriptor.chains", () => {
    const d = getDescriptor("permit2", "Permit2")!;
    const resolved = descriptorChains(d);
    expect(resolved.map((c) => c.slug)).toEqual(d.chains);
  });

  it("methodOf returns undefined for an unknown method name", () => {
    const d = getDescriptor("permit2", "Permit2")!;
    expect(methodOf(d, "notAMethod")).toBeUndefined();
  });
});
