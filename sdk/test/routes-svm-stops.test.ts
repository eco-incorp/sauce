/**
 * A Solana program written with the venue namespaces compiles, where no stop binds, to exactly the
 * program it was before `@sauce/router` had its Stopped forms: the same bytes with the router's
 * "Held to a stop" section removed, which leaves the arm as it was. Only a swap compiled held
 * (`SauceProgramOptions.stops`) calls the Stopped form, its stop a value added to `main`.
 */
import { readFileSync } from "node:fs";

import { STD_SOURCES } from "../src/embedded/sources.generated.js";
import { compileSauceProgram } from "../src/routes/sauce-route.js";

const ARM = "router/router.svm.js";
const RULE =
  "// ---------------------------------------------------------------------------------------------\n";

/** The SVM arm with its Stopped forms removed: the section between its header and the next. */
function withoutStopped(arm: string): string {
  const start = arm.indexOf(`${RULE}// Held to a stop\n`);
  const end = arm.indexOf(RULE, start + RULE.length * 2);
  if (start < 0 || end < 0) throw new Error("the arm has no Held to a stop section");
  return arm.slice(0, start) + arm.slice(end);
}

/** `source` compiled for Solana against the arm as it is, and with its Stopped forms removed. */
function bothWays(source: string): { readonly now: Uint8Array; readonly before: Uint8Array } {
  const now = compileSauceProgram("solana", source).bytecode;
  const sources = STD_SOURCES as Record<string, string>;
  const arm = sources[ARM]!;
  sources[ARM] = withoutStopped(arm);
  try {
    return { now, before: compileSauceProgram("solana", source).bytecode };
  } finally {
    sources[ARM] = arm;
  }
}

const PROGRAM = readFileSync(
  new URL(
    "../../skills/sauce-solana-distributed-swap/examples/solana-distributed-swap.sauce.ts",
    import.meta.url,
  ),
  "utf8",
);

const swapAt = (namespace: string, key: number) =>
  "function main(amountIn: Uint256, priceLimit: Uint256): Uint256 {\n" +
  `  return ${namespace}.swap(${namespace}.pool(USDC, WSOL, ${key}), USDC, WSOL, amountIn, priceLimit, 0);\n}\n`;

describe("Solana swaps at a price no stop binds", () => {
  it("removing the Stopped forms leaves only them out of the arm", () => {
    const arm = STD_SOURCES[ARM]!;
    const before = withoutStopped(arm);
    const names = (text: string) =>
      [...text.matchAll(/^export function (\w+)\(/gm)].map((match) => match[1]!);
    const removed = names(arm).filter((name) => !names(before).includes(name));
    expect(removed.sort()).toEqual(
      [
        "byrealStopped",
        "cremaStopped",
        "cropperStopped",
        "defitunaStopped",
        "orcaWhirlpoolStopped",
        "pancakeswapClmmStopped",
        "raydiumClmmStopped",
        "stabbleClmmStopped",
      ].sort(),
    );
  });

  it("compile against the arm as the embedded sources hold it, which the comparisons change", () => {
    const sources = STD_SOURCES as Record<string, string>;
    const arm = sources[ARM]!;
    sources[ARM] = arm.replace(
      "export function orcaWhirlpool(",
      "export function orcaWhirlpoolGone(",
    );
    try {
      expect(() => compileSauceProgram("solana", swapAt("Orca.Whirlpool", 4))).toThrow();
    } finally {
      sources[ARM] = arm;
    }
  });

  it("compile the distributed swap to the same bytes as the arm without its Stopped forms", () => {
    const { now, before } = bothWays(PROGRAM);
    expect(Buffer.from(now).equals(Buffer.from(before))).toBe(true);
    expect(compileSauceProgram("solana", PROGRAM).derivedValues).toBeUndefined();
  });

  it.each([
    ["Raydium.CLMM", 400],
    ["Pancakeswap.CLMM", 100],
    ["Orca.Whirlpool", 4],
    ["Cropper.Whirlpool", 2],
    ["Defituna.Fusion", 4],
    ["Crema.CLMM", 50],
  ])("compile a %s swap to the same bytes as the arm without its Stopped forms", (ns, key) => {
    const { now, before } = bothWays(swapAt(ns, key));
    expect(Buffer.from(now).equals(Buffer.from(before))).toBe(true);
  });

  it("compile a held swap to its Stopped form, and only that one", () => {
    const plain = compileSauceProgram("solana", PROGRAM);
    const first = plain.stoppable![0]!;
    const held = compileSauceProgram("solana", PROGRAM, { stops: [first] });
    expect(held.derivedValues).toEqual([
      { name: expect.stringMatching(/Stop$/), type: "Uint256", derive: first },
    ]);
    expect(held.source.match(/Stopped\(/g)).toHaveLength(1);
    expect(held.manifest).toEqual(plain.manifest);
    expect(Buffer.from(held.bytecode).equals(Buffer.from(plain.bytecode))).toBe(false);
  });
});
