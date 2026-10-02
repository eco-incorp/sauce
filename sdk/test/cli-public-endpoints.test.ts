/**
 * The built-in public endpoints, with nothing reached: each endpoint is a fake `fetch` answering
 * JSON-RPC, behind the real loopback forwarder (`public-endpoints.ts`), so what is tested is the
 * forwarding itself — falling back from one endpoint to the next, keeping to the one that
 * answered, sending `eth_simulateV1` only where it runs — and the `sauce` command's precedence:
 * `--rpc-url`, then the `--config` file's entry, then the public list, and none with `--offline`.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { requireChain } from "../src/chains/canonical.js";
import { publicEndpoints, type PublicEndpoints } from "../src/cli/public-endpoints.js";
import { PUBLIC_RPCS, PUBLIC_RPCS_VERIFIED, type PublicRpc } from "../src/cli/public-rpcs.js";
import { nodeIo, runCli, type CliIo } from "../src/cli/run.js";
import { CANONICAL_CHAINS } from "../src/chains/canonical.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BASE = requireChain("base");

/** What a fake endpoint does with a request: answer a result, answer a status, or fail to connect. */
type Behaviour = { result: (method: string) => unknown } | { status: number } | "unreachable";

/** A JSON-RPC answer to `body`'s call, with `result`. */
const answered = (body: string, result: unknown): Response => {
  const { id } = JSON.parse(body) as { id: number };

  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

/** A chain's view of the EVM, enough for `sauce pot`: its id, and no code anywhere. */
const evmChain =
  (chainId: number) =>
  (method: string): unknown =>
    method === "eth_chainId" ? `0x${chainId.toString(16)}` : method === "eth_getCode" ? "0x" : null;

/** Fake endpoints by URL, and every request each received, by method. */
function fakeFetch(endpoints: Record<string, Behaviour>) {
  const calls: Array<{ readonly url: string; readonly method: string }> = [];
  const send = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body);
    calls.push({ url, method: (JSON.parse(body) as { method: string }).method });
    const behaviour = endpoints[url];
    if (behaviour === undefined || behaviour === "unreachable") throw new TypeError("fetch failed");
    if ("status" in behaviour) return new Response("refused", { status: behaviour.status });

    return answered(body, behaviour.result(calls.at(-1)!.method));
  }) as typeof fetch;

  return { send, calls };
}

/** One JSON-RPC call through `url`, as any client sends it. */
async function call(url: string, method: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  });

  return { status: response.status, body: await response.text() };
}

const open: PublicEndpoints[] = [];
/** The forwarder over `rpcs`, ready, and closed after the test. */
async function forwarder(
  rpcs: Readonly<Record<number, readonly PublicRpc[]>>,
  send: typeof fetch,
): Promise<PublicEndpoints> {
  const endpoints = publicEndpoints({ rpcs, fetch: send, timeoutMs: 2_000 });
  open.push(endpoints);
  await endpoints.ready();

  return endpoints;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((endpoints) => endpoints.close()));
});

describe("the list", () => {
  it("covers every canonical chain but the three none of whose keyless endpoints passed", () => {
    const uncovered = CANONICAL_CHAINS.filter((chain) => PUBLIC_RPCS[chain.id] === undefined).map(
      (chain) => chain.slug,
    );
    expect(uncovered).toEqual(["kava", "zetachain", "evmos"]);
    for (const id of Object.keys(PUBLIC_RPCS)) {
      expect(CANONICAL_CHAINS.some((chain) => String(chain.id) === id)).toBe(true);
    }
    expect(PUBLIC_RPCS_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gives every endpoint as a keyless https URL, one to three to a chain", () => {
    for (const [id, list] of Object.entries(PUBLIC_RPCS)) {
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.length).toBeLessThanOrEqual(3);
      expect(new Set(list.map((rpc) => rpc.url)).size).toBe(list.length);
      for (const { url, simulateV1 } of list) {
        const parsed = new URL(url);
        expect(parsed.protocol).toBe("https:");
        expect(parsed.username + parsed.password).toBe("");
        // A key is long and has digits; no segment or query value of a public endpoint is one.
        for (const part of [...parsed.pathname.split("/"), ...parsed.searchParams.values()]) {
          expect(part.length >= 20 && /\d/.test(part)).toBe(false);
        }
        // Solana's endpoints have no eth_simulateV1 to flag; every EVM one is flagged.
        expect(simulateV1 === undefined).toBe(id === String(requireChain("solana").id));
      }
    }
  });

  it("gives the supported chains at least two endpoints each, to fall back between", () => {
    for (const slug of ["ethereum", "base", "solana"]) {
      expect(PUBLIC_RPCS[requireChain(slug).id]!.length).toBeGreaterThanOrEqual(2);
    }
    // Where an endpoint runs eth_simulateV1, the first one does: a simulation and the reads around
    // it then go to one node.
    for (const list of Object.values(PUBLIC_RPCS)) {
      if (list.some((rpc) => rpc.simulateV1 === true)) expect(list[0]!.simulateV1).toBe(true);
    }
  });
});

describe("the forwarder", () => {
  const A = "https://a.example";
  const B = "https://b.example";
  const C = "https://c.example";
  const three = { [BASE.id]: [{ url: A }, { url: B }, { url: C }] };

  it("falls back on an unreachable endpoint, a rate limit and a 5xx, then keeps to the next", async () => {
    const fake = fakeFetch({
      [A]: "unreachable",
      [B]: { status: 429 },
      [C]: { result: evmChain(8453) },
    });
    const url = (await forwarder(three, fake.send)).url(BASE)!;
    expect(new URL(url).hostname).toBe("127.0.0.1");

    expect(await call(url, "eth_chainId")).toEqual({
      status: 200,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x2105" }),
    });
    expect(fake.calls.map((each) => each.url)).toEqual([A, B, C]);
    // The next request goes where the last one was answered.
    await call(url, "eth_blockNumber");
    expect(fake.calls.map((each) => each.url)).toEqual([A, B, C, C]);
  });

  it("passes on a refusal (401, 403) and a server error, but returns any other answer as it is", async () => {
    for (const status of [401, 403, 500, 502, 503]) {
      const fake = fakeFetch({ [A]: { status }, [B]: { result: evmChain(8453) } });
      const url = (await forwarder({ [BASE.id]: [{ url: A }, { url: B }] }, fake.send)).url(BASE)!;
      expect((await call(url, "eth_chainId")).status).toBe(200);
      expect(fake.calls.map((each) => each.url)).toEqual([A, B]);
    }
    // A 400 is an answer about the request, which another endpoint would give too.
    const fake = fakeFetch({ [A]: { status: 400 }, [B]: { result: evmChain(8453) } });
    const url = (await forwarder({ [BASE.id]: [{ url: A }, { url: B }] }, fake.send)).url(BASE)!;
    expect((await call(url, "eth_chainId")).status).toBe(400);
    expect(fake.calls.map((each) => each.url)).toEqual([A]);
  });

  it("answers the last refusal when every endpoint refuses, and a 502 when none is reached", async () => {
    const limited = fakeFetch({ [A]: { status: 503 }, [B]: { status: 429 } });
    const url = (await forwarder({ [BASE.id]: [{ url: A }, { url: B }] }, limited.send)).url(BASE)!;
    expect((await call(url, "eth_chainId")).status).toBe(429);

    const down = fakeFetch({ [A]: "unreachable", [B]: "unreachable" });
    const gone = (await forwarder({ [BASE.id]: [{ url: A }, { url: B }] }, down.send)).url(BASE)!;
    expect(await call(gone, "eth_chainId")).toEqual({
      status: 502,
      body: "no public endpoint for base could be reached",
    });
  });

  it("sends eth_simulateV1 only to an endpoint that runs it, and everything else in order", async () => {
    const fake = fakeFetch({
      [A]: { result: evmChain(8453) },
      [B]: { result: evmChain(8453) },
      [C]: { result: () => [] },
    });
    const rpcs = {
      [BASE.id]: [
        { url: A, simulateV1: false },
        { url: B, simulateV1: false },
        { url: C, simulateV1: true },
      ],
    };
    const url = (await forwarder(rpcs, fake.send)).url(BASE)!;
    await call(url, "eth_chainId");
    await call(url, "eth_simulateV1");
    expect(fake.calls).toEqual([
      { url: A, method: "eth_chainId" },
      { url: C, method: "eth_simulateV1" },
    ]);
  });

  it("has no URL for a chain it has no endpoint for, and none before it is ready", async () => {
    const endpoints = publicEndpoints({ rpcs: three, fetch: fakeFetch({}).send });
    open.push(endpoints);
    expect(() => endpoints.url(BASE)).toThrow(/before ready/);
    await endpoints.ready();
    expect(endpoints.url(requireChain("ethereum"))).toBeUndefined();
    expect(endpoints.chainIds).toEqual([BASE.id]);
    // Only this process's URLs are served.
    const url = new URL(endpoints.url(BASE)!);
    expect((await call(`${url.origin}/someone-else/${BASE.id}`, "eth_chainId")).status).toBe(404);
  });
});

describe("sauce, reading a chain", () => {
  let work: string;
  let own: Server;
  let ownUrl: string;
  const ownCalls: string[] = [];

  beforeAll(async () => {
    // An endpoint of the user's own: a JSON-RPC server on loopback.
    own = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        const { id, method } = JSON.parse(body) as { id: number; method: string };
        ownCalls.push(method);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result: evmChain(8453)(method) }));
      });
    });
    await new Promise<void>((done) => own.listen(0, "127.0.0.1", done));
    ownUrl = `http://127.0.0.1:${(own.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((done) => own.close(() => done()));
  });
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "sauce-public-"));
    ownCalls.length = 0;
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const PUBLIC = "https://public.example";

  /** `sauce` with the public endpoints given as the executable gives them, over `fake`. */
  async function sauce(fake: ReturnType<typeof fakeFetch>, ...argv: string[]) {
    let stdout = "";
    let stderr = "";
    const publicRpcs = publicEndpoints({
      rpcs: { [BASE.id]: [{ url: PUBLIC }] },
      fetch: fake.send,
    });
    open.push(publicRpcs);
    const io: CliIo = {
      ...nodeIo(),
      publicRpcs,
      stdout: (text) => void (stdout += text),
      stderr: (text) => void (stderr += text),
    };

    return { code: await runCli(argv, io), stdout, stderr };
  }

  const pot = ["pot", "--owner", OWNER, "--chain", "base"];
  const NOTE =
    "base: read through a built-in public endpoint, which can be slow or rate-limited; give " +
    "your own with --rpc-url <url> or --config <file>\n";

  it("reads it through a public endpoint when given none, and says so once", async () => {
    const fake = fakeFetch({ [PUBLIC]: { result: evmChain(8453) } });
    const run = await sauce(fake, ...pot);
    expect(run.code).toBe(0);
    expect(run.stderr.startsWith(NOTE)).toBe(true);
    expect(run.stderr.split(NOTE)).toHaveLength(2);
    expect(JSON.parse(run.stdout).deployment.pot.deployed).toBe(false);
    expect(fake.calls.map((each) => each.method)).toContain("eth_getCode");
    expect(new Set(fake.calls.map((each) => each.url))).toEqual(new Set([PUBLIC]));
  });

  it("reads it through --rpc-url instead, reaching no public endpoint", async () => {
    const fake = fakeFetch({ [PUBLIC]: { result: evmChain(8453) } });
    const run = await sauce(fake, ...pot, "--rpc-url", ownUrl);
    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain("public endpoint");
    expect(ownCalls).toContain("eth_getCode");
    expect(fake.calls).toEqual([]);
  });

  it("reads it through --config's entry for the chain, and the public list for one it lacks", async () => {
    const config = join(work, "sauce.config.json");
    writeFileSync(config, JSON.stringify({ rpcUrls: { [BASE.id]: ownUrl } }));
    const fake = fakeFetch({ [PUBLIC]: { result: evmChain(8453) } });
    const run = await sauce(fake, ...pot, "--config", config);
    expect(run.code).toBe(0);
    expect(ownCalls).toContain("eth_getCode");
    expect(fake.calls).toEqual([]);

    writeFileSync(config, JSON.stringify({ rpcUrls: { "1": ownUrl } }));
    ownCalls.length = 0;
    const other = await sauce(fake, ...pot, "--config", config);
    expect(other.code).toBe(0);
    expect(other.stderr.startsWith(NOTE)).toBe(true);
    expect(ownCalls).toEqual([]);
    expect(fake.calls.length).toBeGreaterThan(0);
  });

  it("reads no chain with --offline, which goes with no endpoint of the user's", async () => {
    const fake = fakeFetch({ [PUBLIC]: { result: evmChain(8453) } });
    const run = await sauce(fake, ...pot, "--offline");
    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain("public endpoint");
    expect(JSON.parse(run.stdout).deployment).toBeUndefined();
    expect(fake.calls).toEqual([]);

    const both = await sauce(fake, ...pot, "--offline", "--rpc-url", ownUrl);
    expect(both.code).toBe(2);
    expect(both.stderr).toMatch(/--offline reads no chain: give it without --rpc-url/);
    // A command that cannot do without the chain says so.
    const program = join(work, "noop.sauce.ts");
    writeFileSync(program, "function main() {}\n");
    const simulate = await sauce(
      fake,
      "simulate",
      program,
      "--chain",
      "base",
      "--owner",
      OWNER,
      "--offline",
    );
    expect(simulate.code).toBe(2);
    expect(simulate.stderr).toMatch(/--offline reads no chain, and this reads base/);
    expect(fake.calls).toEqual([]);
  });

  it("names a chain no public endpoint serves when the command needs it read", async () => {
    const program = join(work, "noop.sauce.ts");
    writeFileSync(program, "function main() {}\n");
    const fake = fakeFetch({});
    const run = await sauce(fake, "simulate", program, "--chain", "kava", "--owner", OWNER);
    expect(run.code).toBe(2);
    expect(run.stderr).toMatch(
      /missing --rpc-url <url> \(or --config <file>\): the kava endpoint, which has no built-in public one/,
    );
    expect(fake.calls).toEqual([]);
  });
});
