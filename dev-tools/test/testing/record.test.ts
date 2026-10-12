/**
 * Recording with no remote RPC: `fork()` records through its recorder from an anvil on this machine,
 * standing in for a chain's endpoint, and the file it writes replays with no RPC at all.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";

import { fork, local } from "../../src/testing/index.js";
import { anvilMissing, program } from "./support.js";

describe("fork() records, then replays", { skip: anvilMissing() }, () => {
  it("writes what the tests read, without the RPC, and replays it", async () => {
    const upstream = await local();
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-record-"));
    const state = join(dir, "base.json.gz");
    try {
      const block = Number(await upstream.client.getBlockNumber());
      // Anvil's RPC cache for this chain and block, which a recording must neither read nor write.
      const cache = join(homedir(), ".foundry", "cache", "rpc", "base", String(block));
      const cached = existsSync(cache);

      const recording = await fork("base", {
        block,
        state,
        rpcUrl: upstream.rpcUrl,
        mode: "record",
      });
      assert.equal(recording.mode, "record");
      assert.equal(recording.stack.origin, "live");
      const multiply = { args: [6n, 7n, 100n] };
      assert.equal((await recording.run(program("multiply"), multiply)).returned, 42n);
      await recording.stop();

      const text = gunzipSync(readFileSync(state)).toString();
      assert.equal(text.includes(new URL(upstream.rpcUrl).host), false);
      assert.equal(existsSync(cache), cached);

      // The upstream is gone: what replays is the file alone.
      await upstream.stop();
      const replay = await fork("base", { block, state, mode: "replay" });
      try {
        assert.equal(replay.mode, "replay");
        assert.equal(replay.stack.origin, "live");
        assert.equal((await replay.run(program("multiply"), multiply)).returned, 42n);
      } finally {
        await replay.stop();
      }
    } finally {
      await upstream.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("picks its mode by what it is given, and refuses what it cannot do", async () => {
    const upstream = await local();
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-modes-"));
    const state = join(dir, "modes.json.gz");
    try {
      const block = Number(await upstream.client.getBlockNumber());
      const multiply = { args: [6n, 7n, 100n] };

      // No state named: a live fork, which writes nothing.
      const live = await fork("base", { block, rpcUrl: upstream.rpcUrl });
      assert.equal(live.mode, "live");
      assert.equal((await live.run(program("multiply"), multiply)).returned, 42n);
      await live.stop();
      assert.equal(existsSync(state), false);

      // A state file not there yet, with an endpoint: recorded.
      const first = await fork("base", { block, state, rpcUrl: upstream.rpcUrl });
      assert.equal(first.mode, "record");
      await first.run(program("multiply"), multiply);
      await first.stop();
      assert.equal(existsSync(state), true);

      // The file there: replayed, the endpoint never read.
      const again = await fork("base", { block, state, rpcUrl: "http://127.0.0.1:9" });
      assert.equal(again.mode, "replay");
      await again.stop();

      // What none of the modes can do.
      const missing = join(dir, "missing.json.gz");
      await assert.rejects(
        fork("base", { block, state: missing }),
        /pass `rpcUrl` once to record it/,
      );
      await assert.rejects(fork("base", { block }), /a live fork needs `rpcUrl`/);
      await assert.rejects(
        fork("base", { block, state: missing, mode: "replay" }),
        /replay needs a recorded state file/,
      );
      await assert.rejects(
        fork("base", { block, rpcUrl: upstream.rpcUrl, mode: "record" }),
        /recording needs `state`/,
      );
      await assert.rejects(
        fork("base", { block: block + 1, state, mode: "replay" }),
        /holds chain 8453 at block \d+, not chain 8453 at/,
      );
    } finally {
      await upstream.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes no file when the endpoint failed during the recording", async () => {
    const upstream = await local();
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-failed-"));
    const state = join(dir, "failed.json.gz");
    try {
      const block = Number(await upstream.client.getBlockNumber());
      const recording = await fork("base", { block, state, rpcUrl: upstream.rpcUrl });
      // The endpoint goes away, and the test reads an account the recording has not seen.
      await upstream.stop();
      await recording.client
        .getBalance({ address: "0x00000000000000000000000000000000000000f1" })
        .catch(() => undefined);
      await assert.rejects(recording.stop(), /recording failed/);
      assert.equal(existsSync(state), false);
    } finally {
      await upstream.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
