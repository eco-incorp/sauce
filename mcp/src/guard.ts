/**
 * The guard between a remote server and the RPC endpoints its callers name.
 *
 * A tool call may carry its own `rpcUrl`. On a server others reach over HTTP, that URL is chosen by
 * whoever calls it, so the server must not become a way into the network it runs in: its own
 * loopback, the private networks around it, a cloud's metadata service. So, over HTTP, a caller's
 * endpoint is reached only through this guard:
 *
 * - `https:` only (unless the operator allows private endpoints);
 * - its host resolved, and refused when any address it resolves to is loopback, private (RFC 1918,
 *   ULA), link-local, CGNAT, unspecified, multicast, reserved, or a cloud metadata address;
 * - RESOLVED AGAIN, AND CHECKED AGAIN, AT EVERY CONNECTION. The SDK's clients are handed a loopback
 *   URL of this guard's own, which forwards each request to the endpoint through a DNS lookup that
 *   refuses those addresses — so a name that resolved to a public address when it was checked and
 *   to a private one when it is used (DNS rebinding) is refused when it is used;
 * - no redirect followed, a timeout, and bounds on what is sent and what is read back.
 *
 * `--allow-private-rpc` relaxes it for a private deployment: `http:` and private addresses then
 * pass, but link-local and metadata addresses never do. Over stdio there is no guard: the server is
 * the user's own process, on the user's own machine, reached by the user's own agent, so an
 * endpoint it names is one the user can reach anyway — a local node included.
 */
import { randomBytes } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type AddressInfo } from "node:net";

import { UsageError } from "./sdk.js";

/** Never reached, guard relaxed or not: link-local and the cloud metadata services. */
const ALWAYS = new BlockList();
ALWAYS.addSubnet("169.254.0.0", 16, "ipv4"); // link-local; AWS, GCP and Azure metadata, ECS tasks
ALWAYS.addAddress("100.100.100.200", "ipv4"); // Alibaba Cloud metadata
ALWAYS.addSubnet("fe80::", 10, "ipv6"); // link-local
ALWAYS.addAddress("fd00:ec2::254", "ipv6"); // AWS metadata over IPv6

/** Never reached by a guarded server: everything that is not the public internet. */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network", unspecified
  ["10.0.0.0", 8], // RFC 1918
  ["100.64.0.0", 10], // CGNAT (RFC 6598)
  ["127.0.0.0", 8], // loopback
  ["172.16.0.0", 12], // RFC 1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // RFC 1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and broadcast
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64: an IPv4 address behind it may be any of the above
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local (ULA)
  ["ff00::", 8], // multicast
] as const) {
  PRIVATE.addSubnet(network, prefix, "ipv6");
}

/** The IPv4 address an IPv4-mapped IPv6 one (`::ffff:10.0.0.1`) stands for. */
function mappedV4(address: string): string | undefined {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (dotted !== undefined) return dotted;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hex === null) return undefined;
  const high = parseInt(hex[1]!, 16);
  const low = parseInt(hex[2]!, 16);

  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** Why the guard refuses `address`, or `undefined` when it may be reached. */
export function blockedAddress(address: string, allowPrivate: boolean): string | undefined {
  const v4 = mappedV4(address);
  const [ip, family] =
    v4 !== undefined
      ? [v4, "ipv4" as const]
      : [address, isIP(address) === 6 ? ("ipv6" as const) : ("ipv4" as const)];
  if (isIP(ip) === 0) return "is not an IP address";
  if (ALWAYS.check(ip, family)) return "is link-local or a cloud metadata address";
  if (!allowPrivate && PRIVATE.check(ip, family)) {
    return "is loopback, private, CGNAT or otherwise not on the public internet";
  }

  return undefined;
}

/** A DNS lookup in `dns.lookup`'s shape, every answer at once. */
export type Resolve = (hostname: string) => Promise<readonly LookupAddress[]>;

const systemResolve: Resolve = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) =>
      error === null ? resolve(addresses) : reject(error),
    ),
  );

export interface RpcGuardOptions {
  /** `--allow-private-rpc`: `http:` and private addresses pass; link-local and metadata never. */
  readonly allowPrivate: boolean;
  /** How hosts resolve: the system's, unless a test says otherwise. */
  readonly resolve?: Resolve;
  /** How long one request to an endpoint may take, in milliseconds. */
  readonly timeoutMs?: number;
  /** The most bytes one request sends an endpoint, and one answer may bring back. */
  readonly maxRequest?: number;
  readonly maxResponse?: number;
}

/** A caller's endpoint, reachable through the guard while the call that named it runs. */
export interface Routed {
  /** The guard's own loopback URL for it, which the SDK's clients are given instead. */
  readonly url: string;
  readonly release: () => void;
}

export interface RpcGuard {
  /** Checks `raw` and routes it through the guard; a refusal names no part of the URL. */
  route(raw: string): Promise<Routed>;
  close(): Promise<void>;
}

/** The scheme and host a caller's `raw` URL names, checked; the message never quotes it. */
export async function checkRpcUrl(
  raw: string,
  options: Pick<RpcGuardOptions, "allowPrivate" | "resolve">,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UsageError("rpcUrl is not a URL");
  }
  const schemes = options.allowPrivate ? ["https:", "http:"] : ["https:"];
  if (!schemes.includes(url.protocol)) {
    throw new UsageError(
      options.allowPrivate
        ? "rpcUrl must be an http(s) URL"
        : "rpcUrl must be an https URL: this server reaches a caller's endpoint over TLS only",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new UsageError("rpcUrl must not carry a user name or password before its host");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses =
    isIP(host) === 0
      ? await (options.resolve ?? systemResolve)(host).catch(() => {
          throw new UsageError("rpcUrl's host does not resolve");
        })
      : [{ address: host, family: isIP(host) }];
  for (const { address } of addresses) {
    const why = blockedAddress(address, options.allowPrivate);
    if (why !== undefined) {
      throw new UsageError(
        `rpcUrl's host resolves to an address that ${why}, which this server does not reach. ` +
          "Pass a public endpoint, or run the server yourself (`sauce mcp`) to " +
          "reach a local or private one.",
      );
    }
  }

  return url;
}

const refuse = (res: ServerResponse, status: number, message: string): void => {
  if (res.headersSent) {
    res.destroy();

    return;
  }
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(message);
};

/** Reads `req`'s body, up to `max` bytes; `undefined` when it is larger. */
function body(req: IncomingMessage, max: number): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        resolve(undefined);
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The guard, with its forwarder on an ephemeral loopback port, started on the first route. */
export function createRpcGuard(options: RpcGuardOptions): RpcGuard {
  const resolve = options.resolve ?? systemResolve;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxRequest = options.maxRequest ?? 2 * 1024 * 1024;
  const maxResponse = options.maxResponse ?? 16 * 1024 * 1024;
  const routes = new Map<string, URL>();
  let listening: Promise<{ server: Server; port: number }> | undefined;

  /** `dns.lookup` for the connection itself: the check repeated on the addresses it will use. */
  const lookup = (
    hostname: string,
    lookupOptions: { all?: boolean },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    resolve(hostname).then(
      (addresses) => {
        const blocked = addresses.find(
          (each) => blockedAddress(each.address, options.allowPrivate) !== undefined,
        );
        if (blocked !== undefined || addresses.length === 0) {
          callback(Object.assign(new Error("refused address"), { code: "ESAUCEBLOCKED" }), "");
        } else if (lookupOptions.all === true) {
          callback(null, [...addresses]);
        } else {
          callback(null, addresses[0]!.address, addresses[0]!.family);
        }
      },
      (error: NodeJS.ErrnoException) => callback(error, ""),
    );
  };

  const forward = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const target = routes.get((req.url ?? "").slice(1));
    if (target === undefined) return refuse(res, 404, "no such route");
    if (req.method !== "POST") return refuse(res, 405, "POST only");
    const sent = await body(req, maxRequest);
    if (sent === undefined) return refuse(res, 413, "request too large");
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = send(
      target,
      {
        method: "POST",
        headers: {
          "content-type": req.headers["content-type"] ?? "application/json",
          "content-length": sent.length,
          accept: "application/json",
        },
        lookup,
        timeout: timeoutMs,
      },
      (answer) => {
        const status = answer.statusCode ?? 502;
        // A redirect could lead anywhere the checks never saw: it is not followed.
        if (status >= 300 && status < 400) {
          answer.resume();

          return refuse(res, 502, "the endpoint redirected, which this server does not follow");
        }
        const chunks: Buffer[] = [];
        let size = 0;
        answer.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxResponse) {
            answer.destroy();
            refuse(res, 502, "the endpoint's answer is too large");
          } else chunks.push(chunk);
        });
        answer.on("end", () => {
          if (res.headersSent || size > maxResponse) return;
          res.writeHead(status, {
            "content-type": answer.headers["content-type"] ?? "application/json",
          });
          res.end(Buffer.concat(chunks));
        });
        answer.on("error", () => refuse(res, 502, "the endpoint's answer failed"));
      },
    );
    upstream.on("timeout", () => upstream.destroy(new Error("timed out")));
    upstream.on("error", (error: NodeJS.ErrnoException) =>
      refuse(
        res,
        502,
        error.code === "ESAUCEBLOCKED"
          ? "refused: the endpoint's host resolves to an address this server does not reach"
          : error.message === "timed out"
            ? "the endpoint did not answer in time"
            : "the endpoint could not be reached",
      ),
    );
    upstream.end(sent);
  };

  const start = (): Promise<{ server: Server; port: number }> => {
    if (listening !== undefined) return listening;
    const started = new Promise<{ server: Server; port: number }>((ready, fail) => {
      const server = createServer((req, res) => {
        forward(req, res).catch(() => refuse(res, 502, "the endpoint could not be reached"));
      });
      server.once("error", fail);
      // Loopback only, on a port the system picks: nothing outside this host can reach it.
      server.listen(0, "127.0.0.1", () => {
        server.off("error", fail);
        ready({ server, port: (server.address() as AddressInfo).port });
      });
    });
    // A start that fails must not be remembered as the guard's answer: drop it, so the next route
    // starts again instead of failing for as long as the guard lives. Only this start's own entry:
    // a newer one may have replaced it.
    listening = started;
    started.catch(() => {
      if (listening === started) listening = undefined;
    });

    return started;
  };

  return {
    route: async (raw) => {
      const target = await checkRpcUrl(raw, { allowPrivate: options.allowPrivate, resolve });
      const { port } = await start();
      // Unguessable, and good for this one call only.
      const token = randomBytes(24).toString("hex");
      routes.set(token, target);

      return { url: `http://127.0.0.1:${port}/${token}`, release: () => routes.delete(token) };
    },
    close: async () => {
      if (listening === undefined) return;
      const { server } = await listening;
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
