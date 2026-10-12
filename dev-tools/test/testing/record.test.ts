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
});
