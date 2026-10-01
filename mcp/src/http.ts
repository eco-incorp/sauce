/**
 * The server over Streamable HTTP, stateless: every POST to `/mcp` gets a server and a transport
 * of its own, answered with JSON, and nothing is kept between requests — no session, so any
 * replica can answer any request. There is no GET stream and no DELETE (405).
 *
 * It authenticates NO ONE. It binds to the loopback interface unless told otherwise, and answers
 * only requests whose Host (and Origin, when sent) is a loopback name or one `--allowed-host`
 * names, which is what stops a web page from reaching it through DNS rebinding. A deployment others
 * can reach goes behind the operator's own authentication — a reverse proxy that checks a token —
 * and must name the host it is served as (`entry.ts` refuses to bind beyond loopback without one).
 *
 * A request body past `maxBody` bytes is refused (413) before it is parsed; each tool bounds its
 * own inputs besides (`tools.ts#LIMITS`).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { scrub } from "./sdk.js";

/** The default bound on a request body: 2 MiB, room for the largest program a tool takes. */
export const DEFAULT_MAX_BODY = 2 * 1024 * 1024;

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];

export interface HttpOptions {
  readonly port: number;
  /** The interface to bind: 127.0.0.1 unless the operator says otherwise. */
  readonly host: string;
  /** Host names requests may name besides the loopback ones (the name a proxy serves it as). */
  readonly allowedHosts: readonly string[];
  readonly maxBody: number;
  /** A fresh server for one request. */
  readonly server: () => McpServer;
  /** Where a request that fails is reported, scrubbed: stderr. */
  readonly log?: (text: string) => void;
}

export const isLoopback = (host: string): boolean =>
  LOOPBACK.includes(host) || /^127\.\d+\.\d+\.\d+$/.test(host);

/** The hostname a Host or Origin header names, port dropped; `undefined` when it names none. */
function hostnameOf(value: string, origin: boolean): string | undefined {
  try {
    return new URL(origin ? value : `http://${value}`).hostname;
  } catch {
    return undefined;
  }
}

function refuse(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

/**
 * Which hosts a request may name: the loopback ones and `allowedHosts`; `undefined` (any) only
 * when `allowedHosts` says `*` — for an operator whose proxy checks the Host itself.
 */
function hostsAllowed(options: HttpOptions): readonly string[] | undefined {
  if (!options.allowedHosts.includes("*")) {
    // A name given with a port is the name: the Host check compares hostnames, port dropped.
    return [
      ...LOOPBACK,
      ...options.allowedHosts.map((host) => (hostnameOf(host, false) ?? host).toLowerCase()),
    ];
  }

  return undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse, options: HttpOptions) {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (path !== "/mcp") return refuse(res, 404, "not found: the MCP endpoint is /mcp");
  const allowed = hostsAllowed(options);
  if (allowed !== undefined) {
    const host = hostnameOf(req.headers.host ?? "", false);
    if (host === undefined || !allowed.includes(host.toLowerCase())) {
      return refuse(res, 403, "this server does not answer for that Host");
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const from = hostnameOf(origin, true);
      if (from === undefined || !allowed.includes(from.toLowerCase())) {
        return refuse(res, 403, "this server does not answer requests from that Origin");
      }
    }
  }
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");

    return refuse(res, 405, "this server is stateless: POST each JSON-RPC request to /mcp");
  }
  const server = options.server();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: options.maxBody,
  });
  res.on("close", () => {
    // Closing what this one request opened; nothing to report if either was already closed.
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/** Starts listening; resolves once it is, with the server (its address has the port taken). */
export async function serveHttp(options: HttpOptions): Promise<Server> {
  const http = createServer((req, res) => {
    handle(req, res, options).catch((error: unknown) => {
      options.log?.(
        `sauce mcp: a request failed: ${scrub(error instanceof Error ? error.message : String(error))}\n`,
      );
      if (!res.headersSent) refuse(res, 500, "internal error");
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port, options.host, () => {
      http.off("error", reject);
      resolve();
    });
  });

  return http;
}

/** Where a listening server answers, for the line it prints. */
export function endpointUrl(http: Server, host: string): string {
  const { port } = http.address() as AddressInfo;
  const shown = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

  return `http://${shown}:${port}/mcp`;
}
