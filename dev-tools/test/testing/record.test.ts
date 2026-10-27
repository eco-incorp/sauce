/**
 * Recording with no remote RPC: `fork()` records through its recorder from an anvil on this machine,
 * standing in for a chain's endpoint, and the file it writes replays with no RPC at all.
 */
import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
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

/** The block, as hex, that `url`'s node mined transaction `hash` in, waiting until it has. */
async function minedIn(url: string, hash: unknown): Promise<string> {
  for (;;) {
    const receipt = (await rpc(url, "eth_getTransactionReceipt", [hash])) as {
      blockNumber: string;
    } | null;
    if (receipt !== null) return receipt.blockNumber;
    await new Promise((ok) => setTimeout(ok, 10));
  }
}

/**
 * A node recorded into `dir` by `startForkNode`, from an upstream at an Ethereum block of 2024, which
 * a fork runs as Cancun (anvil infers the hardfork from the block it forks, and runs its own default
 * from a file): dev account 0 has sent two transactions, so its nonce is 2 and the pinned block used
 * gas. Returns the state file, where it is pinned, and the recording node as `nodeOf` saw it.
 */
async function recordNode(dir: string) {
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
  try {
    const [sender] = (await rpc(upstream.url, "eth_accounts")) as string[];
    // Pinned at the block the second transaction was mined in, read from its receipt: anvil answers
    // `eth_sendTransaction` before its automine has mined it, so "latest" read at once may not hold
    // it yet, and the fork would see account 0's nonce at 1.
    const mined: string[] = [];
    for (const value of ["0x1", "0x2"]) {
      const hash = await rpc(upstream.url, "eth_sendTransaction", [
        { from: sender, to: sender, value },
      ]);
      mined.push(await minedIn(upstream.url, hash));
    }
    const pinned = (await rpc(upstream.url, "eth_getBlockByNumber", [mined.at(-1), false])) as {
      number: string;
      baseFeePerGas: string;
    };
    const at = { chainId: 1, block: Number(pinned.number), blockInterval: 12 } as const;
    const state = join(dir, "node.json.gz");
    const recording = await startForkNode({ ...at, mode: "record", rpcUrl: upstream.url, state });
    const recorded = await nodeOf(recording.url);
    await recording.stop();

    return { state, at, recorded, sender: sender!, pinnedBaseFee: BigInt(pinned.baseFeePerGas) };
  } finally {
    await upstream.stop();
  }
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
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-node-"));
    try {
      const { state, at, recorded, sender } = await recordNode(dir);
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replays a version 1 file at its gas limit alone, as its header says", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-v1-"));
    try {
      const { state, at, recorded, pinnedBaseFee } = await recordNode(dir);
      // The same recording as a kit before version 2 wrote it: nothing of the node in its header.
      const file = JSON.parse(gunzipSync(readFileSync(state)).toString()) as {
        sauce: Record<string, unknown>;
      };
      const { chainId, block, timestamp, blockInterval } = file.sauce;
      file.sauce = { version: 1, chainId, block, timestamp, blockInterval };
      writeFileSync(state, gzipSync(JSON.stringify(file)));

      const replay = await startForkNode({ ...at, mode: "replay", state });
      try {
        const replayed = await nodeOf(replay.url);
        // The gas limit its genesis records, and nothing else of the recorded node: anvil's own
        // hardfork, the pinned block's base fee carried forward, every dev account at nonce 0.
        assert.equal(replayed.gasLimit, recorded.gasLimit);
        assert.notEqual(replayed.hardFork, recorded.hardFork);
        assert.equal(replayed.baseFee, pinnedBaseFee);
        assert.notEqual(replayed.baseFee, recorded.baseFee);
        assert.deepEqual(
          replayed.nonces,
          recorded.nonces.map(([account]) => [account, 0]),
        );
      } finally {
        await replay.stop();
      }
    } finally {
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
      // The proxy speaks HTTP; the refusal does not repeat the URL.
      for (const [url, options, said] of [
        ["wss://ws.example/v2/secret-key", {}, /^a live fork needs an http\(s\) endpoint/],
        [
          "ws://127.0.0.1:9/secret-key",
          { state: missing },
          /^recording needs an http\(s\) endpoint/,
        ],
        // anvil's `--fork-url` took an IPC path, and a URL `new URL` cannot parse fails here,
        // before any process starts, rather than in the proxy.
        ["/tmp/secret-key/anvil.ipc", {}, /^a live fork needs an http\(s\) endpoint/],
        ["https://u:secret@localhost:99999/", {}, /^a live fork needs an http\(s\) endpoint/],
      ] as const) {
        await assert.rejects(
          fork("base", { block, rpcUrl: url, ...options }),
          (error: unknown) =>
            error instanceof Error && said.test(error.message) && !error.message.includes("secret"),
        );
      }
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

  it("keeps a live fork's endpoint off every command line", async () => {
    const upstream = await local();
    // A key in the URL, as hosted endpoints carry one, in its query and as a password: anvil
    // ignores both, and Node's fetch takes the password only as a header.
    const key = `sauce-key-${process.pid}-${Date.now()}`;
    const rpcUrl = new URL(`${upstream.rpcUrl}/?key=${key}`);
    rpcUrl.username = "sauce";
    rpcUrl.password = `${key}-password`;
    const before = new Set(children().map(({ pid }) => pid));
    try {
      const block = Number(await upstream.client.getBlockNumber());
      const live = await fork("base", { block, rpcUrl: rpcUrl.href });
      try {
        const started = children().filter(({ pid }) => !before.has(pid));
        assert.ok(
          started.some(({ command }) => command.includes("anvil")),
          "no anvil started",
        );
        const everyone = execFileSync("ps", ["-A", "-o", "command="], { encoding: "utf8" });
        assert.equal(everyone.includes(key), false, "the endpoint's key is in the process list");
        assert.equal((await live.run(program("multiply"), { args: [6n, 7n, 100n] })).returned, 42n);
      } finally {
        await live.stop();
      }
      for (const { pid } of children().filter(({ pid }) => !before.has(pid))) {
        assert.ok(await gone(pid), `pid ${pid} still runs`);
      }
    } finally {
      await upstream.stop();
    }
  });

  it("reaches the endpoint through HTTP_PROXY, as anvil did, and keeps its own hop direct", async () => {
    const upstream = await local();
    // A forward proxy, as a corporate network runs one: it tunnels what it is asked to (CONNECT),
    // and refuses a plain proxied request, which is what anvil would send it for the kit's hop.
    const tunnelled: string[] = [];
    const refused: string[] = [];
    const proxy = createServer((request, response) => {
      refused.push(request.url ?? "");
      response.writeHead(502);
      response.end();
    });
    proxy.on("connect", (request, client: Socket, head: Buffer) => {
      tunnelled.push(request.url ?? "");
      const { hostname, port } = new URL(`http://${request.url}`);
      const target = connect(Number(port), hostname, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        target.write(head);
        target.pipe(client);
        client.pipe(target);
      });
      target.on("error", () => client.destroy());
      client.on("error", () => target.destroy());
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const names = ["HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"] as const;
    const saved = new Map(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    process.env.HTTP_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    try {
      const block = Number(await upstream.client.getBlockNumber());
      const live = await fork("base", { block, rpcUrl: upstream.rpcUrl });
      try {
        assert.equal((await live.run(program("multiply"), { args: [6n, 7n, 100n] })).returned, 42n);
      } finally {
        await live.stop();
      }
      assert.ok(tunnelled.length > 0, "the endpoint was not reached through the proxy");
      assert.deepEqual(new Set(tunnelled), new Set([new URL(upstream.rpcUrl).host]));
      assert.deepEqual(refused, [], "anvil sent the kit's loopback hop to the proxy");
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      proxy.closeAllConnections();
      proxy.close();
      await upstream.stop();
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

  it("never quotes the Basic header an endpoint echoes in a recording's error", async () => {
    const upstream = await local();
    // An endpoint in front of the chain that, asked about one account, answers with the
    // Authorization header it was sent, as text: `Basic YTpi` for `a:b`.
    const echo = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", async () => {
        if (body.includes("f1".padStart(40, "0")))
          return response.end(request.headers.authorization);
        const answer = await fetch(upstream.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        response.writeHead(answer.status, { "content-type": "application/json" });
        response.end(await answer.text());
      });
    });
    echo.listen(0, "127.0.0.1");
    await once(echo, "listening");
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-echo-"));
    const state = join(dir, "echo.json.gz");
    try {
      const block = Number(await upstream.client.getBlockNumber());
      const rpcUrl = `http://a:b@127.0.0.1:${(echo.address() as AddressInfo).port}/`;
      const recording = await fork("base", { block, state, rpcUrl });
      await recording.client
        .getBalance({ address: `0x${"f1".padStart(40, "0")}` })
        .catch(() => undefined);
      await assert.rejects(
        recording.stop(),
        (error: unknown) =>
          error instanceof Error &&
          // anvil retries the read, and each answer is refused alike.
          /^recording failed: the endpoint's answer is not JSON(; the endpoint's answer is not JSON)*$/.test(
            error.message,
          ) &&
          !error.message.includes("YTpi") &&
          !error.message.includes("Basic"),
      );
      assert.equal(existsSync(state), false);
    } finally {
      echo.closeAllConnections();
      echo.close();
      await upstream.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("quotes no key, and leaves no proxy, when a live fork's anvil exits at start", async () => {
    // An anvil that dies at once, saying what it was given.
    const fake = fakeAnvil(`console.error(process.argv.slice(2).join(" ")); process.exit(3);`);
    const before = new Set(children().map(({ pid }) => pid));
    try {
      await assert.rejects(
        fork("base", {
          block: 1,
          mode: "live",
          rpcUrl: "http://alice:sauce-key@127.0.0.1:9/v2/sauce-key?k=sauce-key",
          anvil: fake.path,
        }),
        (error: unknown) =>
          error instanceof Error &&
          /^anvil exited with code 3: .*--fork-url http:\/\/127\.0\.0\.1:\d+ /.test(
            error.message,
          ) &&
          !error.message.includes("sauce-key"),
      );
      for (const { pid } of children().filter(({ pid }) => !before.has(pid))) {
        assert.ok(await gone(pid), `pid ${pid} still runs`);
      }
    } finally {
      for (const { pid } of children().filter(({ pid }) => !before.has(pid))) {
        process.kill(pid, "SIGKILL");
      }
      rmSync(fake.dir, { recursive: true, force: true });
    }
  });

  it("stops a live fork's node and its proxy when the node fails it once started", async () => {
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
    const before = new Set(children().map(({ pid }) => pid));
    try {
      await assert.rejects(
        fork("base", { block: 1, mode: "live", rpcUrl: "http://127.0.0.1:9", anvil: fake.path }),
        /this node fails/,
      );
      for (const { pid } of children().filter(({ pid }) => !before.has(pid))) {
        assert.ok(await gone(pid), `pid ${pid} still runs`);
      }
    } finally {
      for (const { pid } of children().filter(({ pid }) => !before.has(pid))) {
        process.kill(pid, "SIGKILL");
      }
      rmSync(fake.dir, { recursive: true, force: true });
    }
  });
});

describe("the recorder", () => {
  const RECORDER_SCRIPT = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../src/testing/recorder.mjs",
  );

  it("sends an endpoint's credentials as a Basic header, and the URL without them", async () => {
    const seen: { url?: string; authorization?: string } = {};
    const endpoint = createServer((request, response) => {
      seen.url = request.url;
      seen.authorization = request.headers.authorization;
      request.resume();
      request.on("end", () => response.end('{"jsonrpc":"2.0","id":1,"result":"0x2105"}'));
    });
    endpoint.listen(0, "127.0.0.1");
    await once(endpoint, "listening");
    const recorder = spawn(
      process.execPath,
      [resolve(dirname(fileURLToPath(import.meta.url)), "../../src/testing/recorder.mjs")],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    try {
      const port = (endpoint.address() as AddressInfo).port;
      // Forwarding only: no `out`, as a live fork starts it.
      const upstream = `http://alice:p%40ss%20word@127.0.0.1:${port}/v2/path?x=1`;
      recorder.stdin!.end(JSON.stringify({ upstream }));
      const [listening] = (await once(recorder.stdout!, "data")) as [Buffer];
      const response = await fetch(`http://127.0.0.1:${Number(listening.toString().trim())}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { jsonrpc: "2.0", id: 1, result: "0x2105" });
      assert.equal(seen.url, "/v2/path?x=1");
      assert.equal(
        seen.authorization,
        `Basic ${Buffer.from("alice:p@ss word").toString("base64")}`,
      );

      const exited = once(recorder, "exit");
      recorder.kill("SIGTERM");
      assert.deepEqual(await exited, [0, null]);
    } finally {
      if (recorder.exitCode === null && recorder.signalCode === null) recorder.kill("SIGKILL");
      endpoint.closeAllConnections();
      endpoint.close();
    }
  });

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

  it("refuses a configuration it cannot parse with a fixed message, quoting nothing of it", () => {
    // Both pass a `^https?://` check and fail `new URL`, whose error carries the URL it refused.
    for (const upstream of ["https://u:s3cret@localhost:99999/", "http://u:s3cret@[::1"]) {
      const refused = spawnSync(process.execPath, [RECORDER_SCRIPT], {
        input: JSON.stringify({ upstream }),
        encoding: "utf8",
        timeout: 15_000,
      });
      assert.equal(refused.status, 1);
      assert.equal(refused.stderr, "recorder: invalid configuration\n");
      assert.equal(refused.stderr.includes("s3cret"), false);
      assert.equal(refused.stderr.includes(upstream), false);
      assert.equal(refused.stdout, "");
    }
  });

  it("never quotes the Basic header an endpoint echoes, in its errors or on stderr", async () => {
    // An endpoint that answers every request with the Authorization it was sent, as text.
    const endpoint = createServer((request, response) => {
      request.resume();
      request.on("end", () => response.end(request.headers.authorization));
    });
    endpoint.listen(0, "127.0.0.1");
    await once(endpoint, "listening");
    const dir = mkdtempSync(join(tmpdir(), "sauce-testing-echo-"));
    const out = join(dir, "recorded.json");
    const recorder = spawn(process.execPath, [RECORDER_SCRIPT], { stdio: "pipe" });
    let stderr = "";
    recorder.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    try {
      // `a:b` is `YTpi`: short, so a SyntaxError for the answer would quote the whole header.
      const upstream = `http://a:b@127.0.0.1:${(endpoint.address() as AddressInfo).port}/`;
      recorder.stdin!.end(JSON.stringify({ upstream, block: "0x1", out }));
      const [listening] = (await once(recorder.stdout!, "data", {
        signal: AbortSignal.timeout(10_000),
      })) as [Buffer];
      await fetch(`http://127.0.0.1:${Number(listening.toString().trim())}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
        signal: AbortSignal.timeout(15_000),
      });
      const exited = once(recorder, "exit");
      recorder.kill("SIGTERM");
      await exited;
      const written = readFileSync(out, "utf8");
      const { errors } = JSON.parse(written) as { errors: string[] };
      assert.deepEqual(errors, ["the endpoint's answer is not JSON"]);
      for (const said of [written, stderr]) {
        assert.equal(said.includes("YTpi"), false);
        assert.equal(said.includes("Basic"), false);
      }
    } finally {
      if (recorder.exitCode === null && recorder.signalCode === null) recorder.kill("SIGKILL");
      endpoint.closeAllConnections();
      endpoint.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("relays a live fork's request once, takes a bare % as anvil does, and names the cause", async () => {
    const seen: (string | undefined)[] = [];
    // An endpoint under load: a recording retries it, a live fork leaves that to anvil.
    const busy = createServer((request, response) => {
      seen.push(request.headers.authorization);
      request.resume();
      request.on("end", () => {
        response.writeHead(503);
        response.end("busy");
      });
    });
    busy.listen(0, "127.0.0.1");
    await once(busy, "listening");
    const started: ChildProcess[] = [];
    /** A forwarding-only recorder in front of `upstream`, its stderr collected, and a POST to it. */
    const live = async (upstream: string) => {
      const recorder = spawn(process.execPath, [RECORDER_SCRIPT], { stdio: "pipe" });
      started.push(recorder);
      const said = { stderr: "" };
      recorder.stderr!.on("data", (chunk: Buffer) => (said.stderr += chunk.toString()));
      recorder.stdin!.end(JSON.stringify({ upstream }));
      const [listening] = (await once(recorder.stdout!, "data", {
        signal: AbortSignal.timeout(10_000),
      })) as [Buffer];
      const post = () =>
        fetch(`http://127.0.0.1:${Number(listening.toString().trim())}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
          signal: AbortSignal.timeout(15_000),
        });
      return { recorder, said, post };
    };
    try {
      // A `%` that starts no escape stays, as anvil's own parser leaves it.
      const throttled = await live(
        `http://alice:100%zz@127.0.0.1:${(busy.address() as AddressInfo).port}/`,
      );
      const response = await throttled.post();
      assert.equal(response.status, 503);
      assert.equal(await response.text(), "busy");
      assert.deepEqual(seen, [`Basic ${Buffer.from("alice:100%zz").toString("base64")}`]);

      // Nothing listens there any more: the cause is named, the credentials are not. (A credential
      // short enough to appear in the message, as `a:b` would, replaces it whole. Not port 9, which
      // fetch refuses outright, with no cause.)
      const closedServer = createServer();
      closedServer.listen(0, "127.0.0.1");
      await once(closedServer, "listening");
      const { port } = closedServer.address() as AddressInfo;
      closedServer.close();
      await once(closedServer, "close");
      const unreachable = await live(`http://alice:sauce-key@127.0.0.1:${port}/`);
      assert.equal((await unreachable.post()).status, 502);
      // Its stderr is a pipe, written asynchronously: read once it has closed.
      const closed = once(unreachable.recorder, "close");
      unreachable.recorder.kill("SIGTERM");
      await closed;
      assert.equal(unreachable.said.stderr, "recorder: fetch failed (ECONNREFUSED)\n");
    } finally {
      for (const recorder of started) recorder.kill("SIGKILL");
      busy.closeAllConnections();
      busy.close();
    }
  });

  it("stays up when a client hangs up mid-body", async () => {
    const endpoint = createServer((request, response) => {
      request.resume();
      request.on("end", () => response.end('{"jsonrpc":"2.0","id":1,"result":"0x2105"}'));
    });
    endpoint.listen(0, "127.0.0.1");
    await once(endpoint, "listening");
    const recorder = spawn(process.execPath, [RECORDER_SCRIPT], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    try {
      const upstream = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}/`;
      recorder.stdin!.end(JSON.stringify({ upstream }));
      const [listening] = (await once(recorder.stdout!, "data", {
        signal: AbortSignal.timeout(10_000),
      })) as [Buffer];
      const port = Number(listening.toString().trim());
      // Half a request, then gone. The proxy is another process with nothing to observe, so the waits
      // are real: one for it to read the headers and start on the body, one for it to see the hang-up
      // (and, before the fix, to die of it).
      const socket = connect(port, "127.0.0.1");
      await once(socket, "connect");
      socket.write(
        "POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n" +
          'Content-Length: 100\r\n\r\n{"jsonrpc"',
      );
      await delay(100);
      socket.destroy();
      await delay(500);
      assert.equal(recorder.exitCode, null, "the proxy exited");
      const response = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200);
    } finally {
      if (recorder.exitCode === null && recorder.signalCode === null) recorder.kill("SIGKILL");
      endpoint.closeAllConnections();
      endpoint.close();
    }
  });

  it("exits when the process that started it is killed", async () => {
    // A parent that starts the recorder, says its pid, and is then killed outright.
    const parent = spawn(
      process.execPath,
      [
        "-e",
        `const child = require("node:child_process").spawn(process.execPath, [${JSON.stringify(RECORDER_SCRIPT)}], { stdio: ["pipe", "pipe", "inherit"] });
        child.stdin.end(JSON.stringify({ upstream: "http://127.0.0.1:9" }));
        child.stdout.once("data", () => console.log(child.pid));`,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const [said] = (await once(parent.stdout!, "data", {
      signal: AbortSignal.timeout(10_000),
    })) as [Buffer];
    const pid = Number(said.toString().trim());
    try {
      parent.kill("SIGKILL");
      assert.ok(await gone(pid), `the recorder (pid ${pid}) outlived its parent`);
    } finally {
      if (!(await gone(pid, 0))) process.kill(pid, "SIGKILL");
    }
  });
});
