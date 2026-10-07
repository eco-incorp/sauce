/**
 * `@sauce/router` compile conformance: the library at sdk/src/std/router built through the published
 * compiler, off disk and from the SDK's embedded copy, for both of its arms.
 *
 * The EVM arm:
 *   1. every exported function compiles, from run-time arguments, to the same bytes either way;
 *   2. the exports are exactly the documented API, no more and no fewer;
 *   3. each ABI fragment the library calls is pinned: the pool fragments to the selectors their
 *      deployed contracts dispatch, the Router's to the released ABI, and those the registry also
 *      declares (Curve, the Balancer V2 Vault, the Uniswap V2 pair, the LB pair) to its fragments.
 * The SVM arm:
 *   4. every exported function compiles, from run-time arguments, to the same bytes either way, and
 *      takes the accounts its callers attach in the documented order;
 *   5. the exports are exactly the documented API;
 *   6. each venue's program id, derived from the SDK's base58 id, and each instruction's
 *      discriminator, derived from its name, counted in the bytecode: a function carries its own
 *      venue's and no other, `trySwap` every one;
 *   7. the reasons the checks revert with, counted the same way.
 * Both:
 *   8. the packaging invariant: there is no neutral `router.js`, so a function only one arm has fails
 *      at its import on the other, naming it.
 *
 * What the EVM functions DO on chain is `actions/tests/swap*.mainnet.test.ts`'s (real pools, captured
 * state) and `test/evm/{swap,router}.e2e.test.ts`'s (the Router's V3 and V4 paths, on mocks); what
 * the SVM functions do is `svm.e2e.test.ts`'s, on the venues' own programs and pools in LiteSVM.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { address, getAddressCodec } from "@solana/kit";
import { toFunctionSelector, type AbiFunction } from "viem";

import { compileWithRs } from "../../../src/routes/rs-compile.js";
import {
  BYREAL_PROGRAM_ID,
  CREMA_PROGRAM_ID,
  CROPPER_PROGRAM_ID,
  DEFITUNA_PROGRAM_ID,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PANCAKESWAP_CLMM_PROGRAM_ID,
  PHOENIX_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  STABBLE_CLMM_PROGRAM_ID,
} from "../../../src/svm/index.js";
import {
  compileStdRouter,
  FUNCTIONS,
  programCalling,
  routerAbi,
  routerSource,
  SVM_FUNCTIONS,
  SVM_SLOT,
  SVM_TRADER,
  svmProgramCalling,
} from "./harness.js";

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
      // swap(address,address,uint256,uint256,address,address), query(address,address,uint256)
      "woo-pp-v2": ["0x7dc20382", "0xf58a435f"],
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

  // The try forms catch the Router's call with a value, which the compiler carries only as a scalar:
  // the same methods, declaring `amountInUsed` alone. Its selector and its first word are the
  // release's, so the Router answers it and the value decoded is what it paid.
  it("holds the one-output Router fragments to the release's, less their second output", () => {
    const released = (
      JSON.parse(readFileSync(join(SRC, "artifacts", "ISauceRouter.json"), "utf8")) as {
        abi: AbiFunction[];
      }
    ).abi.filter((item) => item.type === "function");
    const paid = fragments("sauce-router-paid.abi.json");
    expect(paid.map((f) => f.name)).toEqual(fragments("sauce-router.abi.json").map((f) => f.name));
    for (const fn of paid) {
      const theirs = released.find((item) => item.name === fn.name)!;
      expect(plain(fn)).toEqual(plain({ ...theirs, outputs: theirs.outputs.slice(0, 1) }));
      expect(fn.outputs.map((o) => o.name)).toEqual(["amountInUsed"]);
      expect(toFunctionSelector(fn)).toBe(toFunctionSelector(theirs));
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

describe("@sauce/router (SVM): every function compiles from run-time arguments", () => {
  it.each(SVM_FUNCTIONS)("%s, off disk and embedded, to the same bytes", (name) => {
    const source = svmProgramCalling(name);
    const fromDisk = compileStdRouter(source, "svm");
    const embedded = compileWithRs({ source, target: "svm" });
    expect(fromDisk.bytecode.length).toBeGreaterThan(0);
    expect(hex(embedded.bytecode[0]!)).toBe(hex(fromDisk.bytecode));
  });

  // The manifest is `main`'s own `Account` params, so what this pins is the attach order the
  // execution suite resolves by name: the slot's nine, the trader's seven, then the recipient.
  it.each(SVM_FUNCTIONS)("%s takes the slot, the trader's accounts and the recipient", (name) => {
    const { manifest } = compileStdRouter(svmProgramCalling(name), "svm");
    expect(manifest?.accounts.map((entry) => (entry.kind === "slot" ? entry.name : "…"))).toEqual([
      ...SVM_SLOT,
      ...SVM_TRADER,
      "recipient",
    ]);
  });
});

describe("@sauce/router (SVM): the exports are the documented API", () => {
  it("exports the nine venues and trySwap/swap, each with its `try` form", () => {
    const exported = [...routerSource("svm").matchAll(/^export function (\w+)\(/gm)].map(
      (m) => m[1],
    );
    expect(exported.sort()).toEqual([...SVM_FUNCTIONS].sort());
  });

  it("takes every function's arguments in one order", () => {
    for (const [, params] of routerSource("svm").matchAll(/^export function \w+\(([^)]*)\)/gm))
      expect(
        params!
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
      ).toEqual([
        "slot: Account[]",
        "trader: Account[]",
        "amountIn: Uint256",
        "maxPrice: Uint256",
        "minOut: Uint256",
        "recipient: Account",
      ]);
  });

  it("declares no module-level const, which a program-wide define could replace", () => {
    expect(routerSource("svm")).not.toMatch(/^(export )?(const|let) /m);
  });
});

describe("@sauce/router (SVM): the venues' program ids and instructions", () => {
  // Derived from the SDK's base58 ids rather than copied from the library: a copy would agree with
  // the library however wrong its constant was.
  const key = (base58: string): string =>
    Buffer.from(getAddressCodec().encode(address(base58))).toString("hex");
  // An Anchor instruction's discriminator: the first 8 bytes of sha256("global:<name>").
  const discriminator = (name: string): string =>
    createHash("sha256").update(`global:${name}`).digest("hex").slice(0, 16);
  const VENUES: [string, string, string | undefined][] = [
    ["RaydiumClmm", RAYDIUM_CLMM_PROGRAM_ID, "swap_v2"],
    ["PancakeswapClmm", PANCAKESWAP_CLMM_PROGRAM_ID, "swap_v2"],
    ["Byreal", BYREAL_PROGRAM_ID, "swap_v2"],
    ["StabbleClmm", STABBLE_CLMM_PROGRAM_ID, "swap_v2"],
    ["OrcaWhirlpool", ORCA_WHIRLPOOL_PROGRAM_ID, "swap_v2"],
    ["Cropper", CROPPER_PROGRAM_ID, "swap"],
    ["Defituna", DEFITUNA_PROGRAM_ID, "swap"],
    ["Crema", CREMA_PROGRAM_ID, "swap"],
    // Phoenix's instructions are a one-byte tag, not an Anchor discriminator.
    ["Phoenix", PHOENIX_PROGRAM_ID, undefined],
  ];
  const bytecode = (name: string): string =>
    hex(compileStdRouter(svmProgramCalling(name), "svm").bytecode);
  const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

  it.each(VENUES)(
    "try%s carries its venue's program id and instruction, and no other's",
    (venue, id, ix) => {
      const code = bytecode(`try${venue}`);
      for (const [, other] of VENUES) expect(count(code, key(other))).toBe(other === id ? 1 : 0);
      for (const name of ["swap_v2", "swap"])
        expect(count(code, discriminator(name))).toBe(name === ix ? 1 : 0);
    },
  );

  it("trySwap carries every venue's program id once, and each instruction once per venue code", () => {
    const code = bytecode("trySwap");
    for (const [, id] of VENUES) expect(count(code, key(id))).toBe(1);
    // swap_v2: Raydium's code (four programs) and Orca's; swap: Cropper, DefiTuna, Crema.
    expect(count(code, discriminator("swap_v2"))).toBe(2);
    expect(count(code, discriminator("swap"))).toBe(3);
  });
});

describe("@sauce/router (SVM): the reasons its checks revert with", () => {
  const reasons = (name: string): Record<string, number> => {
    const code = hex(compileStdRouter(svmProgramCalling(name), "svm").bytecode);
    return Object.fromEntries(
      [
        "a pool's program is not its owner",
        "not a supported venue's pool",
        "pool is not the pair",
        "market is not the pair",
        "below minOut",
        "nothing swapped",
      ].map((reason) => [reason, code.split(Buffer.from(reason).toString("hex")).length - 1]),
    );
  };

  it("trySwap refuses a slot whose program is not its pool's owner, a pool of no venue here, a pool or market not the pair, and a swap below its floor", () => {
    expect(reasons("trySwap")).toEqual({
      "a pool's program is not its owner": 1,
      "not a supported venue's pool": 1,
      "pool is not the pair": 1,
      "market is not the pair": 1,
      "below minOut": 1,
      "nothing swapped": 0,
    });
    expect(reasons("swap")["nothing swapped"]).toBe(1);
  });

  it.each([
    ["RaydiumClmm", "not a Raydium CLMM pool"],
    ["PancakeswapClmm", "not a PancakeSwap CLMM pool"],
    ["Byreal", "not a Byreal pool"],
    ["StabbleClmm", "not a Stabble CLMM pool"],
    ["OrcaWhirlpool", "not an Orca whirlpool"],
    ["Cropper", "not a Cropper pool"],
    ["Defituna", "not a DefiTuna pool"],
    ["Crema", "not a Crema pool"],
    ["Phoenix", "not a Phoenix market"],
  ])("try%s refuses another venue's pool as %j", (venue, reason) => {
    const code = hex(compileStdRouter(svmProgramCalling(`try${venue}`), "svm").bytecode);
    expect(code.split(Buffer.from(reason).toString("hex")).length - 1).toBe(1);
    const pair = venue === "Phoenix" ? "market is not the pair" : "pool is not the pair";
    expect(code.split(Buffer.from(pair).toString("hex")).length - 1).toBe(1);
  });
});

describe("@sauce/router: packaging", () => {
  it("has no neutral router.js: a function one arm lacks fails at its import, naming it", () => {
    expect(existsSync(join(SRC, "std", "router", "router.js"))).toBe(false);
    const evmOnly =
      'import { woofi } from "@sauce/router";\nfunction main(): Uint256 { return 1n; }';
    const svmOnly =
      'import { trySwap } from "@sauce/router";\nfunction main(): Uint256 { return 1n; }';
    expect(() => compileStdRouter(evmOnly, "svm")).toThrow("`woofi` is not exported by module");
    expect(() => compileWithRs({ source: evmOnly, target: "svm" })).toThrow(
      "`woofi` is not exported by module",
    );
    expect(() => compileStdRouter(svmOnly, "evm")).toThrow("`trySwap` is not exported by module");
    expect(() => compileWithRs({ source: svmOnly, target: "v12" })).toThrow(
      "`trySwap` is not exported by module",
    );
    expect(() => compileStdRouter(evmOnly, "evm")).not.toThrow();
    expect(() => compileStdRouter(svmOnly, "svm")).not.toThrow();
  });
});
