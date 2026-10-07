/**
 * The built-in public endpoints (`public-rpcs.ts`), reached as ONE endpoint per chain: a loopback
 * URL of this module's own, handed to every client a command makes — viem's, Solana's, a plain
 * `fetch` — like any other endpoint. It forwards each JSON-RPC request to the chain's public
 * endpoints in order, going on to the next when one cannot be reached or does not answer in time,
 * refuses the request (401, 403), rate-limits it (429) or fails (5xx). The MCP server's guard
 * (`mcp/src/guard.ts`) forwards a caller's endpoint the same way.
 *
 * It keeps to the endpoint that last answered, so one command's requests go to one node and see one
 * chain until that node fails, and moves past one that failed, so a client that gave up waiting and
 * asks again starts at the next; and it sends `eth_simulateV1` only to an endpoint that runs it
 * (`simulateV1`), and a Solana program's scan (`getProgramAccounts`) only to one that answers it
 * (`programAccounts`), where the chain has one. One endpoint gets 8 seconds, less than viem's own
 * timeout, so a client still waiting is answered by the next.
 *
 * NODE-ONLY: the `sauce` command and its MCP server use it; nothing browser-facing imports it.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { CanonicalChain } from "../chains/canonical.js";
import { PUBLIC_RPCS, type PublicRpc } from "./public-rpcs.js";

export interface PublicEndpointsOptions {
  /** The endpoints by chain id: {@link PUBLIC_RPCS}, unless a test gives others. */
  readonly rpcs?: Readonly<Record<number, readonly PublicRpc[]>>;
  /** How a request reaches an endpoint: the global `fetch`, unless a test gives another. */
  readonly fetch?: typeof fetch;
  /** How long one endpoint may take to answer one request before the next is tried, in ms. */
  readonly timeoutMs?: number;
}

/** The public endpoints, one loopback URL per chain. */
export interface PublicEndpoints {
  /** The chains with a public endpoint. */
  readonly chainIds: readonly number[];
  /** Starts the forwarder, once; {@link url} answers only after it has. */
  ready(): Promise<void>;
  /** The URL that reaches `chain` through its public endpoints; `undefined` for a chain with none. */
  url(chain: CanonicalChain): string | undefined;
  close(): Promise<void>;
}

/** What answered one request: an endpoint's reply, as it came. */
interface Reply {
  readonly status: number;
  readonly type: string;
  readonly body: Uint8Array;
}

/** One chain's endpoints, and the one the next request starts at: the last that answered, or the
 *  one after the last that failed. */
interface Route {
  readonly chain: CanonicalChain;
  readonly rpcs: readonly PublicRpc[];
  current: number;
}

/** An answer that sends the request on to the next endpoint: a refusal, a rate limit, a failure. */
const passesOn = (status: number): boolean =>
  status === 401 || status === 403 || status === 429 || status >= 500;

/** The JSON-RPC methods a request body calls: one, or a batch's. */
function methodsOf(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as unknown;

    return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((call) => {
      const method = (call as { method?: unknown } | null)?.method;

      return typeof method === "string" ? [method] : [];
    });
  } catch {
    return [];
  }
}

/**
 * `body` sent to `route`'s endpoints, from the one that answered last, until one answers: the
 * first answer that does not pass it on, else the last that did, else a 502 saying none could be
 * reached.
 */
async function relay(
  route: Route,
  body: string,
  send: typeof fetch,
  timeoutMs: number,
): Promise<Reply> {
  const { rpcs } = route;
  const methods = methodsOf(body);
  const simulating =
    methods.includes("eth_simulateV1") && rpcs.some((rpc) => rpc.simulateV1 === true);
  // A program's scan, only where scans are answered (one endpoint refuses every one with a 403).
  const scanning =
    methods.includes("getProgramAccounts") && rpcs.some((rpc) => rpc.programAccounts === true);
  const order = rpcs
    .map((_, offset) => (route.current + offset) % rpcs.length)
    .filter((index) => !simulating || rpcs[index]!.simulateV1 === true)
    .filter((index) => !scanning || rpcs[index]!.programAccounts === true);
  let passed: Reply | undefined;
  for (const index of order) {
    try {
      const answer = await send(rpcs[index]!.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const reply = {
        status: answer.status,
        type: answer.headers.get("content-type") ?? "application/json",
        body: new Uint8Array(await answer.arrayBuffer()),
      };
      if (!passesOn(reply.status)) {
        route.current = index;

        return reply;
      }
      passed = reply;
    } catch {
      // Unreachable, too slow, or cut off mid-answer: the next one.
    }
    if (route.current === index) route.current = (index + 1) % rpcs.length;
  }

  return (
    passed ?? {
      status: 502,
      type: "text/plain",
      body: new TextEncoder().encode(`no public endpoint for ${route.chain.slug} could be reached`),
    }
  );
}

/** Reads `req`'s whole body: JSON-RPC, text. */
function bodyOf(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const answer = (res: ServerResponse, reply: Reply): void => {
  if (res.headersSent) {
    res.destroy();

    return;
  }
  res.writeHead(reply.status, { "content-type": reply.type });
  res.end(reply.body);
};

/** The public endpoints of {@link PUBLIC_RPCS} (or `options.rpcs`), behind one loopback forwarder. */
export function publicEndpoints(options: PublicEndpointsOptions = {}): PublicEndpoints {
  const rpcs = options.rpcs ?? PUBLIC_RPCS;
  const send = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  // In every URL: a request without it is not this process's.
  const token = randomBytes(16).toString("hex");
  const routes = new Map<string, Route>();
  let listening: Promise<{ readonly server: Server; readonly port: number }> | undefined;
  let port: number | undefined;

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const [, given, id] = (req.url ?? "").split("/");
    const route = given === token ? routes.get(id ?? "") : undefined;
    if (route === undefined) {
      return answer(res, { status: 404, type: "text/plain", body: new Uint8Array() });
    }
    if (req.method !== "POST") {
      return answer(res, { status: 405, type: "text/plain", body: new Uint8Array() });
    }
    answer(res, await relay(route, await bodyOf(req), send, timeoutMs));
  };

  const start = () =>
    (listening ??= new Promise((ready, fail) => {
      const server = createServer((req, res) => {
        handle(req, res).catch(() =>
          answer(res, { status: 502, type: "text/plain", body: new Uint8Array() }),
        );
      });
      // Neither the server nor a connection to it keeps the process alive: a command ends when its
      // own work does, and a request in flight is held open by the client waiting on it.
      server.on("connection", (socket) => socket.unref());
      server.once("error", fail);
      // Loopback only, on a port the system picks.
      server.listen(0, "127.0.0.1", () => {
        server.off("error", fail);
        server.unref();
        port = (server.address() as AddressInfo).port;
        ready({ server, port });
      });
    }));

  return {
    chainIds: Object.entries(rpcs)
      .filter(([, list]) => list.length > 0)
      .map(([id]) => Number(id)),
    ready: async () => {
      await start();
    },
    url: (chain) => {
      const list = rpcs[chain.id];
      if (list === undefined || list.length === 0) return undefined;
      if (port === undefined)
        throw new Error("internal: a public endpoint asked for before ready()");
      if (!routes.has(String(chain.id))) {
        routes.set(String(chain.id), { chain, rpcs: list, current: 0 });
      }

      return `http://127.0.0.1:${port}/${token}/${chain.id}`;
    },
    close: async () => {
      if (listening === undefined) return;
      const { server } = await listening;
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
