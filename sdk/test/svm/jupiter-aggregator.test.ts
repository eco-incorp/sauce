/**
 * Jupiter's aggregator in the SVM registry (`svm/venues/jupiter-aggregator`): its `route` and
 * `shared_accounts_route` instructions read from their data. The answer is Jupiter's public Swap
 * API's real one (`fixtures/swap/jupiter-solana-swap-instructions.json`, fetched once by hand on
 * 2026-10-03): 100 USDC for SOL through the shared accounts, built for a Pot.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  JUPITER_AGGREGATOR_PROGRAM_ID,
  jupiterRouteData,
} from "../../src/svm/venues/jupiter-aggregator/index.js";

const answer = JSON.parse(
  readFileSync(
    join(process.cwd(), "test", "fixtures", "swap", "jupiter-solana-swap-instructions.json"),
    "utf8",
  ),
) as { swapInstruction: { programId: string; data: string } };

describe("Jupiter's aggregator instruction, read", () => {
  it("is a shared-accounts route of 100 USDC, its tail at the end of its data", () => {
    const data = Buffer.from(answer.swapInstruction.data, "base64");
    const decoded = jupiterRouteData(data)!;

    expect(answer.swapInstruction.programId).toBe(JUPITER_AGGREGATOR_PROGRAM_ID);
    expect(decoded).toMatchObject({
      instruction: "shared_accounts_route",
      inAmount: 100000000n,
      quotedOutAmount: 834568839n,
      slippageBps: 50,
      platformFeeBps: 0,
      accounts: { authority: 2, source: 3, destination: 6, destinationMint: 8 },
    });
    expect(decoded.offsets.inAmount).toBe(data.length - 19);
    expect(decoded.offsets.quotedOutAmount).toBe(data.length - 11);
    expect(decoded.offsets.slippageBps).toBe(data.length - 3);
  });

  it("is nothing for an instruction it does not know", () => {
    expect(jupiterRouteData(Uint8Array.from([1, 2, 3]))).toBeUndefined();
    expect(jupiterRouteData(new Uint8Array(64))).toBeUndefined();
  });
});
