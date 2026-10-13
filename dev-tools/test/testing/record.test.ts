/**
 * Recording with no remote RPC: `fork()` records through its recorder from an anvil on this machine,
 * standing in for a chain's endpoint, and the file it writes replays with no RPC at all.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { encodeFunctionData, type Address } from "viem";

import { fork, local, type TestChain } from "../../src/testing/index.js";
import { rpc, startAnvil } from "../../src/testing/node.js";
import { startForkNode } from "../../src/testing/state.js";
import {
  anvilMissing,
  children,
  fakeAnvil,
  gone,
  program,
  uniswapV3Pool,
  type V3Pool,
} from "./support.js";

/**
 * A swap of `pool`'s input token from account 0's Pot on `chain`, in what the chain itself reports
 * of it: the accounts' nonces before it, its transaction, gas and balance changes, and the pinned
 * block, the cook's and the one after, as their headers say.
 */
async function swapOn(chain: TestChain, { pool, tokenIn, tokenOut, funded }: V3Pool) {
  const alice = chain.account(0);
  const recipient = chain.account(1).address;
  const nonces = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      chain.client.getTransactionCount({ address: chain.account(index).address }),
    ),
  );
  const pinned = await chain.client.getBlock();
  const ether = await chain.balanceOf(alice.address, "ETH");
  // The tokens emit no Transfer: what moved is read from their balances.
  const holding = await chain.balanceOf(alice.pot, tokenIn);
  const result = await chain.run(program("pool-swap"), {
    args: [pool, tokenIn, tokenOut, funded, recipient],
  });
  const { blockNumber } = await chain.client.getTransactionReceipt({ hash: result.hash! });
  const cooked = await chain.client.getBlock({ blockNumber });
  await chain.mine();
  const after = await chain.client.getBlock();
  const header = ({ number, timestamp, gasLimit, baseFeePerGas }: typeof pinned) => ({
    number,
    timestamp,
    gasLimit,
    baseFeePerGas,
  });

  return {
    nonces,
    hash: result.hash,
    gasUsed: result.gasUsed,
    returned: result.returned,
    received: await chain.balanceOf(recipient, tokenOut),
    paid: holding - (await chain.balanceOf(alice.pot, tokenIn)),
    etherSpent: ether - (await chain.balanceOf(alice.address, "ETH")),
    // The pinned block's own gasUsed is not compared: a replay boots from a file at that block, so
    // the block it reports there is its own genesis, which carries none.
    blocks: [header(pinned), { ...header(cooked), gasUsed: cooked.gasUsed }, header(after)],
  };
}

/** What `anvil_nodeInfo` says a node runs as, and anvil's dev accounts' nonces there. */
async function nodeOf(url: string) {
  const info = (await rpc(url, "anvil_nodeInfo")) as {
    hardFork: string;
    environment: { baseFee: string; chainId: number; gasLimit: string };
  };
  const accounts = (await rpc(url, "eth_accounts")) as string[];

  return {
    hardFork: info.hardFork,
    chainId: info.environment.chainId,
    gasLimit: BigInt(info.environment.gasLimit),
    // The base fee of the next block.
    baseFee: BigInt(info.environment.baseFee),
    nonces: await Promise.all(
      accounts.map(
        async (account) =>
          [
            account,
            Number(await rpc(url, "eth_getTransactionCount", [account, "latest"])),
          ] as const,
      ),
    ),
  };
}

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

  it("replays what it recorded: a swap's gas, what it moved, and the blocks around it", async () => {
    const upstream = await local();
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-roundtrip-"));
    const state = join(dir, "swap.json.gz");
    try {
      const pool = await uniswapV3Pool(upstream);
      const block = Number(await upstream.client.getBlockNumber());

      const recording = await fork("base", { block, state, rpcUrl: upstream.rpcUrl });
      assert.equal(recording.mode, "record");
      const recorded = await swapOn(recording, pool);
      await recording.stop();
      await upstream.stop();

      const replay = await fork("base", { block, state });
      let replayed: typeof recorded;
      try {
        assert.equal(replay.mode, "replay");
        replayed = await swapOn(replay, pool);
      } finally {
        await replay.stop();
      }
      assert.deepEqual(replayed, recorded);

      // What makes the comparison worth something: the swap moved what it bought, the upstream's
      // account 0 had sent transactions, its blocks hold `local()`'s 100M gas rather than anvil's
      // default 30M, the base fee stepped from the pinned block's, and each block is Base's 2
      // seconds after the one before it.
      assert.ok((recorded.returned as bigint) > 0n);
      assert.equal(recorded.received, recorded.returned);
      assert.equal(recorded.paid, pool.funded);
      assert.ok(recorded.nonces[0]! > 0);
      const [pinned, cooked, after] = recorded.blocks;
      assert.equal(cooked!.gasLimit, 100_000_000n);
      assert.notEqual(cooked!.baseFeePerGas, pinned!.baseFeePerGas);
      assert.equal(cooked!.timestamp - pinned!.timestamp, 2n);
      assert.equal(after!.timestamp - cooked!.timestamp, 2n);
    } finally {
      await upstream.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replays on the node it recorded on: hardfork, gas limit, base fee, dev nonces", async () => {
    // An Ethereum block from 2024, which a fork runs as Cancun: anvil infers the hardfork from the
    // block it forks, and runs its own default from a file.
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-node-"));
    const genesis = join(dir, "upstream.json");
    writeFileSync(
      genesis,
      JSON.stringify({
        config: { chainId: 1 },
        number: `0x${(20_000_000).toString(16)}`,
        timestamp: `0x${(1_717_000_000).toString(16)}`,
        gasLimit: `0x${(36_000_000).toString(16)}`,
        baseFeePerGas: "0x1dcd65000",
        difficulty: "0x0",
        alloc: {},
      }),
    );
    const upstream = await startAnvil([
      "--init",
      genesis,
      "--chain-id",
      "1",
      "--gas-limit",
      "36000000",
    ]);
    const state = join(dir, "node.json.gz");
    try {
      // Dev account 0 sends: its nonce is no longer 0, and the pinned block used gas.
      const [sender] = (await rpc(upstream.url, "eth_accounts")) as string[];
      for (const value of ["0x1", "0x2"]) {
        await rpc(upstream.url, "eth_sendTransaction", [{ from: sender, to: sender, value }]);
      }
      const block = Number(await rpc(upstream.url, "eth_blockNumber"));
      const at = { chainId: 1, block, blockInterval: 12 } as const;

      const recording = await startForkNode({ ...at, mode: "record", rpcUrl: upstream.url, state });
      const recorded = await nodeOf(recording.url);
      await recording.stop();
      await upstream.stop();
      assert.equal(recorded.hardFork, "Cancun");
      assert.equal(recorded.gasLimit, 36_000_000n);
      assert.deepEqual(recorded.nonces[0], [sender, 2]);

      const replay = await startForkNode({ ...at, mode: "replay", state });
      try {
        assert.deepEqual(await nodeOf(replay.url), recorded);
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

  it("clears a live Kitchen's fee with zeroFee, as its owner, and stops being the owner", async () => {
    const upstream = await local();
    try {
      // The chain runs the release with a fee, and a Kitchen owned by an address no node signs for.
      const owner: Address = "0x00000000000000000000000000000000000000f5";
      const kitchen = (functionName: string, args: readonly unknown[] = []) => ({
        to: upstream.kitchen,
        data: encodeFunctionData({
          abi: upstream.stack.kitchenAbi,
          functionName,
          args: args as never,
        }),
      });
      await upstream.impersonate(upstream.account(0).address, (send) =>
        send(kitchen("transferOwnership", [owner])),
      );
      await upstream.impersonate(owner, async (send) => {
        await send(kitchen("acceptOwnership"));
        await send(kitchen("setExecutionFee", [7n]));
      });
      assert.equal(await upstream.executionFee(), 7n);
      const block = Number(await upstream.client.getBlockNumber());

      const kept = await fork("base", { block, rpcUrl: upstream.rpcUrl });
      try {
        assert.equal(kept.stack.origin, "live");
        assert.equal(await kept.executionFee(), 7n);
      } finally {
        await kept.stop();
      }

      const cleared = await fork("base", { block, rpcUrl: upstream.rpcUrl, zeroFee: true });
      try {
        assert.equal(cleared.stack.origin, "live");
        assert.equal(await cleared.executionFee(), 0n);
        // A cook pays nothing beyond its own value.
        assert.equal(
          (await cleared.run(program("multiply"), { args: [6n, 7n, 100n] })).returned,
          42n,
        );
        // The owner is no longer impersonated: the node refuses to send for it.
        await assert.rejects(
          rpc(cleared.rpcUrl, "eth_sendTransaction", [{ from: owner, ...kitchen("owner") }]),
        );
      } finally {
        await cleared.stop();
      }
    } finally {
      await upstream.stop();
    }
  });

  it("stops its node and its recorder when the node fails it once started", async () => {
    // A node that answers as a chain does until it is asked anything else.
    const fake = fakeAnvil(`
      require("node:http").createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => (body += chunk));
        request.on("end", () => {
          const { id, method } = JSON.parse(body);
          response.end(JSON.stringify(method === "eth_chainId"
            ? { jsonrpc: "2.0", id, result: "0x2105" }
            : { jsonrpc: "2.0", id, error: { code: -32000, message: "this node fails" } }));
        });
      }).listen(port, "127.0.0.1");
    `);
    const state = join(fake.dir, "failed.json.gz");
    const before = new Set(children().map(({ pid }) => pid));
    try {
      await assert.rejects(
        fork("base", { block: 1, state, rpcUrl: "http://127.0.0.1:9", anvil: fake.path }),
        /this node fails/,
      );
      const left = children().filter(({ pid }) => !before.has(pid));
      for (const { pid } of left) assert.ok(await gone(pid), `pid ${pid} still runs`);
      assert.equal(existsSync(state), false);
    } finally {
      for (const { pid } of children().filter(({ pid }) => !before.has(pid))) {
        process.kill(pid, "SIGKILL");
      }
      rmSync(fake.dir, { recursive: true, force: true });
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

describe("the recorder", () => {
  it("gives up on an endpoint that keeps refusing within its deadline", async () => {
    // An endpoint that answers every request as an RPC under load does: 503.
    const busy = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(503);
        response.end("busy");
      });
    });
    busy.listen(0, "127.0.0.1");
    await once(busy, "listening");
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-recorder-"));
    const out = join(dir, "recorded.json");
    const recorder = spawn(
      process.execPath,
      [resolve(dirname(fileURLToPath(import.meta.url)), "../../src/testing/recorder.mjs")],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    try {
      const upstream = `http://127.0.0.1:${(busy.address() as AddressInfo).port}`;
      recorder.stdin!.end(JSON.stringify({ upstream, block: "0x1", out, deadline: 2_000 }));
      const [port] = (await once(recorder.stdout!, "data")) as [Buffer];
      const started = Date.now();
      const response = await fetch(`http://127.0.0.1:${Number(port.toString().trim())}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
        // Without a deadline it retries for over a minute.
        signal: AbortSignal.timeout(15_000),
      });
      const took = Date.now() - started;
      assert.ok(took < 2_000 + 1_500, `answered after ${took} ms`);
      assert.equal(response.status, 502);

      const exited = once(recorder, "exit");
      recorder.kill("SIGTERM");
      await exited;
      const { errors } = JSON.parse(readFileSync(out, "utf8")) as { errors: string[] };
      assert.deepEqual(errors, ["the endpoint did not answer within 2 s"]);
    } finally {
      if (recorder.exitCode === null && recorder.signalCode === null) recorder.kill("SIGKILL");
      busy.closeAllConnections();
      busy.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
