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
 *   5. the exports are exactly the documented API, the limit functions taking one argument order and
 *      the exact-input functions another;
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
 * the SVM functions do is `svm.e2e.test.ts`'s and `svm-exact-in.e2e.test.ts`'s, on the venues' own
 * programs and pools in LiteSVM.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { address, getAddressCodec } from "@solana/kit";
import { toFunctionSelector, type AbiFunction } from "viem";

import { compileWithRs } from "../../../src/routes/rs-compile.js";
import {
  aldrin,
  bonkswap,
  BYREAL_PROGRAM_ID,
  CREMA_PROGRAM_ID,
  CROPPER_PROGRAM_ID,
  DEFITUNA_PROGRAM_ID,
  INVARIANT_PROGRAM_ID,
  MANIFEST_PROGRAM_ID,
  OPENBOOK_V2_PROGRAM_ID,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PANCAKESWAP_CLMM_PROGRAM_ID,
  PHOENIX_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  STABBLE_CLMM_PROGRAM_ID,
  dexlab,
  fluxbeam,
  gamma,
  guacswap,
  mercurial,
  METADAO_FUTARCHY_PROGRAM_ID,
  METEORA_DLMM_PROGRAM_ID,
  meteoraDammV1Stable,
  meteoraDammV2,
  omnipair,
  orcaLegacyTokenSwap,
  orcaV1,
  penguin,
  perena,
  pumpswapAdapter,
  raydiumAmmV4,
  raydiumCpSwap,
  saberDecimalsWrapper,
  saberStableswap,
  saros,
  SAROS_DLMM_PROGRAM_ID,
  SCALE_AMM_PROGRAM_ID,
  stabbleStableSwap,
  stabbleWeightedSwap,
  stepn,
  tokenSwapV1,
  DENALI_PROGRAM_ID,
  DERIVERSE_PROGRAM_ID,
  FLINT_PROGRAM_ID,
  GAVEL_PROGRAM_ID,
  GOONFI_V2_PROGRAM_ID,
  HADRON_PROGRAM_ID,
  RIPTIDE_PROGRAM_ID,
  SOLFI_V2_PROGRAM_ID,
  TAURUSFI_PROGRAM_ID,
  TESSERAV_PROGRAM_ID,
} from "../../../src/svm/index.js";
import {
  compileStdRouter,
  FUNCTIONS,
  programCalling,
  routerAbi,
  routerSource,
  SVM_CPI_FUNCTIONS,
  SVM_DATA_FUNCTIONS,
  SVM_CPI_ONLY,
  SVM_EXACT_IN,
  SVM_EXACT_IN_FUNCTIONS,
  SVM_FUNCTIONS,
  SVM_SLOT,
  SVM_TRADER,
  svmArguments,
  svmCpiArguments,
  svmDataArguments,
  svmInstructionForm,
  svmExactInArguments,
  svmExactInProgramCalling,
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

/** The accounts a Solana function's test program attaches: an instruction-only `…Cpi`'s or
 *  `…Data`'s list. */
const cpiAccounts = (name: string): number => (svmInstructionForm(name) ? 16 : 0);

describe("@sauce/router (SVM): every function compiles from run-time arguments", () => {
  it.each(SVM_FUNCTIONS)("%s, off disk and embedded, to the same bytes", (name) => {
    const source = svmProgramCalling(name, cpiAccounts(name));
    const fromDisk = compileStdRouter(source, "svm");
    const embedded = compileWithRs({ source, target: "svm" });
    expect(fromDisk.bytecode.length).toBeGreaterThan(0);
    expect(hex(embedded.bytecode[0]!)).toBe(hex(fromDisk.bytecode));
  });

  // The manifest is `main`'s own `Account` params, so what this pins is the attach order the
  // execution suites resolve by name: a slot function's nine, the trader's seven, then the
  // recipient; an instruction-only `…Cpi`'s or `…Data`'s program, paying account and instruction
  // accounts.
  it.each(SVM_FUNCTIONS)("%s takes its accounts in their documented order", (name) => {
    const { manifest } = compileStdRouter(svmProgramCalling(name, cpiAccounts(name)), "svm");
    expect(manifest?.accounts.map((entry) => (entry.kind === "slot" ? entry.name : "…"))).toEqual(
      svmInstructionForm(name)
        ? ["program", "source", ...Array.from({ length: 16 }, (_, i) => `a${i}`)]
        : [...SVM_SLOT, ...SVM_TRADER, "recipient"],
    );
  });
});

describe("@sauce/router (SVM): every exact-input function compiles from run-time arguments", () => {
  it.each(SVM_EXACT_IN_FUNCTIONS)("%s, off disk and embedded, to the same bytes", (name, slot) => {
    const source = svmExactInProgramCalling(name, slot);
    const fromDisk = compileStdRouter(source, "svm");
    const embedded = compileWithRs({ source, target: "svm" });
    expect(fromDisk.bytecode.length).toBeGreaterThan(0);
    expect(hex(embedded.bytecode[0]!)).toBe(hex(fromDisk.bytecode));
  });

  it.each(SVM_EXACT_IN_FUNCTIONS)(
    "%s takes its slot, the trader's accounts and the recipient",
    (name, slot) => {
      const { manifest } = compileStdRouter(svmExactInProgramCalling(name, slot), "svm");
      expect(manifest?.accounts.map((entry) => (entry.kind === "slot" ? entry.name : "…"))).toEqual(
        [...Array.from({ length: slot }, (_, i) => `s${i}`), ...SVM_TRADER, "recipient"],
      );
    },
  );

  // A `Cpi` or `Data` form takes the list whole, so one compiled program serves a list of any length.
  it.each([...SVM_CPI_FUNCTIONS, ...SVM_DATA_FUNCTIONS])(
    "%s, off disk and embedded, to the same bytes",
    (name) => {
      const source = svmProgramCalling(name, 3);
      const fromDisk = compileStdRouter(source, "svm");
      const embedded = compileWithRs({ source, target: "svm" });
      expect(fromDisk.bytecode.length).toBeGreaterThan(0);
      expect(hex(embedded.bytecode[0]!)).toBe(hex(fromDisk.bytecode));
    },
  );
});

describe("@sauce/router (SVM): the exports are the documented API", () => {
  it("exports trySwap/swap, the nine venues at a price, the eleven at their own limit, each instruction's data and Manifest's", () => {
    const exported = [...routerSource("svm").matchAll(/^export function (\w+)\(/gm)].map(
      (m) => m[1],
    );
    expect(exported.sort()).toEqual(
      [
        ...SVM_FUNCTIONS,
        ...SVM_EXACT_IN_FUNCTIONS.map(([name]) => name),
        ...SVM_CPI_FUNCTIONS,
        ...SVM_DATA_FUNCTIONS,
      ].sort(),
    );
  });

  it("takes each family's arguments in one order", () => {
    const BOOLS = ["aToB", "xToY", "paysBase"];
    const signature = (name: string): string[] => {
      if (name.endsWith("Data")) {
        return svmDataArguments(name).map(
          (arg) => `${arg}: ${BOOLS.includes(arg) ? "bool" : "Uint256"}`,
        );
      }
      if (name.endsWith("Cpi")) {
        const direction = /^(raydiumClmm|pancakeswapClmm|byreal|stabbleClmm)Cpi$/.test(name)
          ? []
          : /^(orcaWhirlpool|cropper|defituna|crema)Cpi$/.test(name)
            ? ["aToB: bool"]
            : name === "invariantCpi"
              ? ["xToY: bool"]
              : ["paysBase: bool"];
        const carries = svmCpiArguments(name)
          .filter((arg) => !["aToB", "xToY", "paysBase"].includes(arg))
          .map((arg) => `${arg}: Uint256`);
        return [
          "program: Account",
          "accounts: Account[]",
          "source: Account",
          ...carries,
          ...direction,
        ];
      }
      const middle = svmArguments(name).map((arg) =>
        name === "tryPhoenixAtLimit" || name === "phoenixAtLimit"
          ? `${arg === "limit" ? "ticks" : arg}: Uint256`
          : `${arg}: Uint256`,
      );
      return ["slot: Account[]", "trader: Account[]", ...middle, "recipient: Account"];
    };
    const limit = new Set<string>(SVM_FUNCTIONS);
    for (const [, name, params] of routerSource("svm").matchAll(
      /^export function (\w+)\(([^)]*)\)/gm,
    ))
      if (limit.has(name!))
        expect({
          name,
          params: params!
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
        }).toEqual({ name, params: signature(name!) });
  });

  const signatures = (): [string, string[]][] =>
    [...routerSource("svm").matchAll(/^export function (\w+)\(([^)]*)\)/gm)].map((m) => [
      m[1]!,
      m[2]!
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
    ]);

  it("takes the exact-input functions' arguments in one order, and each instruction form what its instruction carries, its floor and its direction", () => {
    const limit = new Set<string>(SVM_FUNCTIONS);
    const BOOLS = ["aToB", "xToY", "paysBase"];
    const typed = (args: string[]) =>
      args.map((arg) => `${arg}: ${BOOLS.includes(arg) ? "bool" : "Uint256"}`);
    for (const [name, params] of signatures().filter(([name]) => !limit.has(name)))
      expect({ name, params }).toEqual({
        name,
        params: name.endsWith("Data")
          ? typed(svmExactInArguments(name)!)
          : name.endsWith("Cpi")
            ? [
                "program: Account",
                "accounts: Account[]",
                "source: Account",
                ...typed(svmExactInArguments(name)!),
              ]
            : [
                "slot: Account[]",
                "trader: Account[]",
                "amountIn: Uint256",
                "minOut: Uint256",
                "recipient: Account",
              ],
      });
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
  const INSTRUCTIONS = ["swap_v2", "swap", "place_take_order"] as const;
  // Each venue's id and the Anchor instructions its code carries, counted: Orca sends `swap` to a
  // pool of SPL Token mints and `swap_v2` to the rest; Crema's and Invariant's `swap` is written
  // once per direction, whose flag follows it. Phoenix's and Manifest's are a one-byte tag.
  const VENUES: [string, string, Partial<Record<(typeof INSTRUCTIONS)[number], number>>][] = [
    ["RaydiumClmm", RAYDIUM_CLMM_PROGRAM_ID, { swap_v2: 1 }],
    ["PancakeswapClmm", PANCAKESWAP_CLMM_PROGRAM_ID, { swap_v2: 1 }],
    ["Byreal", BYREAL_PROGRAM_ID, { swap_v2: 1 }],
    ["StabbleClmm", STABBLE_CLMM_PROGRAM_ID, { swap_v2: 1 }],
    ["OrcaWhirlpool", ORCA_WHIRLPOOL_PROGRAM_ID, { swap_v2: 1, swap: 1 }],
    ["Cropper", CROPPER_PROGRAM_ID, { swap: 1 }],
    ["Defituna", DEFITUNA_PROGRAM_ID, { swap: 1 }],
    ["Crema", CREMA_PROGRAM_ID, { swap: 2 }],
    ["Phoenix", PHOENIX_PROGRAM_ID, {}],
    ["Invariant", INVARIANT_PROGRAM_ID, { swap: 2 }],
    ["Manifest", MANIFEST_PROGRAM_ID, {}],
    ["OpenbookV2", OPENBOOK_V2_PROGRAM_ID, { place_take_order: 1 }],
  ];
  const lower = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);
  /** Each venue's functions: at a price (the nine), at its own limit, and its instruction alone. */
  const functionsOf = (venue: string): string[] =>
    venue === "Manifest"
      ? ["tryManifest", "manifestCpi"]
      : [
          ...((SVM_FUNCTIONS as readonly string[]).includes(`try${venue}`) ? [`try${venue}`] : []),
          `try${venue}AtLimit`,
          `${lower(venue)}Cpi`,
        ];
  const bytecode = (name: string): string =>
    hex(compileStdRouter(svmProgramCalling(name, cpiAccounts(name)), "svm").bytecode);
  const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

  it.each(
    VENUES.flatMap(([venue, id, ix]) => functionsOf(venue).map((fn) => [fn, id, ix] as const)),
  )("%s carries its venue's program id and instructions, and no other's", (fn, id, ix) => {
    const code = bytecode(fn);
    for (const [, other] of VENUES) expect(count(code, key(other))).toBe(other === id ? 1 : 0);
    for (const name of INSTRUCTIONS) expect(count(code, discriminator(name))).toBe(ix[name] ?? 0);
  });

  // `…Data` is the instruction's data alone: its instructions, and no program id at all.
  const DATA: [string, Partial<Record<(typeof INSTRUCTIONS)[number], number>>][] = [
    ["raydiumClmmData", { swap_v2: 1 }],
    ["pancakeswapClmmData", { swap_v2: 1 }],
    ["byrealData", { swap_v2: 1 }],
    ["stabbleClmmData", { swap_v2: 1 }],
    ["orcaWhirlpoolData", { swap: 1 }],
    ["orcaWhirlpoolV2Data", { swap_v2: 1 }],
    ["cropperData", { swap: 1 }],
    ["defitunaData", { swap: 1 }],
    ["cremaData", { swap: 2 }],
    ["phoenixData", {}],
    ["invariantData", { swap: 2 }],
    ["manifestData", {}],
    ["openbookV2Data", { place_take_order: 1 }],
    ["openbookV2LotsData", { place_take_order: 1 }],
  ];

  it("lists every …Data function", () => {
    expect(DATA.map(([fn]) => fn).sort()).toEqual(
      SVM_FUNCTIONS.filter((fn) => fn.endsWith("Data")).sort(),
    );
  });

  it.each(DATA)("%s carries its instructions and no program id", (fn, ix) => {
    const code = bytecode(fn);
    for (const [, id] of VENUES) expect(count(code, key(id))).toBe(0);
    for (const name of INSTRUCTIONS) expect(count(code, discriminator(name))).toBe(ix[name] ?? 0);
  });

  it("trySwap carries the nine venues' program ids once, and each instruction once per venue code", () => {
    const code = bytecode("trySwap");
    for (const [venue, id] of VENUES)
      expect(count(code, key(id))).toBe(
        ["Invariant", "Manifest", "OpenbookV2"].includes(venue) ? 0 : 1,
      );
    // swap_v2: Raydium's code (four programs) and Orca's; swap: Orca's, Cropper, DefiTuna, Crema's
    // two directions.
    expect(count(code, discriminator("swap_v2"))).toBe(2);
    expect(count(code, discriminator("swap"))).toBe(5);
  });
});

describe("@sauce/router (SVM): the exact-input venues' program ids", () => {
  // The program carries a constant without its leading zero bytes, and Saros DLMM's id has one.
  const key = (base58: string): string =>
    Buffer.from(getAddressCodec().encode(address(base58)))
      .toString("hex")
      .replace(/^(00)+/, "");
  const IDS: Record<string, string> = {
    raydiumCpSwap: raydiumCpSwap.programId,
    gamma: gamma.programId,
    raydiumAmmV4: raydiumAmmV4.programId,
    orcaLegacyTokenSwap: orcaLegacyTokenSwap.programId,
    tokenSwapV1: tokenSwapV1.programId,
    orcaV1: orcaV1.programId,
    penguin: penguin.programId,
    stepn: stepn.programId,
    saros: saros.programId,
    fluxbeam: fluxbeam.programId,
    dexlab: dexlab.programId,
    meteoraDammV2: meteoraDammV2.programId,
    meteoraDammV1: meteoraDammV1Stable.programId,
    aldrin: aldrin.programId,
    omnipair: omnipair.programId,
    saber: saberStableswap.programId,
    saberDecimalsWrapper: saberDecimalsWrapper.programId,
    stabbleStableSwap: stabbleStableSwap.programId,
    stabbleWeightedSwap: stabbleWeightedSwap.programId,
    mercurial: mercurial.programId,
    perena: perena.programId,
    metadaoFutarchy: METADAO_FUTARCHY_PROGRAM_ID,
    scaleAmm: SCALE_AMM_PROGRAM_ID,
    pumpswap: pumpswapAdapter.programId,
    bonkswap: bonkswap.programId,
    guacswap: guacswap.programId,
    meteoraDlmm: METEORA_DLMM_PROGRAM_ID,
    sarosDlmm: SAROS_DLMM_PROGRAM_ID,
    solfiV2: SOLFI_V2_PROGRAM_ID,
    hadron: HADRON_PROGRAM_ID,
    taurusfi: TAURUSFI_PROGRAM_ID,
    riptide: RIPTIDE_PROGRAM_ID,
    denali: DENALI_PROGRAM_ID,
    gavel: GAVEL_PROGRAM_ID,
    tesserav: TESSERAV_PROGRAM_ID,
    flint: FLINT_PROGRAM_ID,
    deriverse: DERIVERSE_PROGRAM_ID,
    goonfiV2: GOONFI_V2_PROGRAM_ID,
  };
  const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
  const carries = (code: string) =>
    Object.entries(IDS).map(([venue, id]) => ({ venue, carried: count(code, key(id)) > 0 }));
  const only = (base: string) =>
    Object.keys(IDS).map((venue) => ({ venue, carried: venue === base }));

  it("names a program for every exact-input venue", () => {
    expect(Object.keys(IDS).sort()).toEqual([...Object.keys(SVM_EXACT_IN), ...SVM_CPI_ONLY].sort());
  });

  it.each(SVM_EXACT_IN_FUNCTIONS)(
    "%s carries its venue's program id and no other's",
    (name, slot) => {
      const code = hex(compileStdRouter(svmExactInProgramCalling(name, slot), "svm").bytecode);
      const base = name.startsWith("try") ? name.charAt(3).toLowerCase() + name.slice(4) : name;
      expect(carries(code)).toEqual(only(base));
    },
  );

  it.each(SVM_DATA_FUNCTIONS)("%s carries no program id: its caller names the program", (name) => {
    const code = hex(compileStdRouter(svmProgramCalling(name, 3), "svm").bytecode);
    expect(carries(code)).toEqual(Object.keys(IDS).map((venue) => ({ venue, carried: false })));
  });

  it.each(SVM_CPI_FUNCTIONS)("%s carries its venue's program id and no other's", (name) => {
    const code = hex(compileStdRouter(svmProgramCalling(name, 3), "svm").bytecode);
    const base = name.replace(/Cpi$/, "");
    expect(carries(code)).toEqual(only(base));
  });
});

describe("@sauce/router (SVM): the reasons its checks revert with", () => {
  const REASONS = [
    "a pool's program is not its owner",
    "not a supported venue's pool",
    "pool is not the pair",
    "market is not the pair",
    "below minOut",
    "nothing swapped",
    "minOut past 64 bits",
    "limit past 64 bits",
    "limit past 128 bits",
    "limit past its field",
    "debit",
  ];
  const reasons = (name: string): Record<string, number> => {
    const code = hex(compileStdRouter(svmProgramCalling(name, cpiAccounts(name)), "svm").bytecode);
    return Object.fromEntries(
      REASONS.map((reason) => [reason, code.split(Buffer.from(reason).toString("hex")).length - 1]),
    );
  };
  const none = Object.fromEntries(REASONS.map((reason) => [reason, 0]));

  it("trySwap refuses a slot whose program is not its pool's owner, a pool of no venue here, a pool or market not the pair, and a swap below its floor", () => {
    // And each venue's data's: a floor and a sqrt price limit their fields cannot carry (Raydium's
    // code, Orca's two swaps, Cropper, DefiTuna, Crema), and Phoenix's limit.
    expect(reasons("trySwap")).toEqual({
      ...none,
      "a pool's program is not its owner": 1,
      "not a supported venue's pool": 1,
      "pool is not the pair": 1,
      "market is not the pair": 1,
      "below minOut": 1,
      "minOut past 64 bits": 6,
      "limit past 128 bits": 6,
      "limit past 64 bits": 1,
    });
    expect(reasons("swap")["nothing swapped"]).toBe(1);
  });

  const VENUE_REASONS: [string, string][] = [
    ["RaydiumClmm", "not a Raydium CLMM pool"],
    ["PancakeswapClmm", "not a PancakeSwap CLMM pool"],
    ["Byreal", "not a Byreal pool"],
    ["StabbleClmm", "not a Stabble CLMM pool"],
    ["OrcaWhirlpool", "not an Orca whirlpool"],
    ["Cropper", "not a Cropper pool"],
    ["Defituna", "not a DefiTuna pool"],
    ["Crema", "not a Crema pool"],
    ["Phoenix", "not a Phoenix market"],
    ["Invariant", "not an Invariant pool"],
    ["OpenbookV2", "not an OpenBook v2 market"],
    ["Manifest", "not a Manifest market"],
  ];
  const book = (venue: string): boolean => ["Phoenix", "Manifest", "OpenbookV2"].includes(venue);

  it.each(
    VENUE_REASONS.filter(([venue]) => !["Invariant", "OpenbookV2", "Manifest"].includes(venue)),
  )("try%s refuses another venue's pool as %j", (venue, reason) => {
    const code = hex(compileStdRouter(svmProgramCalling(`try${venue}`), "svm").bytecode);
    expect(code.split(Buffer.from(reason).toString("hex")).length - 1).toBe(1);
    const pair = book(venue) ? "market is not the pair" : "pool is not the pair";
    expect(code.split(Buffer.from(pair).toString("hex")).length - 1).toBe(1);
  });

  // At a limit: its data refuses a floor or a limit its instruction cannot carry (Orca's data is two
  // swaps', each with its floor); `…Cpi` the same, and the program and the debit; `try…AtLimit` the
  // venue's own pool and pair, as above, the floor afterwards, and, first, a limit its order cannot
  // carry, whatever the market's state.
  it.each(VENUE_REASONS)("%s at a limit refuses another venue's pool as %j", (venue, reason) => {
    const tryForm = venue === "Manifest" ? "tryManifest" : `try${venue}AtLimit`;
    const floors = ["Phoenix", "Invariant", "OpenbookV2"].includes(venue)
      ? 0
      : venue === "OrcaWhirlpool"
        ? 2
        : 1;
    const limit =
      venue === "Phoenix"
        ? "limit past 64 bits"
        : venue === "OpenbookV2"
          ? "limit past its field"
          : undefined;
    // A sqrt price limit's 16 bytes (Invariant's too), on every concentrated-liquidity venue.
    const wide = book(venue) ? 0 : venue === "Invariant" ? 1 : floors;
    const data = {
      ...(floors > 0 ? { "minOut past 64 bits": floors } : {}),
      ...(wide > 0 ? { "limit past 128 bits": wide } : {}),
      ...(limit === undefined ? {} : { [limit]: 1 }),
    };
    const lower = `${venue.charAt(0).toLowerCase()}${venue.slice(1)}`;
    if (venue === "OrcaWhirlpool")
      for (const name of ["orcaWhirlpoolData", "orcaWhirlpoolV2Data"])
        expect(reasons(name)).toEqual({
          ...none,
          "minOut past 64 bits": 1,
          "limit past 128 bits": 1,
        });
    else expect(reasons(`${lower}Data`)).toEqual({ ...none, ...data });
    if (venue === "OpenbookV2") expect(reasons("openbookV2LotsData")).toEqual({ ...none, ...data });
    expect(reasons(tryForm)).toEqual({
      ...none,
      ...data,
      [book(venue) ? "market is not the pair" : "pool is not the pair"]: 1,
      "below minOut": 1,
      ...(limit === undefined ? {} : { [limit]: 2 }),
      // and a sqrt price limit wider than its field, whatever the pool's state, checked first too.
      ...(wide > 0 ? { "limit past 128 bits": wide + 1 } : {}),
    });
    const cpi = `${lower}Cpi`;
    // `…Cpi` writes its data itself (Orca's two swaps' under one floor check), Phoenix's excepted.
    expect(reasons(cpi)).toEqual({
      ...none,
      ...data,
      ...(venue === "OrcaWhirlpool" ? { "minOut past 64 bits": 1, "limit past 128 bits": 1 } : {}),
      debit: 1,
    });
    for (const name of [tryForm, cpi]) {
      const code = hex(
        compileStdRouter(svmProgramCalling(name, cpiAccounts(name)), "svm").bytecode,
      );
      expect(code.split(Buffer.from(reason).toString("hex")).length - 1).toBe(1);
    }
  });
});

describe("@sauce/router (SVM): the reasons the exact-input functions revert with", () => {
  const reasons = (source: string): string[] => {
    const code = hex(compileStdRouter(source, "svm").bytecode);
    return ["minOut past 64 bits", "below minOut", "debit"].filter((reason) =>
      code.includes(Buffer.from(reason).toString("hex")),
    );
  };
  const venue = (source: string): boolean =>
    /6e6f742061(6e)?20/.test(hex(compileStdRouter(source, "svm").bytecode)); // "not a " / "not an "

  // A floor its field cannot carry, where the venue's instruction has one.
  const floor = (name: string): string[] =>
    svmExactInArguments(
      `${name.replace(/^try([A-Z])/, (_, c: string) => c.toLowerCase())}Data`,
    )!.includes("minOut")
      ? ["minOut past 64 bits"]
      : [];

  it.each(SVM_EXACT_IN_FUNCTIONS)(
    "%s refuses another program, a floor past 64 bits and a swap below its floor",
    (name, slot) => {
      const source = svmExactInProgramCalling(name, slot);
      expect(venue(source)).toBe(true);
      expect(reasons(source)).toEqual([...floor(name), "below minOut"]);
    },
  );

  it.each(SVM_CPI_FUNCTIONS)(
    "%s refuses another program, a floor past 64 bits and a debit past its input",
    (name) => {
      const source = svmProgramCalling(name, 3);
      expect(venue(source)).toBe(true);
      expect(reasons(source)).toEqual([...floor(name.replace(/Cpi$/, "")), "debit"]);
    },
  );

  it.each(["perena", "tryPerena", "perenaCpi", "perenaData"])(
    "%s refuses a token index past its byte, which would spill into the next field",
    (name) => {
      const source = /(Cpi|Data)$/.test(name)
        ? svmProgramCalling(name, 3)
        : svmExactInProgramCalling(name, SVM_EXACT_IN.perena!);
      const code = hex(compileStdRouter(source, "svm").bytecode);
      expect(code).toContain(Buffer.from("index past its byte").toString("hex"));
    },
  );

  it.each(["deriverse", "tryDeriverse", "deriverseCpi", "deriverseData"])(
    "%s refuses an instrument id past 32 bits, which cut to them would name another instrument",
    (name) => {
      const source = /(Cpi|Data)$/.test(name)
        ? svmProgramCalling(name, 3)
        : svmExactInProgramCalling(name, SVM_EXACT_IN.deriverse!);
      const code = hex(compileStdRouter(source, "svm").bytecode);
      expect(code).toContain(Buffer.from("instrId past 32 bits").toString("hex"));
    },
  );

  it.each(SVM_DATA_FUNCTIONS)("%s checks nothing but its floor's width", (name) => {
    const source = svmProgramCalling(name, 3);
    expect(venue(source)).toBe(false);
    expect(reasons(source)).toEqual(floor(name.replace(/Data$/, "")));
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
