// A contract's runtime code, read from a chain with `eth_getCode` and held to a keccak256 pin:
// what `scripts/fetch-contract-code.mjs` puts back where the suites read it, and what the
// fetchability estimate reads the same way.
//
// Reads are `eth_chainId` (once per endpoint, so an endpoint for another chain is dropped) and
// `eth_getCode` at `latest`, nothing else: no key, no transaction. Public endpoints are not archive
// nodes, so there is no historical read. The code at an address does not change unless the account
// self-destructs and is created again, or becomes an EIP-7702 delegation; the pin catches both, and
// `describeMismatch` says which. The endpoints are handed in (the SDK's own public list,
// `src/cli/public-rpcs.ts`, which the callers load) so this module holds no URL.
import { keccak256 } from "viem";

/** A keccak256 digest as the pins write it: 0x and 64 lowercase hex digits. */
export const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
/** An address as the genesis files and pins write it. */
export const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** The keccak256 of `code` (0x-hex), as `codeHash` pins it. */
export const codeHashOf = (code) => keccak256(code);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * What `code` (0x-hex) is: `{ kind: "empty" }` (no code: an account that self-destructed, or never
 * held any), `{ kind: "delegation", target }` (EIP-7702: `0xef0100` and a 20-byte address, an EOA
 * that delegates), `{ kind: "reserved" }` (another `0xef` start, which EIP-3541 keeps out of
 * deployed code: a node's precompile marker) or `{ kind: "code" }`.
 */
export function classifyCode(code) {
  if (code === "0x") return { kind: "empty" };
  const delegation = /^0xef0100([0-9a-f]{40})$/i.exec(code);
  if (delegation !== null) return { kind: "delegation", target: `0x${delegation[1]}` };
  if (/^0xef/i.test(code)) return { kind: "reserved" };
  return { kind: "code" };
}

/** Why `live` (the code an address holds now) is not the code a pin names. */
export function describeMismatch(live) {
  const { kind, target } = classifyCode(live);
  if (kind === "empty")
    return (
      "It has no code now: the contract self-destructed (or was never there), so the chain no " +
      "longer serves the pinned code"
    );
  if (kind === "delegation")
    return `It is an EIP-7702 delegation to ${target} now: an EOA that delegates, not the pinned contract`;
  if (kind === "reserved") return "It holds a node's 0xef marker, not deployable contract code";
  return (
    "It holds other code: the contract was replaced since the capture (redeployed after a " +
    "self-destruct, or a system contract upgraded by a hard fork), or the pin is not the hash of " +
    "the captured code. Re-pinning means recapturing the suites that read it and revisiting what " +
    "they assert, not editing the hash"
  );
}

/**
 * A reader of `chainId` over `endpoints` (URLs, tried in order, the next on a failure). A network
 * error, a timeout, HTTP 429/5xx (honouring `Retry-After`), any other refusal by an endpoint and
 * an endpoint on another chain move to the next one; a full round of failures backs off with a
 * growing delay, `attempts` tries in all. Nothing in a failure carries a URL's path or query, so a
 * keyed endpoint is never printed.
 */
export function createEvmReader({
  chainId,
  endpoints,
  attempts = 10,
  timeoutMs = 60_000,
  log = () => {},
}) {
  if (endpoints.length === 0) throw new Error(`evm-code: no endpoint for chain ${chainId}`);
  const label = (url) => new URL(url).origin;
  const verified = new Set();
  const wrongChain = new Set();
  let sticky = 0;

  async function send(url, method, params) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const failure = new Error(`${label(url)} answered HTTP ${response.status}`);
      const after = Number(response.headers.get("retry-after"));
      if (response.status === 429 || response.status >= 500)
        failure.waitMs = Number.isFinite(after) && after > 0 ? after * 1_000 : 0;
      throw failure;
    }
    const body = await response.json();
    if (body.error !== undefined)
      throw new Error(`${method}: ${label(url)} answered ${body.error.code} ${body.error.message}`);
    return body.result;
  }

  async function call(method, params) {
    let last = "no attempt";
    for (let attempt = 0; attempt < attempts; attempt++) {
      const at = (sticky + attempt) % endpoints.length;
      const url = endpoints[at];
      const round = Math.floor(attempt / endpoints.length);
      let wait = round === 0 ? 250 : Math.min(30_000, 1_000 * 2 ** (round - 1));
      if (wrongChain.has(url)) {
        last = `${label(url)} is not chain ${chainId}`;
        continue;
      }
      try {
        if (!verified.has(url)) {
          const id = Number(BigInt(await send(url, "eth_chainId", [])));
          if (id !== chainId) {
            wrongChain.add(url);
            last = `${label(url)} is chain ${id}, not ${chainId}`;
            continue;
          }
          verified.add(url);
        }
        const result = await send(url, method, params);
        sticky = at;
        return result;
      } catch (error) {
        if (typeof error?.waitMs === "number") wait = Math.max(wait, error.waitMs);
        last =
          error?.name === "TimeoutError"
            ? `${label(url)} timed out`
            : error instanceof TypeError
              ? `${label(url)}: ${error.cause?.code ?? error.message}`
              : (error?.message ?? String(error));
      }
      log(`${method} attempt ${attempt + 1}/${attempts} failed (${last}); retrying in ${wait} ms`);
      await sleep(wait);
    }
    throw new Error(`${method} on chain ${chainId} failed after ${attempts} attempts: ${last}`);
  }

  /** The runtime code `address` holds at the chain's latest block, 0x-hex in lower case. */
  async function getCode(address) {
    for (let attempt = 0; ; attempt++) {
      const code = await call("eth_getCode", [address, "latest"]);
      if (typeof code === "string" && /^0x([0-9a-fA-F]{2})*$/.test(code)) return code.toLowerCase();
      if (attempt === 2) throw new Error(`eth_getCode answered ${JSON.stringify(code)}`);
      await sleep(250);
    }
  }

  return { chainId, getCode };
}
