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

describe("each Solana swap at a price's stop, as the cook's builder names it", () => {
  const twice =
    "function main(amountIn: Uint256, priceLimit: Uint256): Uint256 {\n" +
    "  let got = Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amountIn, priceLimit, 0);\n" +
    "  got += Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amountIn, priceLimit, 0);\n" +
    "  return got;\n}\n";

  it("names a second swap of the same pool, token and limit apart, so each is charged", () => {
    expect(compileSauceProgram("solana", twice).stoppable).toEqual([
      "stop:Orca.Whirlpool(USDC,WSOL,4):USDC:@priceLimit",
      "stop:Orca.Whirlpool(USDC,WSOL,4):USDC:@priceLimit#2",
    ]);
  });

  it("counts a swap in a loop that writes its count out, and leaves one that does not uncounted", () => {
    const swap =
      "Orca.Whirlpool.swap(Orca.Whirlpool.pool(USDC, WSOL, 4), USDC, WSOL, amountIn, priceLimit, 0)";
    /** The swap's runs in `loop`, written around it, with `also` in the loop's body, after `before`. */
    const runs = (loop: string, also = "", before = "") =>
      compileSauceProgram(
        "solana",
        "function main(amountIn: Uint256, priceLimit: Uint256, n: Uint256): Uint256 {\n" +
          `  let got = 0;\n  ${before}${loop.replace("BODY", `${also}got += ${swap};`)}\n  return got;\n}\n`,
      ).stoppableRuns;
    const at = "stop:Orca.Whirlpool(USDC,WSOL,4):USDC:@priceLimit";
    expect(runs("for (let i = 0; i < 2; i++) { BODY }")).toEqual({ [at]: 2 });
    expect(runs("for (let i = 1; i <= 6; i += 2) { BODY }")).toEqual({ [at]: 3 });
    expect(runs("for (let i = 3; i > 0; i--) { BODY }")).toEqual({ [at]: 3 });
    expect(runs("for (const x of [1, 2, 3, 4]) { BODY }")).toEqual({ [at]: 4 });
    expect(runs("for (let i = 0; i < 2; i++) { for (let j = 0; j < 3; j++) { BODY } }")).toEqual({
      [at]: 6,
    });
    expect(runs("for (let i = 0; i < 0; i++) { BODY }")).toEqual({ [at]: 0 });
    expect(runs("for (let i = 0x0; i < 0x3; i++) { BODY }")).toEqual({ [at]: 3 });
    // A count the loop does not write out: a bound that is a value, a counter its body sets too,
    // a `while`, and a negative number, which the compiler reads as 2^256 less it: `-1` is the
    // greatest number, so `i > 0` holds from there down, and only the `break` ends the loop.
    expect(runs("for (let i = 0; i < n; i++) { BODY }")).toEqual({ [at]: null });
    expect(runs("for (let i = -1; i > 0; i--) { BODY }")).toEqual({ [at]: null });
    expect(
      runs(
        "for (let i = -1; i > -4; i--) { BODY count += 1; if (count == 2) { break; } }",
        "",
        "let count = 0;\n  ",
      ),
    ).toEqual({ [at]: null });
    expect(runs("for (let i = 0; i < 4; i++) { BODY }", "i += 1; ")).toEqual({ [at]: null });
    expect(runs("while (got < amountIn) { BODY }")).toEqual({ [at]: null });
    // A loop that never runs makes the swap in it run never, whatever another loop around it or
    // inside it counts, a negative one or one bound by a value.
    for (const [outer, inner] of [
      ["for (let i = 0; i < 0; i++)", "for (let j = -1; j > 0; j--)"],
      ["for (let j = -1; j > 0; j--)", "for (let i = 0; i < 0; i++)"],
      ["for (let i = 0; i < n; i++)", "for (let j = 0; j < 0; j++)"],
    ]) {
      expect(runs(`${outer} { ${inner} { BODY } }`)).toEqual({ [at]: 0 });
    }
    // Outside any loop it runs once, and is not listed.
    expect(compileSauceProgram("solana", twice).stoppableRuns).toBeUndefined();
  });

  it("takes main's priceLimit only as main gave it: not one reassigned or declared again", () => {
    const reassigned = swapAt("Orca.Whirlpool", 4).replace(
      "  return",
      "  priceLimit = priceLimit * 2;\n  return",
    );
    expect(compileSauceProgram("solana", reassigned).stoppable).toEqual([
      "stop:Orca.Whirlpool(USDC,WSOL,4):USDC:",
    ]);
    const literal = swapAt("Orca.Whirlpool", 4).replace(
      "amountIn, priceLimit, 0",
      "amountIn, 150, 0",
    );
    expect(compileSauceProgram("solana", literal).stoppable).toEqual([
      "stop:Orca.Whirlpool(USDC,WSOL,4):USDC:150",
    ]);
  });
});
