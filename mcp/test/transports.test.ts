/**
 * The two transports, end to end: `sauce mcp` — the package's own command, built, as `npx
 * @eco-incorp/sauce mcp` runs it — over stdio as an agent launches it, and over Streamable HTTP on
 * a port it picks; and the HTTP server in process for what it refuses (another Host or Origin, a
 * body past the bound, anything but a POST to /mcp). The SDK and this workspace must be built.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { NO_ENDPOINTS } from "../src/config.js";
import { endpointUrl, serveHttp } from "../src/http.js";
import { createSauceServer } from "../src/server.js";
import { INTENT_TOOL_NAMES } from "../src/intents.js";
import { SKILL_TOOL_NAMES } from "../src/skilltools.js";
import { TOOL_NAMES } from "../src/tools.js";
import { WALLET_TOOL_NAMES } from "../src/wallets.js";

const MCP = dirname(dirname(fileURLToPath(import.meta.url)));
/** `sauce mcp`, from the build: the `sauce` bin, which loads this workspace's `dist/entry.js`. */
const BIN = [process.execPath, join(MCP, "../sdk/dist/cli/main.js"), "mcp"] as const;
const SECRET = "stdio-provider-key-1a2b3c";
const PROGRAM = "function main(): Uint256 {\n  return chainId;\n}\n";

const structured = (result: unknown) => (result as CallToolResult).structuredContent!;

async function exercise(client: Client): Promise<void> {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [...TOOL_NAMES, ...INTENT_TOOL_NAMES, ...SKILL_TOOL_NAMES],
  );
  const compiled = structured(
    await client.callTool({ name: "sauce_compile", arguments: { source: PROGRAM, chain: "base" } }),
  );
  assert.match(compiled.bytecode as string, /^0x[0-9a-f]+$/);
  const { resources } = await client.listResources();
  assert.ok(resources.some((resource) => resource.uri === "sauce://skills/index"));
}

describe("stdio: sauce mcp as an agent launches it", () => {
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
      // Over stdio a program is read from the user's own disk, relative to where it runs.
      writeFileSync(join(dir, "program.sauce.ts"), PROGRAM);
      const byPath = structured(
        await client.callTool({
          name: "sauce_compile",
          arguments: { path: "program.sauce.ts", chain: "base" },
        }),
      );
      const bySource = structured(
        await client.callTool({
          name: "sauce_compile",
          arguments: { source: PROGRAM, chain: "base" },
        }),
      );
      assert.equal(byPath.bytecode, bySource.bytecode);
      assert.equal(byPath.sourceSha256, bySource.sourceSha256);
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

  it("signs with the wallets of --wallets, unlocked by the password source it names", async () => {
    // A throwaway password, passed as an MCP client's config passes one from an agent's .env.
    const password = `throwaway-${process.pid}-${Date.now()}`;
    const wallets = join(dir, "wallets");
    const transport = new StdioClientTransport({
      command: BIN[0],
      args: [
        ...BIN.slice(1),
        ...["--wallets", wallets, "--password-env", "SAUCE_TEST_WALLET_PASSWORD"],
      ],
      env: { ...getDefaultEnvironment(), SAUCE_TEST_WALLET_PASSWORD: password },
      cwd: dir,
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const client = new Client({ name: "stdio-wallets", version: "0.0.0" });
    await client.connect(transport);
    const received: string[] = [client.getInstructions() ?? ""];
    try {
      const { tools } = await client.listTools();
      assert.deepEqual(
        tools.map((tool) => tool.name),
        [...TOOL_NAMES, ...INTENT_TOOL_NAMES, ...WALLET_TOOL_NAMES, ...SKILL_TOOL_NAMES],
      );
      assert.match(received[0]!, /THIS SERVER SIGNS ONLY WITH THE WALLETS IN ITS WALLET DIRECTORY/);
      assert.match(received[0]!, /--password-env SAUCE_TEST_WALLET_PASSWORD/);
      const created = await client.callTool({
        name: "sauce_wallet_create",
        arguments: { name: "agent" },
      });
      received.push(JSON.stringify(created));
      const { address } = structured(created) as { address: string };
      assert.match(address, /^0x[0-9a-fA-F]{40}$/);
      const listed = await client.callTool({ name: "sauce_wallet_list" });
      received.push(JSON.stringify(listed));
      assert.deepEqual(
        (structured(listed) as { wallets: Array<{ address: string }> }).wallets.map(
          (wallet) => wallet.address,
        ),
        [address],
      );
    } finally {
      await client.close();
    }
    assert.match(stderr, /signing with the wallets in /);
    assert.equal(statSync(join(wallets, "agent.json")).mode & 0o777, 0o600);
    for (const text of [...received, stderr]) assert.ok(!text.includes(password));
  });

  it("refuses a config it cannot use before it serves anything, naming no URL", async () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ rpcUrls: { base: `http://${SECRET}` } }));
    const child = spawn(BIN[0], [...BIN.slice(1), "--config", bad], { stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const [code] = (await once(child, "exit")) as [number];
    assert.equal(code, 2);
    assert.match(stderr, /^sauce mcp: --config \S+: rpcUrls key 'base' is not a chain id/);
    assert.ok(!stderr.includes(SECRET));
  });

  it("prints its help from the CLI, loading nothing, and refuses a flag of another mode", async () => {
    const help = spawn(BIN[0], [...BIN.slice(1), "--help"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    help.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    assert.deepEqual(await once(help, "exit"), [0, null]);
    assert.match(stdout, /^Serve the commands and the agent skills/);
    assert.match(stdout, /--allowed-host <name>/);
    assert.match(stdout, /--wallets \[<dir>\]/);
    for (const [argv, message] of [
      [["--agent", "claude"], /--agent goes with sauce mcp setup/],
      [["setup", "--http", "0"], /--http is for serving, not setup/],
      [["--host", "127.0.0.1"], /--host goes with --http/],
      [["--http", "0", "--host", "0.0.0.0"], /beyond loopback: name the host/],
      // The HTTP server never signs: it takes no wallets, whatever the password source.
      [
        ["--http", "0", "--wallets", "--password-env", "SAUCE_TEST_WALLET_PASSWORD"],
        /--wallets is for stdio: the HTTP server never signs/,
      ],
      [["--password-env", "SAUCE_TEST_WALLET_PASSWORD"], /--password-env goes with --wallets/],
      [["--wallets"], /--wallets needs its password source/],
      [["setup", "--wallets"], /--wallets is for serving, not setup/],
    ] as const) {
      const child = spawn(BIN[0], [...BIN.slice(1), ...argv], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      const [code] = (await once(child, "exit")) as [number];
      assert.equal(code, 2, argv.join(" "));
      assert.match(stderr, message);
    }
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
      // Named with a port, as an operator might: the hostname is what is compared.
      allowedHosts: ["sauce.example:443"],
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

  it("answers any Host only when told to with *, for a proxy that checks it", async () => {
    const open = await serveHttp({
      port: 0,
      host: "127.0.0.1",
      allowedHosts: ["*"],
      maxBody: 64 * 1024,
      server: () => createSauceServer({ endpoints: NO_ENDPOINTS }),
    });
    try {
      const at = (open.address() as { port: number }).port;
      assert.equal((await raw(at, { host: "anything.example", body: INITIALIZE })).status, 200);
    } finally {
      await new Promise<void>((resolve) => open.close(() => resolve()));
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

describe("Streamable HTTP: sauce mcp --http", () => {
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
      child.once("exit", (code) => reject(new Error(`sauce mcp exited ${code}: ${stderr}`)));
    });
  });
  after(async () => {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  });

  it("binds loopback by default and serves the same tools, and no wallet tool", async () => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const client = new Client({ name: "http-bin-smoke", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    try {
      await exercise(client);
      const { tools } = await client.listTools();
      assert.ok(tools.every((tool) => !tool.name.startsWith("sauce_wallet")));
      assert.match(client.getInstructions() ?? "", /NOTHING HERE SIGNS OR SENDS/);
      // Over HTTP no file is read: path is no input, and a call that gives one is refused.
      const compile = tools.find((tool) => tool.name === "sauce_compile")!;
      assert.ok(!("path" in (compile.inputSchema.properties ?? {})));
      const refused = (await client.callTool({
        name: "sauce_compile",
        arguments: { path: "package.json", chain: "base" },
      })) as CallToolResult;
      assert.equal(refused.isError, true);
    } finally {
      await client.close();
    }
  });
});
