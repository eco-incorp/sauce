/**
 * Which chain a name inside `Chain(() => { ... }).reward({ ... })` resolves on.
 *
 * The BODY runs on the destination, so its names — and the delivery argument's — are the
 * destination's. The REWARD is escrowed where the program runs, and the program approves the Portal
 * for it there, so its names are the enclosing chain's. A reward token resolved on the destination
 * is an address with no code where the approval runs: SafeERC20's code check reverts the whole
 * fulfilment, and the intent is never published.
 *
 * Each case uses the SDK's REAL per-chain registry, where `USDC` is a different address on every
 * chain involved. A suite that gives a symbol one address everywhere — a `tokens` override, a define
 * — cannot tell the chains apart, which is how this went unnoticed. What a chain does with these
 * bytes is `routes-intent-chains.e2e.test.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  bytesToHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  erc20Abi,
  hexToBytes,
  keccak256,
  type Hex,
} from "viem";

import { requireChain } from "../src/chains/canonical.js";
import { v12Pot } from "../src/evm/engine.js";
import { v12EngineAddress } from "../src/deployments/index.js";
import { v12PredictPot } from "../src/deployments/pot.js";
import { PortalABI } from "../src/protocols/eco-routes/abis.js";
import {
  ecoRoutesExecutorOf,
  ecoRoutesPortal,
  ecoRoutesProver,
} from "../src/protocols/eco-routes/lookup.js";
import { EVM_REWARD_PARAM, EVM_ROUTE_PARAM } from "../src/routes/encode.js";
import { openRoute, type IntentOptions } from "../src/routes/intent-dsl.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";
import { registryTokenAddress } from "../src/routes/token-registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const example = (name: string) =>
  readFileSync(join(HERE, "../../docs/examples", `${name}.sauce.ts`), "utf8");
const README_EXAMPLE = example("cross-chain-intent");
const CASCADE_EXAMPLE = example("cross-chain-cascade");

const address = (value: bigint): Hex => `0x${value.toString(16).padStart(40, "0")}`;
const usdcOf = (slug: string): Hex => address(registryTokenAddress(requireChain(slug), "USDC")!);
const BASE_USDC = usdcOf("base");
const ARBITRUM_USDC = usdcOf("arbitrum");
const OPTIMISM_USDC = usdcOf("optimism");
const USDC_BY_CHAIN = { base: BASE_USDC, arbitrum: ARBITRUM_USDC, optimism: OPTIMISM_USDC };

const CREATOR = "0x4444444444444444444444444444444444444444" as const;
const RECIPIENT = 0x6666666666666666666666666666666666666666n;
const DEADLINE = 2_000_000_000n;
const EXECUTION_FEE = 1_000n;
const EXECUTION = {
  pot: "0x2222222222222222222222222222222222222222",
  engine: "0x3333333333333333333333333333333333333333",
} as const;

/** A direct compile, for source `base`, with only what cannot be looked up. */
const compileOnBase = (program: string) =>
  compileSauceRoute("base", program, EXECUTION, {
    ambient: ["@sauce/token"],
    defines: { RECIPIENT, MIN_AMOUNT: 1n },
    intents: { deadline: DEADLINE, creator: CREATOR, executionFee: EXECUTION_FEE },
  });

/** The docs examples' own `IntentOptions`: an Ethereum -> Base intent whose route runs the program. */
const builderOptions: IntentOptions = {
  execution: { value: EXECUTION_FEE },
  nativeAmount: EXECUTION_FEE,
  deadline: DEADLINE,
  creator: CREATOR,
  prover: "0x5555555555555555555555555555555555555555",
  source: "ethereum",
  defines: { RECIPIENT, MIN_AMOUNT: 1n },
  compile: { intents: { executionFee: EXECUTION_FEE } },
};
const buildOnBase = (program: string) =>
  openRoute("base", program, builderOptions).reward({
    creator: CREATOR,
    prover: "0x5555555555555555555555555555555555555555",
    deadline: DEADLINE + 3_600n,
    nativeAmount: 0n,
  });

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
  return [...source.matchAll(/(evm\.static|evm\.call|ctx\.codeSize)\((\d+)n/g)].map((m) => ({
    kind: m[1]!,
    target: address(BigInt(m[2]!)),
  }));
}

// ---------------------------------------------------------------------------------------------
// Finding an intent inside compiled bytecode
// ---------------------------------------------------------------------------------------------

/** Anything distinctive: it only marks where a prefix ends, and never reaches the bytecode. */
const CUT = 0x0c0ffee0c0ffee0c0ffee0c0ffee0c0ffee0c0ffee0c0ffee0c0ffee0c0ffeen;
const cutAt = (encoded: Hex): string => {
  const at = encoded.indexOf(CUT.toString(16).padStart(64, "0"));
  if (at < 0) throw new Error("the cut marker is missing from the encoding");
  return encoded.slice(2, at);
};

/**
 * The bytes a reward naming `token` begins with, through its first token address — exactly as they
 * sit, contiguous, in the literal segment the program sends. Everything before the first run-time
 * amount is literal, so a program carrying this reward carries this string.
 */
function rewardPrefix(from: string, to: string, token: Hex): string {
  const encoded = encodeAbiParameters(
    [EVM_REWARD_PARAM],
    [
      {
        deadline: DEADLINE,
        creator: CREATOR,
        prover: ecoRoutesProver(from, to),
        nativeAmount: 0n,
        tokens: [{ token, amount: CUT }],
      },
    ],
  );
  // The leading word is the tuple's offset, which the calldata carries elsewhere.
  return cutAt(encoded).slice(64);
}

/** The same for a route delivering `token` on `to`: its head, through the first delivered token. */
function routePrefix(to: string, token: Hex): string {
  return cutAt(
    encodeAbiParameters(
      [EVM_ROUTE_PARAM],
      [
        {
          salt: `0x${"00".repeat(32)}`,
          deadline: DEADLINE,
          portal: ecoRoutesPortal(to),
          // A token-only body cooks nothing, so its route carries no native amount.
          nativeAmount: 0n,
          tokens: [{ token, amount: CUT }],
          calls: [],
        },
      ],
    ),
  );
}

/** Which chain's USDC the intent `from -> to` carried in `bytecode` names, for the reward and for
 *  the route — `undefined` when it names none of them. Asserting the whole answer rather than one
 *  membership means a program carrying BOTH candidates fails too. */
function tokensCarried(bytecode: Uint8Array, from: string, to: string) {
  const hex = bytesToHex(bytecode).slice(2);
  const which = (prefix: (token: Hex) => string) =>
    Object.entries(USDC_BY_CHAIN)
      .filter(([, token]) => hex.includes(prefix(token)))
      .map(([slug]) => slug);

  return {
    reward: which((token) => rewardPrefix(from, to, token)),
    route: which((token) => routePrefix(to, token)),
  };
}

// ---------------------------------------------------------------------------------------------

describe("the README example: a program on Base opening an intent on Arbitrum", () => {
  it("escrows the reward in BASE's USDC and approves it there; the body uses Arbitrum's", () => {
    const { source } = compileOnBase(README_EXAMPLE);
    const { destination, route, reward } = publishedBy(source);

    expect(destination).toBe(42_161n);
    // The reward is escrowed on Base by this program, so it is Base's USDC.
    expect(reward.tokens.map((t) => t.token.toLowerCase())).toEqual([BASE_USDC]);

    // The allowance read, the reset, the approve and their code checks all run on Base, against
    // the reward token; the last call is the publication, to Base's Portal. None of them may name
    // Arbitrum's USDC, which has no code on Base.
    const used = addressesUsedBy(source);
    const publication = used.at(-1)!;
    expect(publication).toEqual({
      kind: "evm.call",
      target: ecoRoutesPortal("base").toLowerCase(),
    });
    expect(used.slice(0, -1).map((u) => u.kind)).toEqual(
      expect.arrayContaining(["evm.static", "evm.call", "ctx.codeSize"]),
    );
    for (const { target } of used.slice(0, -1)) expect(target).toBe(BASE_USDC);

    // The body runs on Arbitrum: what the solver delivers and what the call moves are Arbitrum's.
    expect(route.tokens.map((t) => t.token.toLowerCase())).toEqual([ARBITRUM_USDC]);
    expect(route.calls).toHaveLength(1);
    expect(route.calls[0]!.target.toLowerCase()).toBe(ARBITRUM_USDC);
    const transfer = decodeFunctionData({ abi: erc20Abi, data: route.calls[0]!.data });
    expect(transfer.functionName).toBe("transfer");
    expect(BigInt(transfer.args[0] as Hex)).toBe(RECIPIENT);
  });

  it("builds the same intent from TypeScript: `Base(program, options).reward(...)`", () => {
    const built = buildOnBase(README_EXAMPLE);

    expect(tokensCarried(built.compiled.bytecode[0]!, "base", "arbitrum")).toEqual({
      reward: ["base"],
      route: ["arbitrum"],
    });
  });

  it("compiles to the same program either way", () => {
    // The builder adds chain-scoped defines the program does not read, and nothing else may differ.
    expect(keccak256(buildOnBase(README_EXAMPLE).compiled.bytecode[0]!)).toBe(
      keccak256(compileOnBase(README_EXAMPLE).compiled.bytecode[0]!),
    );
  });

  it("a literal or a define in `.reward(...)` still means exactly that address", () => {
    const program = (token: string) => `function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: ${token}, amount }] });
}`;
    const chosen = 0x7777777777777777777777777777777777777777n;
    const viaDefine = compileSauceRoute("base", program("CHOSEN"), EXECUTION, {
      defines: { RECIPIENT, CHOSEN: chosen },
      intents: { deadline: DEADLINE, creator: CREATOR },
    }).source;
    const viaLiteral = compileOnBase(program(`${chosen}n`)).source;

    for (const source of [viaDefine, viaLiteral]) {
      expect(publishedBy(source).reward.tokens.map((t) => t.token.toLowerCase())).toEqual([
        address(chosen),
      ]);
      expect(publishedBy(source).route.tokens.map((t) => t.token.toLowerCase())).toEqual([
        ARBITRUM_USDC,
      ]);
    }
  });
});

describe("a two-level cascade: Base -> Arbitrum -> Optimism", () => {
  // Each level's reward is escrowed on that level's SOURCE chain — the chain its program runs on —
  // and each body runs on its own destination. Arbitrum's program opens the Optimism intent, so
  // that one is funded in Arbitrum's USDC.
  const arbitrumPot = v12PredictPot(ecoRoutesExecutorOf(ecoRoutesPortal("arbitrum")));

  it("level 1 (on Base) funds in Base's USDC and delivers Arbitrum's", () => {
    const { source } = compileOnBase(CASCADE_EXAMPLE);
    const { destination, route, reward } = publishedBy(source);

    expect(destination).toBe(42_161n);
    expect(reward.tokens.map((t) => t.token.toLowerCase())).toEqual([BASE_USDC]);
    for (const { target } of addressesUsedBy(source).slice(0, -1)) expect(target).toBe(BASE_USDC);

    // The delivery argument is the destination's, and the Executor forwards it to Arbitrum's Pot.
    expect(route.tokens.map((t) => t.token.toLowerCase())).toEqual([ARBITRUM_USDC]);
    expect(route.calls).toHaveLength(2);
    expect(route.calls[0]!.target.toLowerCase()).toBe(ARBITRUM_USDC);
    const forward = decodeFunctionData({ abi: erc20Abi, data: route.calls[0]!.data });
    expect(forward.functionName).toBe("transfer");
    expect((forward.args[0] as Hex).toLowerCase()).toBe(arbitrumPot.toLowerCase());
    expect(route.calls[1]!.target.toLowerCase()).toBe(arbitrumPot.toLowerCase());
  });

  it("level 2 (on Arbitrum) funds in Arbitrum's USDC and delivers Optimism's", () => {
    const { source } = compileOnBase(CASCADE_EXAMPLE);
    const cook = publishedBy(source).route.calls[1]!;
    const { args } = decodeFunctionData({ abi: v12Pot.abi, data: cook.data });
    expect((args[0] as Hex).toLowerCase()).toBe(v12EngineAddress().toLowerCase());
    const arbitrumProgram = args[1] as Hex;

    expect(tokensCarried(hexToBytes(arbitrumProgram), "arbitrum", "optimism")).toEqual({
      reward: ["arbitrum"],
      route: ["optimism"],
    });
    // Base's USDC means nothing on Arbitrum; the program Arbitrum runs must not name it at all.
    expect(arbitrumProgram.toLowerCase()).not.toContain(BASE_USDC.slice(2));
  });

  it("builds the same cascade from TypeScript: `Base(program, options).reward(...)`", () => {
    // Byte for byte, so everything asserted of the direct compile above holds for the builder's.
    // (Searching the builder's bytecode for each level's reward cannot tell the levels apart: both
    // rewards have the same creator, deadline and — the prover being one address on every chain —
    // prover, so only the token differs, and that is the thing under test.)
    expect(keccak256(buildOnBase(CASCADE_EXAMPLE).compiled.bytecode[0]!)).toBe(
      keccak256(compileOnBase(CASCADE_EXAMPLE).compiled.bytecode[0]!),
    );
  });

  it("the builder's Arbitrum program is the direct compile's", () => {
    const direct = publishedBy(compileOnBase(CASCADE_EXAMPLE).source).route.calls[1]!;
    const program = (decodeFunctionData({ abi: v12Pot.abi, data: direct.data }).args[1] as Hex)
      .slice(2)
      .toLowerCase();
    // Up to the first value the Base program splices in at run time: the Arbitrum bytecode itself.
    const literal = program.split(SPLICED.toString(16).padStart(64, "0"))[0]!;
    expect(literal.length).toBeGreaterThan(1_000);

    // Before the builder recomputed chain-scoped defines per chain, Base's USDC reached this
    // program as a define and replaced Arbitrum's in it.
    expect(bytesToHex(buildOnBase(CASCADE_EXAMPLE).compiled.bytecode[0]!).includes(literal)).toBe(
      true,
    );
  });
});
