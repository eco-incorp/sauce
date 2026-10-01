/**
 * The guard a server served over HTTP reaches a caller's rpcUrl through: what it refuses to
 * reach (every address range that is not the public internet, any scheme but https), and that it
 * checks again at each connection (DNS rebinding), follows no redirect, gives up on a slow
 * endpoint and reads back no more than its bound. Every endpoint here is a local listener, and
 * names resolve through a stand-in resolver: nothing reaches a network.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { after, before, describe, it } from "node:test";

import { blockedAddress, checkRpcUrl, createRpcGuard, type Resolve } from "../src/guard.js";
import { connect, failed, type Connected } from "./harness.js";

const BLOCKED = [
  "127.0.0.1",
  "127.255.0.9",
  "10.1.2.3",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "100.64.0.1",
  "169.254.169.254",
  "169.254.170.2",
  "100.100.100.200",
  "0.0.0.0",
  "224.0.0.1",
  "255.255.255.255",
  "::1",
  "::",
  "fc00::1",
  "fd12:3456::1",
  "fd00:ec2::254",
  "fe80::1",
  "::ffff:10.0.0.1",
  "::ffff:127.0.0.1",
  "::ffff:a9fe:a9fe",
  "64:ff9b::a00:1",
];
const PUBLIC = ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111"];

/** A resolver that answers `answers` in turn, the last one for every call after. */
function resolving(...answers: string[][]): { resolve: Resolve; calls: () => number } {
  let calls = 0;

  return {
    resolve: async () => {
      const at = answers[Math.min(calls, answers.length - 1)]!;
      calls++;

      return at.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
    calls: () => calls,
  };
}

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return (server.address() as { port: number }).port;
}

const rpc = async (url: string, body = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}') => {
  const answer = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body,
  });

  return { status: answer.status, text: await answer.text() };
};

describe("the addresses the guard refuses", () => {
  it("refuses every range that is not the public internet, and passes public ones", () => {
    for (const address of BLOCKED) {
      assert.notEqual(blockedAddress(address, false), undefined, address);
    }
    for (const address of PUBLIC) assert.equal(blockedAddress(address, false), undefined, address);
  });

  it("with private endpoints allowed, still refuses link-local and metadata addresses", () => {
    for (const address of ["169.254.169.254", "fd00:ec2::254", "fe80::1", "100.100.100.200"]) {
      assert.notEqual(blockedAddress(address, true), undefined, address);
    }
    for (const address of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "fc00::1"]) {
      assert.equal(blockedAddress(address, true), undefined, address);
    }
  });
});

describe("checking a caller's URL", () => {
  const publicHost = resolving(["93.184.216.34"]).resolve;

  it("takes https only, unless private endpoints are allowed", async () => {
    await assert.rejects(
      checkRpcUrl("http://rpc.example/key", { allowPrivate: false, resolve: publicHost }),
      /must be an https URL/,
    );
    await assert.rejects(
      checkRpcUrl("ftp://rpc.example/", { allowPrivate: true, resolve: publicHost }),
      /must be an http\(s\) URL/,
    );
    await assert.rejects(checkRpcUrl("not a url", { allowPrivate: false }), /is not a URL/);
    assert.equal(
      (await checkRpcUrl("https://rpc.example/key", { allowPrivate: false, resolve: publicHost }))
        .hostname,
      "rpc.example",
    );
  });

  it("refuses an address literal or a name that resolves into a blocked range", async () => {
    for (const host of ["127.0.0.1", "[::1]", "10.0.0.8", "169.254.169.254", "[fd00:ec2::254]"]) {
      await assert.rejects(
        checkRpcUrl(`https://${host}/key`, { allowPrivate: false }),
        /resolves to an address that/,
        host,
      );
    }
    // Any one address of several is enough to refuse it.
    await assert.rejects(
      checkRpcUrl("https://mixed.example/", {
        allowPrivate: false,
        resolve: resolving(["93.184.216.34", "10.0.0.1"]).resolve,
      }),
      /resolves to an address that/,
    );
    await assert.rejects(
      checkRpcUrl("https://user:pass@rpc.example/", { allowPrivate: false, resolve: publicHost }),
      /user name or password/,
    );
  });

  it("names no part of the URL when it refuses one", async () => {
    const secret = "k3y-in-the-path-0123456789";
    for (const url of [`http://rpc.example/${secret}`, `https://10.0.0.1/${secret}`]) {
      await assert.rejects(checkRpcUrl(url, { allowPrivate: false }), (error: Error) => {
        assert.ok(!error.message.includes(secret));
        assert.ok(!error.message.includes("rpc.example"));

        return true;
      });
    }
  });
});

describe("the guard at each connection", () => {
  let upstream: Server;
  let port: number;
  let hits = 0;
  let behaviour: "ok" | "redirect" | "huge" | "hang" = "ok";
  before(async () => {
    upstream = createHttpServer((req, res) => {
      hits++;
      req.resume();
      if (behaviour === "redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      } else if (behaviour === "huge") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("x".repeat(64 * 1024));
      } else if (behaviour === "ok") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"jsonrpc":"2.0","id":1,"result":"0x1"}');
      }
      // "hang": never answer.
    });
    port = await listen(upstream);
  });
  after(() => {
    upstream.closeAllConnections();
    upstream.close();
  });

  it("refuses a name that resolved to a public address when checked and a private one when used", async () => {
    // Every connection to the listener is counted, TLS or not: the rebinding must reach none.
    const tcp = createTcpServer((socket) => {
      connections++;
      socket.destroy();
    });
    let connections = 0;
    const tcpPort = await listen(tcp as unknown as Server);
    const rebinding = resolving(["93.184.216.34"], ["127.0.0.1"]);
    const guard = createRpcGuard({ allowPrivate: false, resolve: rebinding.resolve });
    try {
      const routed = await guard.route(`https://rebind.example:${tcpPort}/key`);
      const answer = await rpc(routed.url);
      assert.equal(answer.status, 502);
      assert.match(answer.text, /resolves to an address this server does not reach/);
      assert.equal(rebinding.calls(), 2, "checked when routed, and again when connecting");
      assert.equal(connections, 0, "and never connected");
      routed.release();
    } finally {
      await guard.close();
      tcp.close();
    }
  });

  it("forwards to a reachable endpoint, follows no redirect, and bounds time and size", async () => {
    const guard = createRpcGuard({
      allowPrivate: true,
      timeoutMs: 300,
      maxResponse: 8 * 1024,
    });
    try {
      const routed = await guard.route(`http://127.0.0.1:${port}/key`);
      behaviour = "ok";
      assert.deepEqual(await rpc(routed.url), {
        status: 200,
        text: '{"jsonrpc":"2.0","id":1,"result":"0x1"}',
      });
      behaviour = "redirect";
      const redirected = await rpc(routed.url);
      assert.equal(redirected.status, 502);
      assert.match(redirected.text, /redirected, which this server does not follow/);
      behaviour = "huge";
      const huge = await rpc(routed.url);
      assert.equal(huge.status, 502);
      assert.match(huge.text, /too large/);
      behaviour = "hang";
      const slow = await rpc(routed.url);
      assert.equal(slow.status, 502);
      assert.match(slow.text, /did not answer in time/);
      // A released route is gone; an unknown one never existed.
      routed.release();
      assert.equal((await rpc(routed.url)).status, 404);
    } finally {
      behaviour = "ok";
      await guard.close();
    }
    assert.ok(hits >= 4);
  });
});

describe("a guarded server's tools", () => {
  let mcp: Connected;
  before(async () => {
    const { NO_ENDPOINTS } = await import("../src/config.js");
    mcp = await connect(NO_ENDPOINTS, createRpcGuard({ allowPrivate: false }));
  });
  after(async () => {
    await mcp.close();
  });

  it("refuses an rpcUrl that is not https, or that leads to a private address, naming neither", async () => {
    const secret = "guarded-key-0123456789abcdef";
    const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    for (const [rpcUrl, message] of [
      [`http://rpc.example/${secret}`, /must be an https URL/],
      [`https://127.0.0.1/${secret}`, /resolves to an address that is loopback/],
      [`https://169.254.169.254/${secret}`, /link-local or a cloud metadata address/],
      [`https://[::1]/${secret}`, /resolves to an address that is loopback/],
    ] as const) {
      assert.match(failed(await mcp.call("sauce_pot", { chain: "base", owner, rpcUrl })), message);
    }
    const everything = mcp.received.join("\n");
    assert.ok(!everything.includes(secret));
    assert.ok(!everything.includes("rpc.example"));
  });
});
