/**
 * The wait between a fill's lookup table and the fill (`intent-svm.ts#tableReady`): a table resolves
 * the addresses it was extended with only from the next slot, so the fill waits for the cluster to
 * pass it, and a read that fails or a slot that never moves ends in an error, not in a fill sent
 * against a table that may not be usable yet.
 */
import { CliError } from "../src/cli/args.js";
import { tableReady } from "../src/cli/intent-svm.js";

/** An endpoint whose slot is each of `slots` in turn, then the last. */
const slots = (...values: bigint[]) => {
  let at = 0;

  return {
    getSlot: () => ({
      send: async () => values[Math.min(at++, values.length - 1)]!,
    }),
  } as never;
};
const FAST = { tries: 3, delayMs: 1 };

describe("waiting for a fill's lookup table", () => {
  it("returns once the cluster passes the slot the table was extended in", async () => {
    await expect(
      tableReady(slots(10n, 10n, 11n), "solana", "T", 10n, FAST),
    ).resolves.toBeUndefined();
  });

  it("waits past the slot it reads first, where the send reported none", async () => {
    await expect(
      tableReady(slots(7n, 7n, 8n), "solana", "T", undefined, FAST),
    ).resolves.toBeUndefined();
  });

  it("refuses to go on when the slot does not move", async () => {
    const waited = tableReady(slots(10n), "solana", "T", 10n, FAST);
    await expect(waited).rejects.toThrow(CliError);
    await expect(tableReady(slots(10n), "solana", "T", 10n, FAST)).rejects.toThrow(
      /did not pass slot 10, where the lookup table T was extended[^]*the fill was not sent/,
    );
  });

  it("says a failed read, with no endpoint in it", async () => {
    const failing = {
      getSlot: () => ({
        send: async () => {
          throw new Error("fetch failed for https://rpc.example/key-123456789012345678901234");
        },
      }),
    } as never;
    const refusal = tableReady(failing, "solana", "T", 10n, FAST);
    await expect(refusal).rejects.toThrow(
      /reading solana's slot, to wait for the lookup table T, failed: fetch failed for <endpoint>/,
    );
  });
});
