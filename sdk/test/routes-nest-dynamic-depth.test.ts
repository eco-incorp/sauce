/**
 * How deep a dynamic cascade goes, and what stops it.
 *
 * Every level embeds the next: level N's route carries level N+1's compiled program as literal
 * calldata, and level N-1 splices amounts into THAT. The obvious worry is that this compounds
 * multiplicatively. It does not — each level's bytes appear exactly ONCE in the chain, so the
 * outermost payload is the sum of the per-level overheads, and growth is linear. The numbers below
 * are measured, not argued.
 *
 * The other worry is that the levels interfere: if the parent's split of the child's calldata also
 * matched the GRANDCHILD's sentinels, the parent would overwrite the grandchild's placeholders with
 * its own measurement and destroy the level below. It cannot, and the reason is structural rather
 * than lucky — `splitByPlaceholders` CUTS the sentinels out, so a compiled dynamic program contains
 * the segments AROUND them and never the sentinel bytes themselves. The first test pins that,
 * because it is the property the whole recursion rests on.
 *
 * Compile-only. `routes-nest-dynamic.e2e.test.ts` executes the depth-2 case end to end.
 */
import { bytesToHex, encodeFunctionData, parseAbi, type Hex } from "viem";

import { compileProgram as compile, SDK_SOURCE_DIRS } from "./helpers";
import { v12Pot } from "../src/evm/engine.js";
import {
  AMOUNT_IN_PLACEHOLDER,
  AMOUNT_OUT_PLACEHOLDER,
  dynamicChildProgram,
  dynamicChildTemplate,
  type DynamicChildOptions,
} from "../src/routes/nest-dynamic.js";
import { normalizeReward, normalizeRoute } from "../src/routes/normalize.js";
import type { Intent } from "../src/routes/types.js";

const PORTAL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const POT = "0x1111111111111111111111111111111111111111" as const;
const ENGINE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;
const CREATOR = "0x3333333333333333333333333333333333333333" as const;
const PROVER = "0x4444444444444444444444444444444444444444" as const;
const MINT_TARGET = "0x9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a" as const;

const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);
const token = (n: number): Hex => `0x${n.toString(16).padStart(2, "0").repeat(20)}` as Hex;

const optionsFor = (measured: Hex): DynamicChildOptions => ({
  portal: PORTAL,
  measure: { kind: "erc20Balance", token: measured },
  scale: 990000000000000000n,
  placeholders: [
    { value: AMOUNT_IN_PLACEHOLDER, source: "amountIn", occurrences: 1 },
    { value: AMOUNT_OUT_PLACEHOLDER, source: "amountOut", occurrences: 1 },
  ],
});

type Call = { target: Hex; data: Hex; value: bigint };

/** One level of the cascade: its reward is `amountIn`, its delivery obligation `amountOut`, and its
 *  route carries whatever the level below contributed. */
function levelIntent(level: number, calls: readonly Call[]): Intent {
  return {
    destination: 8453n,
    sourceChainId: 8453n,
    route: normalizeRoute({
      salt: `0x${level.toString(16).padStart(2, "0").repeat(32)}` as Hex,
      deadline: 4_000_000_000n,
      portal: PORTAL,
      tokens: [{ token: token(level + 0x20), amount: AMOUNT_OUT_PLACEHOLDER }],
      calls,
    }),
    reward: normalizeReward({
      deadline: 4_000_000_000n,
      creator: CREATOR,
      prover: PROVER,
      tokens: [{ token: token(level + 0x10), amount: AMOUNT_IN_PLACEHOLDER }],
    }),
  };
}

const compileLevel = (intent: Intent, measured: Hex): Uint8Array => {
  const program = dynamicChildProgram([{ child: intent, opts: optionsFor(measured) }]);

  return compile(program.source, { baseDirs: [...SDK_SOURCE_DIRS] }).bytecode[0]!;
};

/**
 * Builds a `depth`-level cascade INNERMOST FIRST — the only order possible, since a level's route
 * embeds the compiled program of the level below it. Returns the outermost level's `cook` calldata,
 * which is what a parent route would carry.
 */
function cascadeCookSize(depth: number): number {
  let calls: Call[] = [];
  let bytecode: Uint8Array = new Uint8Array();
  for (let level = depth; level >= 1; level--) {
    bytecode = compileLevel(levelIntent(level, calls), token(level + 0x10));
    calls = [
      // The "swap" stand-in: whatever produces the balance this level's program measures.
      {
        target: MINT_TARGET,
        data: encodeFunctionData({ abi: mintAbi, functionName: "mint", args: [POT, 1000n] }),
        value: 0n,
      },
      { target: POT, data: v12Pot.encodeCook(ENGINE, bytesToHex(bytecode)), value: 0n },
    ];
  }

  return (v12Pot.encodeCook(ENGINE, bytesToHex(bytecode)).length - 2) / 2;
}

describe("the sentinels of one level never reach the level above", () => {
  it("a compiled dynamic program contains the segments AROUND its sentinels, never the sentinels", () => {
    const bytecode = compileLevel(levelIntent(2, []), token(0x12));
    const hex = Buffer.from(bytecode).toString("hex");

    for (const sentinel of [AMOUNT_IN_PLACEHOLDER, AMOUNT_OUT_PLACEHOLDER]) {
      expect(hex).not.toContain(sentinel.toString(16).padStart(64, "0"));
    }
  });

  it("so a parent splitting its child finds the CHILD's two slots and nothing of the grandchild", () => {
    const grandchild = compileLevel(levelIntent(2, []), token(0x12));
    const child = levelIntent(1, [
      { target: POT, data: v12Pot.encodeCook(ENGINE, bytesToHex(grandchild)), value: 0n },
    ]);

    const template = dynamicChildTemplate(child, optionsFor(token(0x11)));

    // Exactly the child's own reward amount and delivery obligation. A third slot here would mean
    // the parent had claimed one of the grandchild's fields.
    expect(template.slots).toHaveLength(2);
    expect(template.slots.map((s) => s.source).sort()).toEqual(["amountIn", "amountOut"]);
  });
});

describe("payload growth with depth", () => {
  // Measured on this fixture; the constant moves with the intent's own size, the SHAPE does not.
  const sizes = [1, 2, 3, 5, 10].map((depth) => [depth, cascadeCookSize(depth)] as const);

  it("is LINEAR in depth, not multiplicative — each level's bytes appear exactly once", () => {
    const deltas = sizes.slice(1).map(([, size], i) => size - sizes[i]![1]);
    const perLevel = deltas[0]!;

    // Every step adds the same number of bytes per level it added, within rounding.
    deltas.forEach((delta, i) => {
      const levels = sizes[i + 1]![0] - sizes[i]![0];
      expect(delta).toBe(perLevel * levels);
    });
    expect(perLevel).toBeGreaterThan(0);
  });

  it("reports the measured sizes, so a budget can be set against numbers rather than a guess", () => {
    // depth 1 ≈ 1.5 kB of cook calldata, each further level ≈ 1.95 kB on this fixture.
    expect(sizes[0]![1]).toBeLessThan(2_000);
    expect(sizes[4]![1]).toBeLessThan(20_000);
    console.log(`cook calldata by depth: ${sizes.map(([d, s]) => `${d}=${s}B`).join(", ")}`);
  });
});

describe("the ceiling", () => {
  // The wall is the COMPILER's, it is named, and it arrives long after gas makes the cascade
  // impractical: a `hex` literal is length-encoded with a u16, so one segment cannot exceed 65535
  // bytes. DISCOVERED rather than hardcoded -- the exact depth moves with the per-level byte cost,
  // and a number baked in here would silently become a weaker assertion after any codegen change.
  const NAMED = /an array literal can have at most 65535 elements, got \d+/;

  const compiles = (depth: number): boolean => {
    try {
      cascadeCookSize(depth);

      return true;
    } catch (error) {
      if (!NAMED.test(String((error as Error).message))) throw error;

      return false;
    }
  };

  /** The deepest cascade that compiles, found by walking down from a depth known to fail. */
  const maxDepth = (): number => {
    for (let depth = 60; depth > 1; depth--) {
      if (compiles(depth)) return depth;
    }
    throw new Error("no depth compiled at all");
  };

  it("has a ceiling in the tens, and one level past it fails with the engine's named error", () => {
    const max = maxDepth();

    expect(max).toBeGreaterThan(20);
    expect(max).toBeLessThan(60);
    expect(() => cascadeCookSize(max + 1)).toThrow(NAMED);
    console.log(`deepest cascade that compiles: ${max} levels (${cascadeCookSize(max)}B)`);
  }, 300_000);
});
