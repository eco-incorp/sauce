/**
 * The endpoints one tool call reaches: the `rpcUrl` the call carries, else the server's own from
 * `--config`, else a built-in public endpoint, else a plain refusal — and everything the call
 * returns scrubbed of the first two. A public endpoint is no secret; the result says it was used.
 *
 * A caller's URL usually embeds the caller's API key, so it is treated as a secret for exactly as
 * long as the call that carries it: never returned, never logged, and removed from every message
 * the call produces, including an upstream error that quotes it (a provider's, or viem's). It is
 * not added to the process-wide secrets, which would grow with every call a server answers.
 *
 * Over HTTP the URL is reached only through the guard (`guard.ts`), which checks where it leads at
 * every connection; over stdio it is used as given, an http(s) URL — the caller is the server's
 * own user, on the user's own machine.
 */
import { noEndpoint, type Endpoints } from "./config.js";
import type { RpcGuard, Routed } from "./guard.js";
import { scrub, UsageError, type CanonicalChain } from "./sdk.js";

export interface Reach {
  /** `chain`'s endpoint: `given` (the call's `rpcUrl`), else the server's; `undefined` with none. */
  endpoint(chain: CanonicalChain, given: string | undefined): Promise<string | undefined>;
  /** The same, or the refusal of a tool that needs one, naming what it needed it for. */
  require(chain: CanonicalChain, given: string | undefined, what: string): Promise<string>;
  /** `text` with the call's URLs, and the server's secrets, taken out. */
  scrub(text: string): string;
  /** What the call should say of the chains it read through a built-in public endpoint. */
  publicNotes(): string[];
  /** Closes the routes the call opened through the guard. */
  release(): void;
}

/** The forms a URL can reappear in a message: as given, normalized, and its parts that may be a
 *  key — the host (some providers put the key there) and every path segment or query value that
 *  looks like one. */
function forms(raw: string): string[] {
  const found = new Set<string>([raw, raw.trim()]);
  try {
    const url = new URL(raw.trim());
    found.add(url.href);
    found.add(url.href.replace(/\/$/, ""));
    found.add(`${url.host}${url.pathname}`);
    if (url.hostname.includes(".")) found.add(url.hostname);
    for (const part of [
      ...url.pathname.split("/"),
      ...[...url.searchParams.values()],
      url.username,
      url.password,
    ]) {
      // A key is long and usually has digits: not `solana` or `base-mainnet`, which a result may
      // rightly contain.
      if (part.length >= 20 || (part.length >= 12 && /\d/.test(part))) {
        found.add(part);
        found.add(encodeURIComponent(part));
      }
    }
  } catch {
    // Not a URL: the text as given is all there is to take out.
  }

  return [...found].filter((form) => form.length >= 4).sort((a, b) => b.length - a.length);
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function callReach(endpoints: Endpoints, guard: RpcGuard | undefined): Reach {
  const secrets = new Set<string>();
  const routes: Routed[] = [];
  const publicChains = new Map<number, CanonicalChain>();
  const remember = (text: string) => {
    for (const form of forms(text)) secrets.add(form);
  };

  const endpoint = async (
    chain: CanonicalChain,
    given: string | undefined,
  ): Promise<string | undefined> => {
    if (given === undefined) {
      const own = endpoints.endpoint(chain);
      if (own !== undefined) return own;
      const url = endpoints.public?.url(chain);
      if (url !== undefined) publicChains.set(chain.id, chain);

      return url;
    }
    // Before anything can fail and quote it.
    remember(given);
    if (guard !== undefined) {
      const routed = await guard.route(given);
      routes.push(routed);
      remember(routed.url);

      return routed.url;
    }
    let url: URL;
    try {
      url = new URL(given.trim());
    } catch {
      throw new UsageError("rpcUrl is not a URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new UsageError("rpcUrl must be an http(s) URL");
    }

    return given.trim();
  };

  return {
    endpoint,
    require: async (chain, given, what) => {
      const url = await endpoint(chain, given);
      if (url === undefined) throw noEndpoint(chain, endpoints, what);

      return url;
    },
    scrub: (text) => {
      let out = scrub(text);
      for (const secret of secrets)
        out = out.replace(new RegExp(escape(secret), "gi"), "[redacted]");

      return out;
    },
    publicNotes: () =>
      [...publicChains.values()].map(
        (chain) =>
          `${chain.slug} was read through a built-in public endpoint, which can be slow or ` +
          "rate-limited: pass rpcUrl with the call for an endpoint of your own.",
      ),
    release: () => {
      for (const routed of routes.splice(0)) routed.release();
    },
  };
}
