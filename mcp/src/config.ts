/**
 * Where the server reads chains: the RPC endpoints of a `--config` file, in the `sauce` command's
 * format (`{ "rpcUrls": { "<chain id>": "<url>" } }`), and nothing else. The server ships no
 * endpoint and reads no environment variable.
 *
 * A provider URL usually carries a key, so every URL is registered as a secret the moment the file
 * is read: `sdk.scrub` removes it from every tool result and every message the server writes. No
 * result names the file either — on a remote server its path is the operator's business.
 */
import { endpointFor, secret, UsageError, type CanonicalChain } from "./sdk.js";

/** The chains a server can read, by the endpoints its operator configured. */
export interface Endpoints {
  /** The chain ids with an endpoint. */
  readonly chainIds: readonly number[];
  /** The endpoint for `chain`, or `undefined` when none is configured. */
  readonly endpoint: (chain: CanonicalChain) => string | undefined;
}

/** A server with no `--config`: it reads no chain. */
export const NO_ENDPOINTS: Endpoints = { chainIds: [], endpoint: () => undefined };

/** The name `endpointFor` gives the file in its messages: never its path. */
const SHOWN = "(the server's config)";

/**
 * The endpoints in a config file's `text`. It is checked whole here, at start, so a malformed file
 * stops the server rather than failing one tool call later; `path` is only for that message.
 */
export function readEndpoints(text: string, path: string): Endpoints {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError(`--config ${path}: not JSON`);
  }
  const urls = (parsed as { rpcUrls?: unknown } | null)?.rpcUrls;
  if (urls === null || typeof urls !== "object" || Array.isArray(urls)) {
    throw new UsageError(`--config ${path}: expected { "rpcUrls": { "<chain id>": "<url>" } }`);
  }
  const entries = Object.entries(urls as Record<string, unknown>);
  // Every URL a secret before any entry is checked, so no failure below can print one.
  for (const [, url] of entries) if (typeof url === "string") secret(url);
  for (const [id, url] of entries) {
    // Each id as a chain's id is written, so the lookup by `String(chain.id)` finds it: no `08453`.
    if (!/^(?:0|[1-9]\d*)$/.test(id)) {
      throw new UsageError(`--config ${path}: rpcUrls key '${id}' is not a chain id`);
    }
    if (typeof url !== "string") {
      throw new UsageError(`--config ${path}: rpcUrls["${id}"] is not a string`);
    }
    // A placeholder fails `endpointFor` at the first call for its chain; refuse it here instead.
    if (/^<.*>$/.test(url.trim())) {
      throw new UsageError(
        `--config ${path}: rpcUrls["${id}"] is a placeholder: replace it with the chain's URL, ` +
          "or remove the entry",
      );
    }
    // An endpoint is reached over HTTP: anything else (file:, data:) is refused, never fetched.
    if (!/^https?:\/\//i.test(url.trim())) {
      throw new UsageError(`--config ${path}: rpcUrls["${id}"] is not an http(s) URL`);
    }
  }
  const chainIds = entries.map(([id]) => Number(id));

  return {
    chainIds,
    endpoint: (chain) =>
      chainIds.includes(chain.id)
        ? endpointFor(chain, undefined, { path: SHOWN, text })
        : undefined,
  };
}

/** Why a tool that reads `chain` cannot, said plainly. */
export function noEndpoint(chain: CanonicalChain, endpoints: Endpoints, what: string): UsageError {
  return new UsageError(
    `${what} needs an RPC endpoint for ${chain.slug} (chain id ${chain.id}), and this server ` +
      (endpoints.chainIds.length === 0
        ? "has none of its own. "
        : `has none of its own for that chain (it has ${endpoints.chainIds.join(", ")}). `) +
      "Pass rpcUrl with the call. (Or the server's operator adds the chain to its --config " +
      `file: { "rpcUrls": { "${chain.id}": "<url>" } }.)`,
  );
}

/** The endpoint for `chain`, or the plain refusal of a tool that needs one. */
export function requireEndpoint(chain: CanonicalChain, endpoints: Endpoints, what: string): string {
  const url = endpoints.endpoint(chain);
  if (url === undefined) throw noEndpoint(chain, endpoints, what);

  return url;
}
