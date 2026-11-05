/**
 * A registry ABI is the union of what a role's deployments run, so one chain's deployment may lack
 * some of it (`ContractDescriptor.withheldOn`), or declare some of it otherwise (`shapesOn`). A
 * program, and a host accessor, is held to what the chain's own deployment runs (`descriptorOn`):
 * the names module binds that ABI, a call to what it withholds is refused naming the chains that
 * run it, what it declares otherwise is called as it declares it, and the rest compiles as ever.
 */
import { toFunctionSignature, type Abi } from "viem";
import { requireChain } from "../src/chains/canonical.js";
import { chainContracts, type ContractAccessor } from "../src/descriptors/accessors.js";
import type { ContractCall } from "../src/descriptors/call.js";
import { descriptorOn } from "../src/descriptors/derive.js";
import { getDescriptor } from "../src/descriptors/query.js";
import { DESCRIPTORS } from "../src/descriptors/registry.js";
import { CHAIN_MODULE_ROOT, chainModuleText, chainNames } from "../src/routes/chain-module.js";
import { methodListing } from "../src/routes/method-refusals.js";
import { rewriteProtocolAccessors } from "../src/routes/protocol-rewrite.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";
import { sourceGlobals } from "../src/routes/source-globals.js";

const hex = (chain: string, source: string): string =>
  Buffer.from(compileSauceProgram(chain, source).bytecode).toString("hex");

/** The message `source` is refused with on `chain`. */
function refusal(chain: string, source: string): string {
  try {
    compileSauceProgram(chain, source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`compiled on ${chain}: ${source}`);
}

/** A host accessor's method, called whatever its type says (`descriptors-accessors.test.ts`). */
function invoke(accessor: ContractAccessor, method: string, ...args: unknown[]): ContractCall {
  return (
    (accessor as unknown as Record<string, unknown>)[method] as (...a: unknown[]) => ContractCall
  )(...args);
}

/** The path `chain`'s names module imports `<namespace>.<contract>`'s ABI from, and its text. */
function boundAbi(chain: string, namespace: string, contract: string): [string, string] {
  const { text } = chainNames(requireChain(chain));
  const literal = text.split("\n").find((line) => line.startsWith(`export const ${namespace} =`))!;
  const binding = new RegExp(`\\b${contract}: (ABI_\\d+)\\.at\\(`).exec(literal)![1]!;
  const path = new RegExp(`^import ${binding} from "\\./(.*)";$`, "m").exec(text)![1]!;

  return [path, chainModuleText(`${CHAIN_MODULE_ROOT}/${path}`)!];
}

const functionNames = (abi: Abi): string[] =>
  abi.flatMap((item) => (item.type === "function" ? [item.name] : []));

const CBETH = getDescriptor("cbeth", "CbETH")!;
const BASE = requireChain("base");
const ETHEREUM = requireChain("ethereum");

describe("descriptorOn: a contract as one chain's deployment runs it", () => {
  it("is the descriptor itself where nothing is withheld, and one stable view where something is", () => {
    const factory = getDescriptor("uniswap-v3", "Factory")!;
    expect(factory.withheldOn).toEqual({});
    expect(descriptorOn(factory, BASE.id)).toBe(factory);
    // No deployment on the chain: nothing to withhold.
    expect(CBETH.chains).not.toContain("optimism");
    expect(descriptorOn(CBETH, requireChain("optimism").id)).toBe(CBETH);

    const onBase = descriptorOn(CBETH, BASE.id);
    expect(onBase).not.toBe(CBETH);
    expect(descriptorOn(CBETH, BASE.id)).toBe(onBase);
    expect(descriptorOn(CBETH, ETHEREUM.id)).not.toBe(onBase);
    const withheld = new Set(CBETH.withheldOn[BASE.id]);
    expect(withheld.has("exchangeRate()")).toBe(true);
    // Base's deployment declares `mint` with no return value: the view carries its declaration.
    const [baseMint, ...more] = CBETH.shapesOn[BASE.id]!;
    expect(more).toEqual([]);
    expect(toFunctionSignature(baseMint!)).toBe("mint(address,uint256)");
    expect(baseMint!.outputs).toEqual([]);
    expect(onBase.methods).toEqual(
      CBETH.methods
        .filter((m) => !withheld.has(m.signature))
        .map((m) =>
          m.signature === "mint(address,uint256)"
            ? { ...m, inputs: baseMint!.inputs, outputs: baseMint!.outputs }
            : m,
        ),
    );
    expect(functionNames(onBase.abi)).toEqual(onBase.methods.map((m) => m.name));
    expect(onBase.abi).toContain(baseMint);
    // Events and errors stay; everything else is the descriptor's.
    expect(onBase.abi.filter((item) => item.type !== "function")).toEqual(
      CBETH.abi.filter((item) => item.type !== "function"),
    );
    expect(onBase.perChainAddress).toBe(CBETH.perChainAddress);
    expect(onBase.coverage).toBe(CBETH.coverage);
    expect(onBase.withheldOn).toBe(CBETH.withheldOn);
    expect(onBase.shapesOn).toBe(CBETH.shapesOn);
  });

  it("withholds, and serves declared otherwise, only functions of the descriptor's own ABI, on chains it is deployed on", () => {
    let withholding = 0;
    let reshaping = 0;
    for (const descriptor of DESCRIPTORS) {
      const entries = Object.entries(descriptor.withheldOn);
      const shaped = Object.entries(descriptor.shapesOn);
      if (entries.length === 0 && shaped.length === 0) continue;
      expect(descriptor.kind).toBe("singleton");
      const signatures = new Set(descriptor.methods.map((m) => m.signature));
      if (entries.length > 0) withholding++;
      for (const [id, lacking] of entries) {
        expect(descriptor.perChainAddress[Number(id)]).toBeDefined();
        expect(lacking.filter((signature) => !signatures.has(signature))).toEqual([]);
      }
      if (shaped.length > 0) reshaping++;
      for (const [id, declared] of shaped) {
        expect(descriptor.perChainAddress[Number(id)]).toBeDefined();
        const lacking = new Set(descriptor.withheldOn[Number(id)] ?? []);
        for (const fn of declared) {
          const signature = toFunctionSignature(fn);
          // A function of the ABI, not withheld there, declared otherwise than the ABI does.
          expect(signatures.has(signature)).toBe(true);
          expect(lacking.has(signature)).toBe(false);
          const own = descriptor.methods.find((m) => m.signature === signature)!;
          expect([fn.outputs, fn.stateMutability, fn.inputs]).not.toEqual([
            own.outputs,
            own.stateMutability,
            own.inputs,
          ]);
        }
      }
    }
    expect(withholding).toBeGreaterThan(0);
    expect(reshaping).toBeGreaterThan(0);
  });
});

describe("a function a chain's deployment declares otherwise is called as it declares it", () => {
  const REWARDS = getDescriptor("compound-v3", "CometRewards")!;
  const POLYGON = requireChain("polygon");
  /** A program returning one field of `rewardConfig(comet)` (a `bool` is a number to the compiler). */
  const field = (name: string): string =>
    `function main(comet: Address): Uint256 { const config = CompoundV3.CometRewards.rewardConfig(comet); return config.${name}; }`;

  it("Ethereum's and Polygon's CometRewards declare rewardConfig with three fields, Base's with four", () => {
    const fields = (chainId: number): string[] =>
      descriptorOn(REWARDS, chainId)
        .methods.find((m) => m.name === "rewardConfig")!
        .outputs.map((o) => o.name ?? "");
    expect(fields(ETHEREUM.id)).toEqual(["token", "rescaleFactor", "shouldUpscale"]);
    expect(fields(POLYGON.id)).toEqual(["token", "rescaleFactor", "shouldUpscale"]);
    expect(fields(BASE.id)).toEqual(["token", "rescaleFactor", "shouldUpscale", "multiplier"]);
    // The ABI, its twin and the host types keep the four-field declaration.
    expect(REWARDS.methods.find((m) => m.name === "rewardConfig")!.outputs).toHaveLength(4);
    expect(REWARDS.withheldOn[ETHEREUM.id]).not.toContain("rewardConfig(address)");
  });

  it("on Ethereum, rewardConfig(comet) compiles and its third field reads; a fourth is refused", () => {
    const call = "function main(comet: Address) { CompoundV3.CometRewards.rewardConfig(comet); }";
    expect(hex("ethereum", call)).toContain("2289b6b8");
    expect(hex("ethereum", field("shouldUpscale"))).toContain("2289b6b8");
    expect(hex("ethereum", field("rescaleFactor"))).toContain("2289b6b8");
    const fourth =
      "`multiplier` is not a field of this tuple — its named fields are `token`, `rescaleFactor`, `shouldUpscale`";
    expect(refusal("ethereum", field("multiplier"))).toContain(fourth);
    expect(refusal("polygon", field("multiplier"))).toContain(fourth);
  });

  it("on Base, the four-field form compiles", () => {
    expect(hex("base", field("multiplier"))).toContain("2289b6b8");
    expect(hex("base", field("shouldUpscale"))).toContain("2289b6b8");
  });

  it("each chain's names module imports its deployment's declaration", () => {
    const [ethereumPath, ethereumText] = boundAbi("ethereum", "CompoundV3", "CometRewards");
    expect(ethereumPath).toMatch(/^abi\/compound-v3\/CometRewardsABI-[0-9a-f]{8}\.json$/);
    const served = (text: string) =>
      (JSON.parse(text) as Abi).find(
        (item) => item.type === "function" && item.name === "rewardConfig",
      );
    expect(served(ethereumText)).toEqual(REWARDS.shapesOn[ETHEREUM.id]![0]);
    expect(boundAbi("polygon", "CompoundV3", "CometRewards")[0]).toBe(ethereumPath);
    const [, baseText] = boundAbi("base", "CompoundV3", "CometRewards");
    expect(served(baseText)).toEqual(
      REWARDS.abi.find((item) => item.type === "function" && item.name === "rewardConfig"),
    );
  });

  it("Base's CbETH mint, which its deployment declares with no return value, compiles there", () => {
    const mint = "function main(to: Address, amount: Uint256) { Cbeth.CbETH.mint(to, amount); }";
    expect(hex("base", mint)).toContain("40c10f19");
    expect(hex("ethereum", mint)).toContain("40c10f19");
  });

  it("a host accessor calls the chain's declaration, and toSauceScript refuses it", () => {
    const comet = `0x${"11".repeat(20)}`;
    const ethereum = chainContracts("ethereum").CompoundV3
      .CometRewards as unknown as ContractAccessor;
    const call = invoke(ethereum, "rewardConfig", comet);
    expect(call.data.slice(0, 10)).toBe("0x2289b6b8");
    expect(call.method.outputs).toHaveLength(3);
    expect(() => call.toSauceScript()).toThrow(
      /^toSauceScript: compound-v3\.CometRewards\.rewardConfig: its deployment on ethereum declares rewardConfig\(address\) otherwise than CometRewardsABI\.json/,
    );
    const base = chainContracts("base").CompoundV3.CometRewards as unknown as ContractAccessor;
    expect(invoke(base, "rewardConfig", comet).method.outputs).toHaveLength(4);
  });
});

describe("a program is held to its chain's deployment", () => {
  const RATE = "function main(): Uint256 { return Cbeth.CbETH.exchangeRate(); }";

  it("a method the chain's deployment withholds is refused there, naming the chains that run it", () => {
    expect(() => hex("ethereum", RATE)).not.toThrow();
    expect(refusal("base", RATE)).toBe(
      [
        "compileSauceRoute: `Cbeth.CbETH.exchangeRate(…)`: `exchangeRate` is in cbeth.CbETH's ABI, but its deployment on base does not run it (as declared); it is on: ethereum.",
        " --> main.js:1:47",
        "  |",
        "1 | function main(): Uint256 { return Cbeth.CbETH.exchangeRate(); }",
        "  |                                               ^^^^^^^^^^^^",
      ].join("\n"),
    );
    // Read uncalled, the same.
    expect(
      refusal("base", "function main(): Uint256 { return Cbeth.CbETH.exchangeRate; }"),
    ).toMatch(
      /^compileSauceRoute: `Cbeth\.CbETH\.exchangeRate`: `exchangeRate` is in cbeth\.CbETH's ABI, but its deployment on base does not run it \(as declared\); it is on: ethereum\.\n/,
    );
  });

  it("code a test rules out is checked against the whole ABI", () => {
    const guarded =
      "function main(): Uint256 { if (Cbeth.CbETH) { return Cbeth.CbETH.exchangeRate(); } return 0; }";
    expect(() => hex("optimism", guarded)).not.toThrow();
    expect(refusal("base", guarded)).toMatch(
      /`exchangeRate` is in cbeth\.CbETH's ABI, but its deployment on base/,
    );
  });

  it("bound to another address with .at, the ABI is the named chain's deployment's", () => {
    const bound = "function main(x: Address): Uint256 { return Cbeth.CbETH.at(x).exchangeRate(); }";
    expect(() => hex("ethereum", bound)).not.toThrow();
    expect(refusal("base", bound)).toBe(
      "rewriteProtocolAccessors: `Cbeth.CbETH.at(…).exchangeRate(…)`: `exchangeRate` is in cbeth.CbETH's ABI, but its deployment on base does not run it (as declared); it is on: ethereum.",
    );
    expect(() =>
      hex(
        "base",
        "function main(x: Address): Uint256 { return Ethereum.Cbeth.CbETH.at(x).exchangeRate(); }",
      ),
    ).not.toThrow();
    // Each chain's view is a binding of its own, so two chains in one program never share one.
    const { source, contracts } = rewriteProtocolAccessors(
      "function main(x: Address): Uint256 { return Cbeth.CbETH.at(x).balanceOf(x) + Ethereum.Cbeth.CbETH.at(x).exchangeRate(); }",
      BASE,
    );
    expect(source).toBe(
      "function main(x: Address): Uint256 { return ICbeth_CbETH_OnBase.view(x).balanceOf(x) + ICbeth_CbETH_OnEthereum.view(x).exchangeRate(); }",
    );
    expect(contracts["ICbeth_CbETH_OnBase"]!.abi).toBe(descriptorOn(CBETH, BASE.id).abi);
    expect(contracts["ICbeth_CbETH_OnEthereum"]!.abi).toBe(descriptorOn(CBETH, ETHEREUM.id).abi);
    // A contract no chain withholds from keeps its one binding.
    expect(
      Object.keys(
        rewriteProtocolAccessors(
          "function main(x: Address): Uint256 { return UniswapV3.Factory.at(x).owner(); }",
          BASE,
        ).contracts,
      ),
    ).toEqual(["IUniswapV3_Factory"]);
  });

  it("the chain's names module imports the ABI its deployment runs, under a path of its own", () => {
    const [basePath, baseText] = boundAbi("base", "Cbeth", "CbETH");
    expect(basePath).toMatch(/^abi\/cbeth\/CbETHABI-[0-9a-f]{8}\.json$/);
    expect(functionNames(JSON.parse(baseText) as Abi)).not.toContain("exchangeRate");
    expect(JSON.parse(baseText)).toEqual(
      descriptorOn(CBETH, BASE.id).abi.filter((item) => item.type === "function"),
    );
    const [ethereumPath, ethereumText] = boundAbi("ethereum", "Cbeth", "CbETH");
    expect(ethereumPath).not.toBe(basePath);
    expect(functionNames(JSON.parse(ethereumText) as Abi)).toContain("exchangeRate");

    // One chain withholds a function and another runs the whole ABI: that one's is the export's.
    const router = getDescriptor("trader-joe", "LBRouter")!;
    const [lacking] = router.withheldOn[requireChain("bsc").id]!;
    const name = lacking!.slice(0, lacking!.indexOf("("));
    const [bscPath, bscText] = boundAbi("bsc", "TraderJoe", "LBRouter");
    expect(bscPath).toMatch(/^abi\/trader-joe\/LBRouterABI-[0-9a-f]{8}\.json$/);
    expect(functionNames(JSON.parse(bscText) as Abi)).not.toContain(name);
    const whole = router.chains.find(
      (slug) => router.withheldOn[requireChain(slug).id] === undefined,
    )!;
    const [wholePath, wholeText] = boundAbi(whole, "TraderJoe", "LBRouter");
    expect(wholePath).toBe("abi/trader-joe/LBRouterABI.json");
    expect(JSON.parse(wholeText)).toEqual(router.abi.filter((item) => item.type === "function"));
  });

  it("hands the compiler a contract's functions only: the descriptor keeps its events and errors", () => {
    // Aave V3's Pool declares events and custom errors, and so does its JSON twin; the ABI the
    // names module serves for it is its functions alone.
    const pool = getDescriptor("aave-v3", "Pool")!;
    const kinds = new Set(pool.abi.map((item) => item.type));
    expect(kinds.has("event")).toBe(true);
    expect(kinds.has("error")).toBe(true);
    const [, poolText] = boundAbi("ethereum", "AaveV3", "Pool");
    expect(JSON.parse(poolText)).toEqual(
      descriptorOn(pool, ETHEREUM.id).abi.filter((item) => item.type === "function"),
    );
    for (const chain of ["ethereum", "base"]) {
      const { text } = chainNames(requireChain(chain));
      const paths = [...text.matchAll(/^import ABI_\d+ from "\.\/(.*)";$/gm)].map((m) => m[1]!);
      expect(paths.length).toBeGreaterThan(50);
      for (const path of paths) {
        const served = JSON.parse(chainModuleText(`${CHAIN_MODULE_ROOT}/${path}`)!) as Abi;
        expect(served.filter((item) => item.type !== "function")).toEqual([]);
      }
    }
    // A program calling a function compiles as ever.
    expect(() =>
      hex("ethereum", "function main(x: Address): Uint256 { return Cbeth.CbETH.balanceOf(x); }"),
    ).not.toThrow();
  });

  it("the chain's listing shows the methods its deployment runs", () => {
    const methodsOn = (chain: string): string[] =>
      sourceGlobals(chain)
        .protocols.find((ns) => ns.namespace === "Cbeth")!
        .contracts.find((c) => c.name === "CbETH")!
        .methods.map((m) => m.name);
    expect(methodsOn("ethereum")).toContain("exchangeRate");
    expect(methodsOn("base")).not.toContain("exchangeRate");
  });

  it("AaveV3.Pool.supply's four-argument overload is the same call on Ethereum and Base", () => {
    const supply =
      "function main(asset: Address, amount: Uint256, who: Address) { AaveV3.Pool.supply(asset, amount, who, 0); }";
    expect(hex("ethereum", supply)).toContain("617ba037");
    expect(hex("base", supply)).toContain("617ba037");
    const pool = getDescriptor("aave-v3", "Pool")!;
    const overloads = (chain: number): string[] =>
      descriptorOn(pool, chain)
        .methods.filter((m) => m.name === "supply")
        .map((m) => m.signature)
        .sort();
    expect(overloads(BASE.id)).toEqual([
      "supply(address,uint256,address,uint16)",
      "supply(bytes32)",
    ]);
    expect(overloads(ETHEREUM.id)).toEqual(["supply(address,uint256,address,uint16)"]);
  });

  it("AaveV3.Pool.getReserveData compiles for Ethereum", () => {
    expect(() =>
      hex(
        "ethereum",
        "function main(asset: Address): Uint256 { return AaveV3.Pool.getReserveData(asset).liquidityIndex; }",
      ),
    ).not.toThrow();
  });
});

describe("a refusal names a large contract's nearest methods, and a small one's all", () => {
  it("past six names: how many, and the five nearest", () => {
    expect(
      refusal("ethereum", "function main(): Uint256 { return Cbeth.CbETH.exchangeRat(); }"),
    ).toMatch(
      /^compileSauceRoute: `Cbeth\.CbETH\.exchangeRat\(…\)`: `exchangeRat` is not in cbeth\.CbETH's vendored ABI \(54 known methods; nearest: exchangeRate, updateExchangeRate, balanceOf, allowance, blacklist\)\. Did you mean `exchangeRate`\?\n/,
    );
  });

  it("six names or fewer: every one", () => {
    expect(
      refusal(
        "ethereum",
        "function main(a: Address, b: Address): Uint256 { return Curve.RouterNG.get_dyy(a, b); }",
      ),
    ).toMatch(
      /^compileSauceRoute: `Curve\.RouterNG\.get_dyy\(…\)`: `get_dyy` is not in curve\.RouterNG's vendored ABI \(known methods: exchange, get_dx, get_dy, version\)\. Did you mean `get_dy`\?\n/,
    );
  });

  it("orders the nearest by distance, then by name, over distinct names", () => {
    expect(methodListing(["b", "a", "a"], "z")).toBe("(known methods: b, a)");
    expect(methodListing(["b", "a"], "z", "its methods")).toBe("(its methods: b, a)");
    expect(methodListing(["dd", "cc", "bb", "aa", "ab", "ac", "ad"], "ab")).toBe(
      "(7 known methods; nearest: ab, aa, ac, ad, bb)",
    );
  });
});

describe("a host accessor is held to its chain's deployment", () => {
  it("Ethereum's CbETH has exchangeRate; Base's refuses it, naming the chains that run it", () => {
    const ethereum = chainContracts("ethereum").Cbeth.CbETH as unknown as ContractAccessor;
    expect(invoke(ethereum, "exchangeRate").data).toBe("0x3ba0b9a9");
    const base = chainContracts("base").Cbeth.CbETH as unknown as ContractAccessor;
    expect(base.methods.map((m) => m.name)).not.toContain("exchangeRate");
    expect(() => invoke(base, "exchangeRate")).toThrow(
      "`Base.Cbeth.CbETH.exchangeRate(…)`: `exchangeRate` is in cbeth.CbETH's ABI, but its deployment on base does not run it (as declared); it is on: ethereum.",
    );
  });

  it("an overload the chain withholds is refused by its signature", () => {
    const pool = chainContracts("ethereum").AaveV3.Pool as unknown as ContractAccessor;
    expect(() => invoke(pool, "supply", `0x${"11".repeat(32)}`)).toThrow(
      /^`Ethereum\.AaveV3\.Pool\.supply\(…\)`: `supply\(bytes32\)` is in aave-v3\.Pool's ABI, but its deployment on ethereum does not run it \(as declared\); it is on: /,
    );
    expect(
      invoke(pool, "supply", `0x${"11".repeat(20)}`, 1n, `0x${"22".repeat(20)}`, 0).data.slice(
        0,
        10,
      ),
    ).toBe("0x617ba037");
  });
});
