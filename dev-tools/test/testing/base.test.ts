/**
 * `fork()` on Base, replayed from `state/base.json.gz` — Base at block 52,384,000, recorded once —
 * with no RPC. Record it again (`RECAPTURE_ANVIL_STATE=1`, the RPC from `sdk/rpc.config.json`) when
 * the suite starts reading state it did not read before, or the pinned block moves. The file is a
 * version 1 recording, which replays at its gas limit alone (`state.ts`): recording it again adds
 * the node's hardfork, next base fee and dev nonces.
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

  it("does not choose a caught out-of-gas path instead of a successful atomic payment", async () => {
    const alice = base.account(0);
    const recipient = base.account(1).address;
    const payment = {
      source: `function main(recipient: Address, amount: Uint256, reserve: Uint256): void {
        try {
          USDC.transfer(recipient, amount);
          require(pot.USDC >= reserve, "keep the reserve");
        } catch (error) {
          log(error);
        }
      }`,
    };
    await base.fund(alice.pot, { USDC: "5" });

    const rolledBack = await base.run(payment, { args: [recipient, 1_000_000n, 5_000_000n] });
    assert.equal(rolledBack.delta(recipient, "USDC"), 0n);
    assert.equal(await base.balanceOf(alice.pot, "USDC"), 5_000_000n);

    const committed = await base.run(payment, { args: [recipient, 1_000_000n, 1_000_000n] });
    assert.equal(committed.delta(recipient, "USDC"), 1_000_000n);
    assert.equal(await base.balanceOf(alice.pot, "USDC"), 4_000_000n);
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
