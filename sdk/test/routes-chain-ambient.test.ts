/**
 * P7 — chain-bundle activation: the ambient-MODULE dimension (`chainAmbient`, `ambient.ts`)
 * threaded into `openRoute`'s compile seam (`intent-dsl.ts`), alongside the already-landed
 * scalar-defines half (`chainDefines`, see `routes-ambient.test.ts`).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireChain } from "../src/chains/canonical.js";
import { chainAmbient, openRoute } from "../src/routes/index.js";
import type { IntentOptions } from "../src/routes/index.js";
import { compileSauceRoute } from "../src/routes/sauce-route.js";

const POT = "0x1111111111111111111111111111111111111111" as const;
const PORTAL = "0x2222222222222222222222222222222222222222" as const;
const AMBIENT_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "rs-ambient");

function evmOptions(overrides: Partial<IntentOptions> = {}): IntentOptions {
  return {
    pot: POT,
    deadline: 2000n,
    portal: PORTAL,
    source: "base",
    creator: "0x3333333333333333333333333333333333333333",
    prover: "0x4444444444444444444444444444444444444444",
    rewardDeadline: 1000n,
    ...overrides,
  };
}

describe("chainAmbient", () => {
  it("is empty by default for every chain (this branch ships no real ambient module yet)", () => {
    expect(chainAmbient(requireChain("base"))).toEqual([]);
    expect(chainAmbient(requireChain("solana"))).toEqual([]);
  });
});

describe("openRoute: chain-scoped ambient bundle activation (P7)", () => {
  const bareBody = "return double(21n);"; // no `import` line anywhere

  it("a program using an ambient symbol compiles via the RS path when the merged ambient list is non-empty", () => {
    const built = openRoute("base", bareBody, evmOptions({
      compile: { baseDirs: [AMBIENT_FIXTURE_DIR], ambient: ["./math-helpers.js"] },
    })).reward(0n);
    expect(built.compiled.bytecode.length).toBe(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);
  });

  it("is byte-identical to calling compileSauceRoute directly with compiler:'rs' + the same ambient list", () => {
    const viaOpenRoute = openRoute("base", bareBody, evmOptions({
      compile: { baseDirs: [AMBIENT_FIXTURE_DIR], ambient: ["./math-helpers.js"] },
    })).reward(0n);

    const direct = compileSauceRoute(requireChain("base"), bareBody, { pot: POT }, {
      compiler: "rs",
      baseDirs: [AMBIENT_FIXTURE_DIR],
      ambient: ["./math-helpers.js"],
      // openRoute also threads chain-scoped scalar defines (chainId/CHAIN_ID) underneath -- match
      // them here so this is a true apples-to-apples bytecode comparison, not a false negative.
      defines: { chainId: BigInt(requireChain("base").id), CHAIN_ID: BigInt(requireChain("base").id) },
    });

    expect(Array.from(viaOpenRoute.compiled.bytecode[0]!)).toEqual(Array.from(direct.compiled.bytecode[0]!));
  });

  it("an explicit compiler:'ts' choice is never overridden, even with a non-empty ambient list (and fails, as documented)", () => {
    // Proves the gate respects an explicit caller choice rather than always forcing 'rs' -- the TS
    // compiler this repo vendors has no `ambient` concept, so the identical body still fails here.
    expect(() =>
      openRoute("base", bareBody, evmOptions({
        compile: { compiler: "ts", baseDirs: [AMBIENT_FIXTURE_DIR], ambient: ["./math-helpers.js"] },
      })).reward(0n),
    ).toThrow();
  });

  it("default (empty ambient bundle): compiler stays 'ts'/unset and bytecode is unaffected by this feature", () => {
    const built = openRoute("base", "return chainId;", evmOptions()).reward(0n);
    expect(built.compiled.bytecode.length).toBe(1);
    expect(built.compiled.bytecode[0]!.length).toBeGreaterThan(0);

    // Byte-identical to the pre-P7 TS-default path (routes-ambient.test.ts already pins this same
    // equivalence for chainDefines alone -- this re-confirms it still holds now that the ambient
    // merge/compiler-gate logic sits in the same code path).
    const explicitTs = compileSauceRoute(requireChain("base"), "return chainId;", { pot: POT }, {
      compiler: "ts",
      defines: { chainId: BigInt(requireChain("base").id), CHAIN_ID: BigInt(requireChain("base").id) },
    });
    expect(Array.from(built.compiled.bytecode[0]!)).toEqual(Array.from(explicitTs.compiled.bytecode[0]!));
  });
});
