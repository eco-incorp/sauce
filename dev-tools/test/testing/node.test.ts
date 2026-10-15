/**
 * The kit's anvil (`node.ts`): started on a port nothing answers on, and handed back only once its
 * own anvil answers there. A port that already answers is refused, naming what holds it, so a chain
 * is never one a crashed run left behind, or anything else that speaks JSON-RPC.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { local } from "../../src/testing/index.js";
import { freePort, rpc, startAnvil, type AnvilProcess } from "../../src/testing/node.js";
import { anvilMissing, fakeAnvil, gone } from "./support.js";

const NODE_MODULE = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/testing/node.ts");

/** Where the refusal names the holder by its pid: netstat on macOS, ss on Linux, lsof elsewhere. */
const NAMES = process.platform === "darwin" || process.platform === "linux";

/** `startAnvil` must refuse: a node it hands back instead is stopped, and the test fails. */
async function refused(start: Promise<AnvilProcess>, port: number, holder?: string) {
  await assert.rejects(
    start.then(async (node) => {
      await node.stop();
      return node;
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes(`port ${port} already answers, held by`) &&
      (!NAMES || holder === undefined || error.message.includes(`held by ${holder}`)),
  );
}

describe("startAnvil", { skip: anvilMissing() }, () => {
  it("starts anvil on a free port, answering once it does", async () => {
    const node = await startAnvil(["--chain-id", "8453"]);
    try {
      assert.equal(await rpc(node.url, "eth_chainId"), "0x2105");
    } finally {
      await node.stop();
    }
  });

  it("refuses a port anything answering JSON-RPC holds, rather than handing it back", async () => {
    // An impostor: answers every request as a chain would.
    const impostor = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.setHeader("content-type", "application/json");
        response.end('{"jsonrpc":"2.0","id":1,"result":"0x2105"}');
      });
    });
    impostor.listen(0, "127.0.0.1");
    await once(impostor, "listening");
    const { port } = impostor.address() as AddressInfo;
    try {
      await refused(startAnvil(["--chain-id", "8453"], { port }), port, `pid ${process.pid} `);
    } finally {
      impostor.closeAllConnections();
      impostor.close();
      await once(impostor, "close");
    }
  });

  it("refuses a port an anvil left running holds, naming it, and leaves it be", async () => {
    const port = await freePort();
    const left = await startAnvil(["--chain-id", "1"], { port });
    try {
      await refused(
        startAnvil(["--chain-id", "8453"], { port }),
        port,
        `pid ${left.process.pid} (anvil)`,
      );
      // The anvil already there is the one still answering, as it was.
      assert.equal(await rpc(left.url, "eth_chainId"), "0x1");
    } finally {
      await left.stop();
    }
  });

  it("refuses a port another process took while its anvil runs, and stops its anvil", async () => {
    // An anvil that loses the race for its port: another process binds it first and answers as a
    // chain would, while this anvil keeps running.
    const fake = fakeAnvil(`
      const { spawn } = require("node:child_process");
      const answer = 'require("node:http").createServer((q, s) => { q.resume(); q.on("end", () => ' +
        's.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2105" }))); }).listen(' + port +
        ', "127.0.0.1")';
      const impostor = spawn(process.execPath, ["-e", answer], { stdio: "ignore" });
      require("node:fs").writeFileSync(
        __dirname + "/pids",
        JSON.stringify({ anvil: process.pid, impostor: impostor.pid }),
      );
      process.on("SIGTERM", () => {
        impostor.kill();
        process.exit(0);
      });
      setInterval(() => {}, 1 << 30);
    `);
    try {
      const start = startAnvil(["--chain-id", "8453"], { binary: fake.path });
      await assert.rejects(
        start.then(async (node) => {
          await node.stop();
          return node;
        }),
        (error: unknown) => {
          const { anvil, impostor } = JSON.parse(readFileSync(join(fake.dir, "pids"), "utf8"));
          return (
            error instanceof Error &&
            new RegExp(
              `answers, but pid ${impostor} \\(.+\\) holds it, not this anvil \\(pid ${anvil}\\)`,
            ).test(error.message)
          );
        },
      );
      const { anvil, impostor } = JSON.parse(readFileSync(join(fake.dir, "pids"), "utf8"));
      assert.ok(await gone(anvil), "its anvil was stopped");
      assert.ok(await gone(impostor));
    } finally {
      rmSync(fake.dir, { recursive: true, force: true });
    }
  });

  it("stops its anvil when the process that started it ends", async () => {
    const dir = fakeAnvil("").dir;
    const script = join(dir, "start.mts");
    writeFileSync(
      script,
      `import { startAnvil } from ${JSON.stringify(pathToFileURL(NODE_MODULE).href)};\n` +
        `const node = await startAnvil(["--chain-id", "8453"]);\n` +
        `console.log(node.process.pid);\n` +
        `if (process.argv[2] === "exit") process.exit(0);\n` +
        `setInterval(() => {}, 1 << 30);\n`,
    );
    try {
      for (const ending of ["exit", "SIGTERM", "SIGINT", "SIGHUP"] as const) {
        const host = spawn(process.execPath, ["--import", "tsx", script, ending], {
          cwd: resolve(dirname(NODE_MODULE), "../.."),
          stdio: ["ignore", "pipe", "inherit"],
        });
        const [line] = (await once(host.stdout!, "data")) as [Buffer];
        const anvil = Number(line.toString().trim());
        assert.ok(anvil > 0);
        const ended = once(host, "exit");
        if (ending !== "exit") host.kill(ending);
        const [code, signal] = await ended;
        // Ended as the signal ends a process, or by its own exit.
        assert.deepEqual([code, signal], ending === "exit" ? [0, null] : [null, ending]);
        const stopped = await gone(anvil);
        if (!stopped) process.kill(anvil, "SIGKILL");
        assert.ok(stopped, `${ending}: its anvil (pid ${anvil}) still runs`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails with anvil's reason when its anvil exits before it answers", async () => {
    await assert.rejects(
      startAnvil(["--chain-id", "not-a-number"]),
      /anvil exited with code \d+: .+/,
    );
  });
});

describe("an anvil that is not there", () => {
  it("is named, with where to get Foundry's, rather than a bare ENOENT", async () => {
    const missing = "/nonexistent/sauce-testing/anvil";
    const named = new RegExp(
      `${missing} was not found: the testing kit runs chains on Foundry's anvil`,
    );
    await assert.rejects(startAnvil([], { binary: missing }), named);
    // As `local()` and `fork()` take it.
    await assert.rejects(local({ anvil: missing }), named);
  });
});
