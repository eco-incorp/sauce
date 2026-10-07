/**
 * `@sauce/router` compile conformance: the library at sdk/src/std/router built through the published
 * compiler, off disk and from the SDK's embedded copy.
 *
 *   1. every exported function compiles, from run-time arguments, to the same bytes either way;
 *   2. the exports are exactly the documented API, no more and no fewer;
 *   3. each ABI fragment the library calls is pinned: the pool fragments to the selectors their
 *      deployed contracts dispatch, the Router's to the released ABI, and those the registry also
 *      declares (Curve, the Balancer V2 Vault, the Uniswap V2 pair, the LB pair) to its fragments;
 *   4. the packaging invariant: there is no neutral `router.js` and no SVM arm, so importing the
 *      package for the SVM fails on the import.
 *
 * What the functions DO on chain is `actions/tests/swap*.mainnet.test.ts`'s (real pools, captured
 * state) and `test/evm/{swap,router}.e2e.test.ts`'s (the Router's V3 and V4 paths, on mocks).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toFunctionSelector, type AbiFunction } from "viem";

import { compileWithRs } from "../../../src/routes/rs-compile.js";
import { compileStdRouter, FUNCTIONS, programCalling, routerAbi, routerSource } from "./harness.js";

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
/** jest's cwd is `sdk/`. */
const SRC = resolve(process.cwd(), "src");

const fragments = (file: string): AbiFunction[] => routerAbi(file).abi as AbiFunction[];
const plain = (fn: AbiFunction) => ({
  name: fn.name,
  inputs: fn.inputs.map(strip),
  outputs: fn.outputs.map(strip),
  stateMutability: fn.stateMutability,
});
// `internalType` is the Solidity source's annotation, not part of the ABI a call is encoded by.
function strip(param: unknown): unknown {
  const {
    internalType: _,
    components,
    ...rest
  } = param as Record<string, unknown> & {
    components?: unknown[];
  };
  return components === undefined ? rest : { ...rest, components: components.map(strip) };
}

describe("@sauce/router: every function compiles from run-time arguments", () => {
  it.each(Object.keys(FUNCTIONS))("%s, off disk and embedded, to the same bytes", (name) => {
    const source = programCalling(name);
    const fromDisk = compileStdRouter(source);
    const embedded = compileWithRs({ source, target: "v12" });
    expect(fromDisk.bytecode.length).toBeGreaterThan(0);
    expect(hex(embedded.bytecode[0]!)).toBe(hex(fromDisk.bytecode));
  });

  it("several venues in one program, chained through what each returns", () => {
    const source = [
      'import { uniswapV2, curve, uniswapV3 } from "@sauce/router";',
      "function main(amount: Uint256): Uint256 {",
      "  const a = 0x1111111111111111111111111111111111111111n;",
      "  const b = 0x2222222222222222222222222222222222222222n;",
      "  const c = 0x4444444444444444444444444444444444444444n;",
      "  const one = uniswapV2(0x3333333333333333333333333333333333333333n, a, b, amount, 0n, 0n, ctx.self());",
      "  const two = curve(0x5555555555555555555555555555555555555555n, b, c, one, 0n, 1n, false, 0n, ctx.self());",
      "  return uniswapV3(0x6666666666666666666666666666666666666666n, c, a, two, 0n, amount, ctx.self());",
      "}",
    ].join("\n");
    expect(hex(compileWithRs({ source, target: "v12" }).bytecode[0]!)).toBe(
      hex(compileStdRouter(source).bytecode),
    );
  });
});

describe("@sauce/router: the exports are the documented API", () => {
  it("exports exactly the eleven venues and their eleven `try` forms", () => {
    const exported = [...routerSource().matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]);
    expect(exported.sort()).toEqual(Object.keys(FUNCTIONS).sort());
    expect(Object.keys(FUNCTIONS).sort()).toEqual(
      [
        "balancerV2",
        "curve",
        "dodoV2",
        "infinityBin",
        "infinityCL",
        "maverickV2",
        "traderJoeLB",
        "tryBalancerV2",
        "tryCurve",
        "tryDodoV2",
        "tryInfinityBin",
        "tryInfinityCL",
        "tryMaverickV2",
        "tryTraderJoeLB",
        "tryUniswapV2",
        "tryUniswapV3",
        "tryUniswapV4",
        "tryWoofi",
        "uniswapV2",
        "uniswapV3",
        "uniswapV4",
        "woofi",
      ].sort(),
    );
  });

  it("declares no module-level const, which a program-wide define could replace", () => {
    expect(routerSource()).not.toMatch(/^(export )?(const|let) /m);
  });
});

describe("@sauce/router: every fragment it calls is pinned", () => {
  // The selectors the deployed pools dispatch, from the verified contracts each file's `$comment`
  // names. An edit to a fragment's name or argument types changes its selector, and the pool would
  // not answer it.
  it("pins each pool fragment to its deployed selector", () => {
    const selectors = Object.fromEntries(
      [
        "uniswap-v2-pair",
        "curve-stableswap",
        "curve-cryptoswap",
        "balancer-v2-vault",
        "dodo-v2-pool",
        "lb-pair",
        "woo-pp-v2",
      ].map((name) => [name, fragments(`${name}.abi.json`).map((f) => toFunctionSelector(f))]),
    );
    expect(selectors).toEqual({
      "uniswap-v2-pair": ["0x0902f1ac", "0x022c0d9f"], // getReserves(), swap(uint256,uint256,address,bytes)
      "curve-stableswap": ["0x3df02124"], // exchange(int128,int128,uint256,uint256)
      "curve-cryptoswap": ["0x5b41b908"], // exchange(uint256,uint256,uint256,uint256)
      "balancer-v2-vault": ["0x52bbbe29"], // swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)
      // sellBase(address), sellQuote(address), querySellBase(address,uint256), querySellQuote(address,uint256)
      "dodo-v2-pool": ["0xbd6015b4", "0xdd93f59a", "0x79a04876", "0x66410a21"],
      "lb-pair": ["0x53c059a0", "0xe77366f8"], // swap(bool,address), getSwapOut(uint128,bool)
      // swap(address,address,uint256,uint256,address,address), tryQuery(address,address,uint256)
      "woo-pp-v2": ["0x7dc20382", "0xce824f19"],
    });
  });

  // A declared output is decoded even when discarded, and decoding empty returndata reverts. Both
  // Curve `exchange`s are bound output-free because a 3pool-era pool (and tricrypto2) returns none.
  it("declares no output on either Curve exchange", () => {
    for (const file of ["curve-stableswap.abi.json", "curve-cryptoswap.abi.json"]) {
      expect(fragments(file).map((f) => f.outputs)).toEqual([[]]);
    }
  });

  it("holds the Router's fragments equal to the released ISauceRouter ABI's", () => {
    const released = (
      JSON.parse(readFileSync(join(SRC, "artifacts", "ISauceRouter.json"), "utf8")) as {
        abi: AbiFunction[];
      }
    ).abi.filter((item) => item.type === "function");
    const ours = fragments("sauce-router.abi.json");
    expect(ours.map((f) => f.name)).toEqual([
      "swapV3",
      "swapV4",
      "swapMaverickV2",
      "swapInfinityBin",
      "swapInfinityCL",
    ]);
    for (const fn of ours) {
      const theirs = released.find((item) => item.name === fn.name);
      expect(theirs).toBeDefined();
      expect(plain(fn)).toEqual(plain(theirs!));
    }
  });

  it("holds every fragment the registry also declares equal to the twin the registry pins", () => {
    const twin = (slug: string, file: string, name: string): AbiFunction[] =>
      (
        JSON.parse(readFileSync(join(SRC, "protocols", slug, file), "utf8")) as {
          abi: AbiFunction[];
        }
      ).abi.filter((item) => item.type === "function" && item.name === name);
    expect(fragments("curve-stableswap.abi.json").map(plain)).toEqual(
      twin("curve", "CurveThreePoolABI.json", "exchange").map(plain),
    );
    expect(fragments("balancer-v2-vault.abi.json").map(plain)).toEqual(
      twin("balancer-v2", "BalancerV2VaultABI.json", "swap").map(plain),
    );
    expect(fragments("uniswap-v2-pair.abi.json").map(plain)).toEqual(
      ["getReserves", "swap"]
        .flatMap((name) => twin("uniswap-v2", "UniswapV2PairABI.json", name))
        .map(plain),
    );
    expect(fragments("lb-pair.abi.json").map(plain)).toEqual(
      ["swap", "getSwapOut"]
        .flatMap((name) => twin("trader-joe", "LBPairABI.json", name))
        .map(plain),
    );
  });
});

describe("@sauce/router: packaging", () => {
  it("has no SVM arm: importing it for the SVM fails on the import, not on an export", () => {
    const source =
      'import { woofi } from "@sauce/router";\nfunction main(): Uint256 { return 1n; }';
    const refused = /failed to import module "@sauce\/router"/;
    expect(() => compileStdRouter(source, "svm")).toThrow(refused);
    expect(() => compileWithRs({ source, target: "svm" })).toThrow(refused);
    expect(() => compileStdRouter(source, "evm")).not.toThrow();
  });
});
