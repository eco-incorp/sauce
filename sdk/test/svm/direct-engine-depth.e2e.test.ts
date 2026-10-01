/**
 * The CPI depth a program has, entered through the Kitchen or directly, on the invoke stack mainnet
 * runs: 5 instructions deep, because SIMD-0268 (which raises it to 9) is off. A file of its own
 * because that is a LiteSVM of its own — one per process, as every engine suite here keeps — and
 * `direct-engine.e2e.test.ts` measures the 9-deep stack with every feature on. The probe is
 * `cpi-depth.ts`'s chain of engine frames.
 */
import { longestChains } from "./cpi-depth.js";
import { describeSvm, SIMD_0268_CPI_NESTING, startEngine, ENGINE_SO } from "./engine-harness.js";
import type { EngineHarness } from "./engine-harness.js";

describeSvm("CPI depth on mainnet's 5-deep invoke stack, through the Kitchen and direct", () => {
  let harness: EngineHarness;

  beforeAll(async () => {
    harness = await startEngine(1_700_000_000n, ENGINE_SO, undefined, [SIMD_0268_CPI_NESTING]);
  });

  it("a direct cook leaves the program one more level of CPI depth than a Kitchen cook", async () => {
    const { longest, height, refusals } = await longestChains(harness, 1n);

    expect(refusals).toHaveLength(2);
    for (const refusal of refusals) expect(refusal).toMatch(/CallDepth/);
    // A Kitchen cook spends height 1 on the Kitchen, so the engine runs at 2 and the program's own
    // calls get 3..5: three levels. A direct cook runs the engine at 1, leaving 2..5: four.
    expect(height).toBe(5);
    expect(longest).toEqual({ kitchen: 4, engine: 5 });
  });
});
