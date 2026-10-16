/**
 * Recording Solana with no remote RPC: `fork("solana")` records from the SDK's pinned mainnet dumps
 * served on loopback (`solana-support.ts#pinnedCluster`), standing in for a cluster's endpoint, and
 * the file it writes replays with no RPC at all, to the same results.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { gunzipSync } from "node:zlib";

import { fork, type SolanaTestChain } from "../../src/testing/index.js";
import { MAINNET_FEE, PINNED, pinnedCluster, pinnedPool, solanaMissing } from "./solana-support.js";

/** A swap of 100 USDC at the pinned Orca whirlpool from account 0's Pot, as the chain reports it. */
async function swapOn(chain: SolanaTestChain) {
  const pot = chain.account(0).pot;
  const bob = chain.account(1).address;
  await chain.fund(pot, { USDC: "100" });
  const result = await chain.run(
    {
      source:
        "function main(pool: Address, amountIn: Uint256, priceLimit: Uint256): Uint256 {\n" +
        "  return Orca.Whirlpool.swap(pool, USDC, WSOL, amountIn, priceLimit, 1);\n}\n",
    },
    { args: [pinnedPool("orca-whirlpool-sol-usdc"), 100_000_000n, 10n ** 30n] },
  );
  const paid = await chain.run(
    { source: "function main(to: Address, amount: Uint256) {\n  WSOL.transfer(to, amount);\n}\n" },
    { args: [bob, result.returned as bigint] },
  );

  return {
    slot: await chain.slot(),
    now: await chain.now(),
    fee: await chain.executionFee(),
    returned: result.returned,
    computeUnits: [result.computeUnits, paid.computeUnits],
    changes: [result.changes, paid.changes],
    received: await chain.balanceOf(bob, "WSOL"),
  };
}

describe(
  'fork("solana") records from a cluster and replays with none',
  { skip: solanaMissing() },
  () => {
    let dir: string;
    let cluster: Awaited<ReturnType<typeof pinnedCluster>>;
    before(async () => {
      dir = mkdtempSync(join(tmpdir(), "sauce-testing-solana-"));
      cluster = await pinnedCluster();
    });
    after(async () => {
      await cluster?.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it("records what a test read at the cluster's slot, and replays it to the same results", async () => {
      const state = join(dir, "swap.json.gz");
      const recording = await fork("solana", { state, rpcUrl: cluster.url });
      assert.equal(recording.mode, "record");
      const recorded = await swapOn(recording);
      assert.equal(recorded.slot, PINNED.slot);
      assert.equal(recorded.fee, MAINNET_FEE);
      assert.ok((recorded.returned as bigint) > 0n);
      assert.equal(recorded.received, recorded.returned);
      assert.ok(!existsSync(state), "the file is written when the chain stops");
      await recording.stop();
      assert.ok(existsSync(state));

      // What it read, and only that: the pool's program and accounts, no URL.
      const text = gunzipSync(readFileSync(state)).toString("utf8");
      const file = JSON.parse(text) as {
        accounts: Record<string, unknown>;
        programs: Record<string, string>;
      };
      assert.ok(!text.includes(new URL(cluster.url).host));
      assert.deepEqual(Object.keys(file.programs), ["whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"]);
      assert.ok(Object.hasOwn(file.accounts, pinnedPool("orca-whirlpool-sol-usdc")));
      assert.ok(!Object.hasOwn(file.accounts, pinnedPool("raydium-clmm-sol-usdc")));

      // Replayed with no RPC: the cluster is asked nothing more.
      const asked = cluster.methods.get("getMultipleAccounts");
      const replay = await fork("solana", { state });
      assert.equal(replay.mode, "replay");
      assert.deepEqual(await swapOn(replay), recorded);
      await replay.stop();
      assert.equal(cluster.methods.get("getMultipleAccounts"), asked);

      // A replay reads nothing the recording lacks: a token it never read is not there.
      const again = await fork("solana", { state, mode: "replay" });
      await assert.rejects(
        again.fund(again.account(0).pot, { USDT: "1" }),
        /USDT's mint, .*, is not on this chain: the recording does not hold it, so record again/,
      );
    });

    it("refuses a replay with no file, and a recording with no RPC", async () => {
      const missing = join(dir, "missing.json.gz");
      await assert.rejects(
        fork("solana", { state: missing, mode: "replay" }),
        /replay needs a recorded state file/,
      );
      await assert.rejects(
        fork("solana", { state: missing }),
        /no recorded state at .*missing\.json\.gz: pass `rpcUrl` once to record it/,
      );
    });

    it("forks live, recording nothing, and clears the fee with zeroFee", async () => {
      const live = await fork("solana", { rpcUrl: cluster.url, zeroFee: true });
      assert.equal(live.mode, "live");
      assert.equal(await live.executionFee(), 0n);
      await live.fund(live.account(0).pot, { USDC: "1" });
      assert.equal(await live.balanceOf(live.account(0).pot, "USDC"), 1_000_000n);
      await live.stop();
    });

    it("refuses a recording of another chain's file", async () => {
      await assert.rejects(
        fork("solana", { state: join(import.meta.dirname, "state/base.json.gz"), mode: "replay" }),
        /is not a recorded Solana state file/,
      );
    });
  },
);
