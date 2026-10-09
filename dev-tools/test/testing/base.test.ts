/**
 * `fork()` on Base, replayed from `state/base.json.gz` — Base at block 52,384,000, recorded once —
 * with no RPC. Record it again (`RECAPTURE_ANVIL_STATE=1`, the RPC from `sdk/rpc.config.json`) when
 * the suite starts reading state it did not read before, or the pinned block moves.
 */
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";

import { CookReverted, fork, type TestChain } from "../../src/testing/index.js";
import { anvilMissing, program, recordRpc, recording, statePath } from "./support.js";

const BLOCK = 52_384_000;
const STATE = statePath("base");

describe("fork('base') replayed", { skip: anvilMissing() }, () => {
  let base: TestChain;
  before(async () => {
    base = await fork("base", {
      block: BLOCK,
      state: STATE,
      ...(recording
        ? { mode: "record" as const, rpcUrl: recordRpc(8453) }
        : { mode: "replay" as const }),
    });
  });
  after(() => base?.stop());
  beforeEach(() => base.snapshot());
  afterEach(() => base.revert());

  it("uses Base's own stack, Kitchen fee included", async () => {
    assert.equal(base.mode, recording ? "record" : "replay");
    assert.equal(base.stack.origin, "live");
    assert.ok((await base.executionFee()) > 0n);
    // The pinned block, and the few setup mined after it (account 0's Pot).
    const head = await base.client.getBlockNumber();
    assert.ok(head >= BigInt(BLOCK) && head < BigInt(BLOCK) + 5n);
  });

  it("funds a Pot with USDC by writing the token's balance slot", async () => {
    const pot = base.account(0).pot;
    await base.fund(pot, { USDC: "100" });
    assert.equal(await base.balanceOf(pot, "USDC"), 100_000_000n);
    await base.fund(pot, { USDC: 1n });
    assert.equal(await base.balanceOf(pot, "USDC"), 100_000_001n);
  });

  it("swaps on Uniswap V3 and reports what moved", async () => {
    const alice = base.account(0);
    await base.fund(alice.pot, { USDC: "100" });
    const result = await base.run(program("swap"), { args: [100_000_000n, 0n, alice.address] });

    assert.equal(typeof result.returned, "bigint");
    const bought = result.returned as bigint;
    assert.ok(bought > 0n);
    assert.equal(result.delta(alice.address, "WETH"), bought);
    assert.equal(result.delta(alice.pot, "USDC"), -100_000_000n);
    assert.equal(await base.balanceOf(alice.address, "WETH"), bought);
  });

  it("reverts below minOut, moving nothing", async () => {
    const alice = base.account(0);
    await base.fund(alice.pot, { USDC: "100" });
    await assert.rejects(
      base.run(program("swap"), { args: [100_000_000n, 10n ** 30n, alice.address] }),
      CookReverted,
    );
    assert.equal(await base.balanceOf(alice.pot, "USDC"), 100_000_000n);
  });

  it("refuses to cook without the budget, with the program's reason", async () => {
    await assert.rejects(
      base.simulate(program("swap"), { args: [100_000_000n, 0n, base.account(0).address] }),
      (error: unknown) =>
        error instanceof CookReverted && error.reason === "amountIn is not in the Pot",
    );
  });
});
