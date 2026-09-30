/**
 * Which chain a name inside `Chain(() => { ... }).reward({ ... })` resolves on, at every level.
 *
 * The BODY runs on the destination, so its names — and the delivery argument's — are the
 * destination's. The REWARD is escrowed where the program runs, and the program approves the Portal
 * for it there, so its names are the enclosing chain's. A reward token resolved on the destination
 * is an address with no code where the approval runs: SafeERC20's code check reverts the whole
 * fulfilment. A body token resolved on the enclosing chain is not a token where the body runs, so
 * the intent can never be fulfilled.
 *
 * Every compile the route pipeline makes is recorded — the program's, and each nested intent's
 * program — so each level's `publishAndFund` is decoded from that level's own lowered source, with
 * the Portal's ABI, and checked against the chain it runs on. Three paths build the same programs:
 * a plain `compileSauceRoute`, one handed a chain's ambient defines as its `defines`, and the
 * `Base(program, options)` builder. Each case uses the SDK's REAL registry, where `USDC` is a
 * different address on every chain involved; a suite that gives a symbol one address everywhere
 * cannot tell the chains apart, which is how this went unnoticed. What a chain does with these
 * bytes is `routes-intent-chains.e2e.test.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bytesToHex, decodeAbiParameters, decodeFunctionData, erc20Abi, type Hex } from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { v12PredictPot } from "../src/deployments/pot.js";
import { v12Pot } from "../src/evm/engine.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import { ecoRoutesExecutorOf, ecoRoutesPortal } from "../src/protocols/eco-routes/lookup.js";
import { EVM_ROUTE_PARAM } from "../src/routes/encode.js";
import type { IntentOptions } from "../src/routes/intent-dsl.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";

// ESM jest exposes `jest` on `import.meta`, and every module that compiles must be imported AFTER
// the mock is registered, so those imports are dynamic.
const { jest } = import.meta as unknown as {
  jest: { unstable_mockModule(path: string, factory: () => unknown): void };
};
const real = await import("../src/routes/rs-compile.js");

interface Compile {
  readonly source: string;
  readonly defines: Readonly<Record<string, bigint | boolean | number>>;
  readonly bytecode: Hex;
}
/** Every compile since the last `record()`, in the order the pipeline made them: a nested
 *  intent's program is compiled while its parent is being lowered, so it comes first. */
let compiles: Compile[] = [];
jest.unstable_mockModule("../src/routes/rs-compile.js", () => ({
  ...real,
  compileWithRs: (input: Parameters<typeof real.compileWithRs>[0]) => {
    const result = real.compileWithRs(input);
    compiles.push({
      source: input.source,
      defines: input.defines ?? {},
      bytecode: bytesToHex(result.bytecode[0]!),
    });
    return result;
  },
}));
const { compileSauceRoute } = await import("../src/routes/sauce-route.js");
const { openRoute } = await import("../src/routes/intent-dsl.js");
const { chainDefines } = await import("../src/routes/ambient.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const example = (name: string) =>
  readFileSync(join(HERE, "../../docs/examples", `${name}.sauce.ts`), "utf8");
const README_EXAMPLE = example("cross-chain-intent");
const CASCADE_EXAMPLE = example("cross-chain-cascade");

type Slug = "base" | "arbitrum" | "optimism";
const address = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;
const usdcOf = (slug: Slug): Hex => address(registryTokenAddress(requireChain(slug), "USDC")!);
const idOf = (slug: Slug) => BigInt(requireChain(slug).id);
const definesOf = (slug: Slug) => chainDefines(requireChain(slug));

const CREATOR = "0x4444444444444444444444444444444444444444" as const;
const PROVER = "0x5555555555555555555555555555555555555555" as const;
const RECIPIENT = 0x6666666666666666666666666666666666666666n;
const DEADLINE = 2_000_000_000n;
const EXECUTION_FEE = 1_000n;
const EXECUTION = {
  pot: "0x2222222222222222222222222222222222222222",
  engine: "0x3333333333333333333333333333333333333333",
} as const;
const INTENTS = { deadline: DEADLINE, creator: CREATOR, executionFee: EXECUTION_FEE };

/** The docs examples' own `IntentOptions`: an Ethereum -> Base intent whose route runs the program. */
const builderOptions = (defines: IntentOptions["defines"]): IntentOptions => ({
  execution: { value: EXECUTION_FEE },
  nativeAmount: EXECUTION_FEE,
  deadline: DEADLINE,
  creator: CREATOR,
  prover: PROVER,
  source: "ethereum",
  defines,
  compile: { intents: { executionFee: EXECUTION_FEE } },
});

type Defines = Record<string, bigint | boolean | number>;
/** The three ways a program on Base gets compiled. Each takes the caller's own defines. */
const PATHS: readonly (readonly [string, (program: string, defines: Defines) => void])[] = [
  [
    "compileSauceRoute",
    (program, defines) =>
      compileSauceRoute("base", program, EXECUTION, {
        ambient: ["@sauce/token"],
        defines,
        intents: INTENTS,
      }),
  ],
  [
    "compileSauceRoute, handed chainDefines(base) as its defines",
    (program, defines) =>
      compileSauceRoute("base", program, EXECUTION, {
        ambient: ["@sauce/token"],
        defines: { ...definesOf("base"), ...defines },
        intents: INTENTS,
      }),
  ],
  [
    "Base(program, options)",
    (program, defines) =>
      openRoute("base", program, builderOptions(defines)).reward({
        creator: CREATOR,
        prover: PROVER,
        deadline: DEADLINE + 3_600n,
        nativeAmount: 0n,
      }),
  ],
];
const CHAIN_DEFINE_PATHS = PATHS.slice(1);

/** Runs `build` and returns every compile it made. */
function record(build: () => void): Compile[] {
  compiles = [];
  build();
  return compiles;
}

// ---------------------------------------------------------------------------------------------
// Reading an intent back out of a lowered program
// ---------------------------------------------------------------------------------------------

interface DecodedRoute {
  readonly portal: Hex;
  readonly nativeAmount: bigint;
  readonly tokens: readonly { readonly token: Hex; readonly amount: bigint }[];
  readonly calls: readonly { readonly target: Hex; readonly data: Hex; readonly value: bigint }[];
}

/** A value the program would splice in at run time, filled with this so the payload decodes. */
const SPLICED = 0x5911ced5911ced5911ced5911ced5911ced5911cedn;

/**
 * The `publishAndFund` a lowered site sends, rebuilt from the rewritten source: its literal hex
 * segments, concatenated around a fixed word wherever the program splices a run-time value. What
 * comes back is decoded by the Portal's ABI — so it is the intent as the Portal would receive it.
 */
function publishedBy(source: string, site = 0) {
  const segments = new Map<string, string>();
  for (const [, name, hex] of source.matchAll(/const (i\d+_s\d+) = hex`([0-9a-f]*)`;/g)) {
    segments.set(name!, hex!);
  }
  const data = new RegExp(`const i${site}_data = ([^;]+);`).exec(source)?.[1];
  if (data === undefined) throw new Error(`no lowered intent #${site} in the source`);
  const parts = [
    data.split(".concat(")[0]!,
    ...[...data.matchAll(/\.concat\(([^)]+\)?)\)/g)].map((m) => m[1]!),
  ];
  const payload = parts
    .map((part) => segments.get(part) ?? SPLICED.toString(16).padStart(64, "0"))
    .join("");
  const { args } = decodeFunctionData({ abi: PortalABI, data: `0x${payload}` });
  const [destination, routeBytes, reward] = args as unknown as [
    bigint,
    Hex,
    { readonly tokens: readonly { readonly token: Hex; readonly amount: bigint }[] },
  ];
  const [route] = decodeAbiParameters([EVM_ROUTE_PARAM], routeBytes) as unknown as [DecodedRoute];

  return { destination, route, reward };
}

/** Every address the rewritten source calls, reads or code-checks, in source order. */
function addressesUsedBy(source: string): { readonly kind: string; readonly target: Hex }[] {
  const used = [...source.matchAll(/(evm\.static|evm\.call|ctx\.codeSize)\((\d+)n/g)].map((m) => ({
    kind: m[1]!,
    target: address(BigInt(m[2]!)),
  }));
  // Every such call, or none of them: an address spelled any other way (a hex literal, a local)
  // would otherwise drop out of the list, and the checks over it would pass having checked nothing.
  const calls = source.match(/(evm\.static|evm\.call|ctx\.codeSize)\(/g) ?? [];
  if (used.length === 0 || used.length !== calls.length) {
    throw new Error(`read ${used.length} of the ${calls.length} addresses the source calls`);
  }
  return used;
}

/** Each compile that lowered an intent, keyed `<on>-><to>` by the chains the test knows it spans.
 *  `on` is where the compiled program runs; the intent it publishes goes to `to`. */
function levelsOf(recorded: readonly Compile[], topology: Readonly<Record<string, Slug>>) {
  const levels = new Map<string, Compile & { readonly intent: ReturnType<typeof publishedBy> }>();
  for (const compile of recorded) {
    if (!/const i0_data = /.test(compile.source)) continue;
    const intent = publishedBy(compile.source);
    const to = (Object.keys(topology) as Slug[]).find((slug) => idOf(slug) === intent.destination);
    if (to === undefined) throw new Error(`an intent to chain ${intent.destination} was lowered`);
    levels.set(`${topology[to]}->${to}`, { ...compile, intent });
  }
  return levels;
}

const lower = (hex: string) => hex.toLowerCase();

/**
 * One level, on `on`, publishing an intent to `to`. The reward, its approval and the publication
 * are `on`'s; the delivery and the body are `to`'s; and the program's own compile-time names are
 * `on`'s, with nothing left over from the chain that opened it.
 */
function expectLevel(
  level: Compile & { readonly intent: ReturnType<typeof publishedBy> },
  on: Slug,
  to: Slug,
  opener: Slug | undefined,
) {
  const { destination, route, reward } = level.intent;
  expect(destination).toBe(idOf(to));

  // Funded here: the reward token, and every address the approval touches.
  expect(reward.tokens.map((t) => lower(t.token))).toEqual([usdcOf(on)]);
  const used = addressesUsedBy(level.source);
  expect(used.at(-1)).toEqual({ kind: "evm.call", target: lower(ecoRoutesPortal(on)) });
  expect(used.slice(0, -1).map((u) => u.kind)).toEqual(
    expect.arrayContaining(["evm.static", "evm.call", "ctx.codeSize"]),
  );
  for (const { target } of used.slice(0, -1)) expect(target).toBe(usdcOf(on));

  // Run there: what the solver delivers, and every call the route makes on a token.
  expect(route.tokens.map((t) => lower(t.token))).toEqual([usdcOf(to)]);
  expect(lower(route.calls[0]!.target)).toBe(usdcOf(to));

  // The program's own names. Everything a chain defines is `on`'s value, and nothing only the
  // opener's chain defines survived into it.
  expect(level.defines.USDC).toBe(BigInt(usdcOf(on)));
  const own = definesOf(on);
  const opened = opener === undefined ? {} : definesOf(opener);
  for (const [name, value] of Object.entries(level.defines)) {
    if (name in own) expect([name, value]).toEqual([name, own[name]]);
    else expect([name, name in opened]).toEqual([name, false]);
  }
}

// ---------------------------------------------------------------------------------------------

describe.each(PATHS)("through %s", (_name, build) => {
  const callerDefines = { RECIPIENT, MIN_AMOUNT: 1n };

  it("the README example: Base's USDC funds it, Arbitrum's is delivered and transferred", () => {
    const levels = levelsOf(
      record(() => build(README_EXAMPLE, callerDefines)),
      { arbitrum: "base" },
    );
    expect([...levels.keys()]).toEqual(["base->arbitrum"]);

    const level = levels.get("base->arbitrum")!;
    expectLevel(level, "base", "arbitrum", undefined);
    const { route } = level.intent;
    expect(route.calls).toHaveLength(1);
    const transfer = decodeFunctionData({ abi: erc20Abi, data: route.calls[0]!.data });
    expect(transfer.functionName).toBe("transfer");
    expect(BigInt(transfer.args[0] as Hex)).toBe(RECIPIENT);
  });

  it("the cascade: every level funded on its own chain and run on the next", () => {
    const recorded = record(() => build(CASCADE_EXAMPLE, callerDefines));
    const levels = levelsOf(recorded, { arbitrum: "base", optimism: "arbitrum" });
    expect([...levels.keys()].sort()).toEqual(["arbitrum->optimism", "base->arbitrum"]);

    // Level 1, on Base: its body is a program, so the route forwards the delivery to Arbitrum's Pot
    // and cooks the level-2 program there.
    const first = levels.get("base->arbitrum")!;
    expectLevel(first, "base", "arbitrum", undefined);
    const arbitrumPot = v12PredictPot(ecoRoutesExecutorOf(ecoRoutesPortal("arbitrum")));
    expect(first.intent.route.calls).toHaveLength(2);
    const forward = decodeFunctionData({ abi: erc20Abi, data: first.intent.route.calls[0]!.data });
    expect([forward.functionName, lower(forward.args[0] as Hex)]).toEqual([
      "transfer",
      lower(arbitrumPot),
    ]);
    const cook = first.intent.route.calls[1]!;
    expect(lower(cook.target)).toBe(lower(arbitrumPot));
    const [engine, program] = decodeFunctionData({ abi: v12Pot.abi, data: cook.data })
      .args as readonly [Hex, Hex];
    expect(lower(engine)).toBe(lower(v12EngineAddress()));

    // Level 2, on Arbitrum: the program that cook runs is the recorded compile, byte for byte.
    const second = levels.get("arbitrum->optimism")!;
    expect(lower(program).startsWith(lower(second.bytecode))).toBe(true);
    expectLevel(second, "arbitrum", "optimism", "base");
    // A caller's define that no chain defines holds at every depth.
    const payout = decodeFunctionData({ abi: erc20Abi, data: second.intent.route.calls[0]!.data });
    expect([payout.functionName, BigInt(payout.args[0] as Hex)]).toEqual(["transfer", RECIPIENT]);
  });
});

describe("every path lowers every level to the same source", () => {
  it.each([
    ["the README example", README_EXAMPLE],
    ["the cascade", CASCADE_EXAMPLE],
  ])("%s", (_name, program) => {
    const sources = PATHS.map(([, build]) =>
      record(() => build(program, { RECIPIENT, MIN_AMOUNT: 1n })).map((c) => c.source),
    );
    for (const other of sources.slice(1)) expect(other).toEqual(sources[0]);
  });
});

describe.each(CHAIN_DEFINE_PATHS)(
  "the other values that belong to a chain, through %s",
  (_name, build) => {
    // `chainId` and protocol addresses are chain-scoped too. A token-only body folds them into its
    // route calls when the intent is built, so the decoded calldata says which chain's they were.
    const program = `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, chainId);
    USDC.approve(UniswapV4_UniversalRouter, amount);
  }).reward({ tokens: [{ token: USDC, amount: chainId }] });
}`;
    const routerOn = (slug: Slug) => BigInt(definesOf(slug).UniswapV4_UniversalRouter as bigint);

    it("the body reads Arbitrum's `chainId` and router; the reward, Base's `chainId`", () => {
      expect(routerOn("base")).not.toBe(routerOn("arbitrum"));
      const [level] = levelsOf(
        record(() => build(program, { RECIPIENT })),
        { arbitrum: "base" },
      ).values();
      const calls = level!.intent.route.calls.map((call) => {
        const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: call.data });
        return [functionName, BigInt(args[0] as Hex), args[1]];
      });

      expect(calls).toEqual([
        ["transfer", RECIPIENT, idOf("arbitrum")],
        ["approve", routerOn("arbitrum"), 0n],
        ["approve", routerOn("arbitrum"), SPLICED],
      ]);
      expect(level!.intent.reward.tokens.map((t) => [lower(t.token), t.amount])).toEqual([
        [usdcOf("base"), idOf("base")],
      ]);
    });
  },
);

describe.each(PATHS)("a caller's own defines, through %s", (_name, build) => {
  const program = `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: CHOSEN, amount }] });
}`;
  const chosen = 0x7777777777777777777777777777777777777777n;

  it("a define no chain has means exactly its value, wherever it appears", () => {
    const [level] = levelsOf(
      record(() => build(program, { RECIPIENT, CHOSEN: chosen })),
      { arbitrum: "base" },
    ).values();

    expect(level!.intent.reward.tokens.map((t) => lower(t.token))).toEqual([address(chosen)]);
    expect(level!.intent.route.tokens.map((t) => lower(t.token))).toEqual([usdcOf("arbitrum")]);
  });

  it("a define of a chain-scoped name is the compiled chain's, not the destination's", () => {
    // `USDC: chosen` overrides Base's USDC for the program compiled for Base, and for the reward it
    // funds there. It says nothing about Arbitrum, so the body keeps Arbitrum's.
    const [level] = levelsOf(
      record(() =>
        build(program.replace("token: CHOSEN", "token: USDC"), { RECIPIENT, USDC: chosen }),
      ),
      { arbitrum: "base" },
    ).values();

    expect(level!.defines.USDC).toBe(chosen);
    expect(level!.intent.reward.tokens.map((t) => lower(t.token))).toEqual([address(chosen)]);
    expect(level!.intent.route.tokens.map((t) => lower(t.token))).toEqual([usdcOf("arbitrum")]);
    expect(level!.intent.route.calls.map((c) => lower(c.target))).toEqual([usdcOf("arbitrum")]);
  });
});
