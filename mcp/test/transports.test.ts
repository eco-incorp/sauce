/**
 * The two transports, end to end: the `sauce-mcp` bin over stdio as an agent launches it, and over
 * Streamable HTTP — the bin on a port it picks, and the HTTP server in process for what it refuses
 * (another Host or Origin, a body past the bound, anything but a POST to /mcp).
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { NO_ENDPOINTS } from "../src/config.js";
import { endpointUrl, serveHttp } from "../src/http.js";
import { createSauceServer } from "../src/server.js";
import { TOOL_NAMES } from "../src/tools.js";

const MCP = dirname(dirname(fileURLToPath(import.meta.url)));
/** The bin, from source: node with tsx's loader, resolved here so any working directory works. */
const BIN = [
  process.execPath,
  "--import",
  import.meta.resolve("tsx"),
  join(MCP, "src/main.ts"),
] as const;
const SECRET = "stdio-provider-key-1a2b3c";
const PROGRAM = "function main(): Uint256 {\n  return chainId;\n}\n";

const structured = (result: unknown) => (result as CallToolResult).structuredContent!;

async function exercise(client: Client): Promise<void> {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [...TOOL_NAMES],
  );
  const compiled = structured(
    await client.callTool({ name: "sauce_compile", arguments: { source: PROGRAM, chain: "base" } }),
  );
  assert.match(compiled.bytecode as string, /^0x[0-9a-f]+$/);
  const { resources } = await client.listResources();
  assert.ok(resources.some((resource) => resource.uri === "sauce://skills/index"));
}

describe("stdio: the bin as an agent launches it", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "sauce-mcp-stdio-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("serves the tools, resources and prompts, reading chains only from --config", async () => {
    const config = join(dir, "sauce.config.json");
    writeFileSync(config, JSON.stringify({ rpcUrls: { "8453": `http://127.0.0.1:9/${SECRET}` } }));
    const transport = new StdioClientTransport({
      command: BIN[0],
      args: [...BIN.slice(1), "--config", config],
      cwd: dir,
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const client = new Client({ name: "stdio-smoke", version: "0.0.0" });
    await client.connect(transport);
    try {
      await exercise(client);
      const { chains } = structured(await client.callTool({ name: "sauce_chains" })) as {
        chains: Array<{ slug: string; endpoint: boolean }>;
      };
      assert.deepEqual(
        chains.filter((chain) => chain.endpoint).map((chain) => chain.slug),
        ["base"],
      );
      const failed = (await client.callTool({
        name: "sauce_pot",
        arguments: { chain: "base", owner: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" },
      })) as CallToolResult;
      assert.equal(failed.isError, true, "the endpoint refuses the connection");
      assert.ok(!JSON.stringify(failed).includes(SECRET), "and the failure does not name it");
    } finally {
      await client.close();
    }
    assert.ok(!stderr.includes(SECRET), "nor does anything the server logged");
  });

  it("refuses a config it cannot use before it serves anything, naming no URL", async () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ rpcUrls: { base: `http://${SECRET}` } }));
    const child = spawn(BIN[0], [...BIN.slice(1), "--config", bad], { stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const [code] = (await once(child, "exit")) as [number];
    assert.equal(code, 2);
    assert.match(stderr, /rpcUrls key 'base' is not a chain id/);
    assert.ok(!stderr.includes(SECRET));
  });
});

/** A raw HTTP request, with whatever Host and Origin a test wants to send. */
function raw(
  port: number,
  options: { method?: string; path?: string; host?: string; origin?: string; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "POST",
        path: options.path ?? "/mcp",
        headers: {
          host: options.host ?? `127.0.0.1:${port}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(options.origin === undefined ? {} : { origin: options.origin }),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body ?? "");
  });
}

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "raw", version: "0" },
  },
});

describe("Streamable HTTP, in process", () => {
  let http: Server;
  let port: number;
  before(async () => {
    http = await serveHttp({
      port: 0,
      host: "127.0.0.1",
      allowedHosts: ["sauce.example"],
      maxBody: 64 * 1024,
      server: () => createSauceServer({ endpoints: NO_ENDPOINTS }),
    });
    port = (http.address() as { port: number }).port;
  });
  after(() => new Promise<void>((resolve) => http.close(() => resolve())));

  it("answers a client statelessly, every request on its own", async () => {
    const client = new Client({ name: "http-smoke", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(endpointUrl(http, "127.0.0.1")));
    await client.connect(transport);
    try {
      assert.equal(transport.sessionId, undefined, "no session is kept");
      await exercise(client);
    } finally {
      await client.close();
    }
  });

  it("answers JSON-RPC as JSON, for a loopback Host or one it was told to allow", async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "sauce.example"]) {
      const answer = await raw(port, { host, body: INITIALIZE });
      assert.equal(answer.status, 200, host);
      assert.equal(
        (JSON.parse(answer.body) as { result: { serverInfo: { name: string } } }).result.serverInfo
          .name,
        "sauce",
      );
    }
  });

  it("refuses another Host or Origin: what a DNS-rebinding page would send", async () => {
    assert.equal((await raw(port, { host: "evil.example", body: INITIALIZE })).status, 403);
    assert.equal(
      (await raw(port, { origin: "https://evil.example", body: INITIALIZE })).status,
      403,
    );
    assert.equal(
      (await raw(port, { origin: `http://localhost:${port}`, body: INITIALIZE })).status,
      200,
    );
  });

  it("refuses a body past the bound, and anything but a POST to /mcp", async () => {
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "sauce_compile", arguments: { source: "x".repeat(70 * 1024) } },
    });
    assert.equal((await raw(port, { body: big })).status, 413);
    assert.equal((await raw(port, { method: "GET" })).status, 405);
    assert.equal((await raw(port, { method: "DELETE" })).status, 405);
    assert.equal((await raw(port, { path: "/" })).status, 404);
  });
});

describe("Streamable HTTP: the bin with --http", () => {
  let child: ChildProcess;
  let url: string;
  before(async () => {
    child = spawn(BIN[0], [...BIN.slice(1), "--http", "0"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    url = await new Promise<string>((resolve, reject) => {
      child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        const at = /Streamable HTTP at (http:\/\/\S+)/.exec(stderr);
        if (at !== null) resolve(at[1]!);
      });
      child.once("exit", (code) => reject(new Error(`sauce-mcp exited ${code}: ${stderr}`)));
    });
  });
  after(async () => {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  });

  it("binds loopback by default and serves the same tools", async () => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const client = new Client({ name: "http-bin-smoke", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    try {
      await exercise(client);
    } finally {
      await client.close();
    }
  });
});
