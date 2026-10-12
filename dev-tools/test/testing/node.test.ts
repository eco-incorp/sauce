/**
 * The kit's anvil (`node.ts`): started on a port nothing answers on, and handed back only once its
 * own anvil answers there. A port that already answers is refused, naming what holds it, so a chain
 * is never one a crashed run left behind, or anything else that speaks JSON-RPC.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";

import { freePort, rpc, startAnvil, type AnvilProcess } from "../../src/testing/node.js";
import { anvilMissing } from "./support.js";

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

  it("fails with anvil's reason when its anvil exits before it answers", async () => {
    await assert.rejects(
      startAnvil(["--chain-id", "not-a-number"]),
      /anvil exited with code \d+: .+/,
    );
  });
});
