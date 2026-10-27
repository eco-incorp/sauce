/**
 * The proxy every network fork reaches its endpoint through, as its OWN process, so nothing a test
 * does on its event loop (a compile is synchronous) can stall anvil, which — mid-transaction — waits
 * on this proxy for state it has not fetched yet.
 *
 * Reads `{ upstream, block?, out?, deadline? }` as JSON on stdin — never the environment, and never
 * the command line, where the upstream URL (which may carry a key) would show in the process list;
 * anvil is given only this proxy's loopback URL. Forwards every JSON-RPC request to `upstream`. With
 * `out` (`fork(..., { mode: "record" })`) it also records each account and storage slot `upstream`
 * answers, and a read at any block but `block` is refused, so one recording cannot mix two blocks;
 * on SIGTERM it writes the records to `out` and exits. Without `out` (a live fork) it records
 * nothing and SIGTERM only stops it. One request may take `deadline` ms upstream, retries included
 * (60 s by default), so an endpoint that has gone away fails in a minute rather than stalling.
 * Prints its port on stdout once listening.
 */
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { upstream, block, out, deadline = 60_000 } = JSON.parse(input);
const recording = out !== undefined;
if (!upstream || (recording && !block)) throw new Error("recorder: missing its configuration");
const { endpoint, headers, password } = requestOf(upstream);
const pinned = String(block).toLowerCase();

/**
 * Where to POST, and with what headers. Node's fetch refuses a URL that carries credentials
 * (`https://user:pass@host/…`), which anvil's `--fork-url` took: they go as the Basic header anvil
 * would have sent, and the URL without them.
 */
function requestOf(url) {
  const target = new URL(url);
  const headers = { "content-type": "application/json" };
  if (target.username === "" && target.password === "") return { endpoint: url, headers };
  const user = decodeURIComponent(target.username);
  const secret = decodeURIComponent(target.password);
  headers.authorization = `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;
  target.username = "";
  target.password = "";

  return { endpoint: target.href, headers, password: secret };
}

/** Whether `text` holds the endpoint, or a part of it, that may carry a key. */
const revealing = (text) =>
  [upstream, endpoint, password].some((part) => part && String(text).includes(part));

/** address -> { balance, nonce, code, storage: { slot: value } } */
const accounts = {};
const account = (address) => (accounts[address.toLowerCase()] ??= { storage: {} });
const word = (hex) => `0x${BigInt(hex).toString(16).padStart(64, "0")}`;
const errors = [];

function atPinned(tag) {
  if (typeof tag === "string" && tag.startsWith("0x") && tag.toLowerCase() !== pinned) {
    throw new Error(`the fork asked for block ${tag}, not the pinned ${pinned}`);
  }
}

function record({ method, params = [] }, result) {
  const [address, second, third] = params;
  switch (method) {
    case "eth_getAccountInfo":
      atPinned(second);
      Object.assign(account(address), {
        balance: result.balance,
        nonce: typeof result.nonce === "number" ? `0x${result.nonce.toString(16)}` : result.nonce,
        code: result.code,
      });
      break;
    case "eth_getBalance":
      atPinned(second);
      account(address).balance = result;
      break;
    case "eth_getTransactionCount":
      atPinned(second);
      account(address).nonce = result;
      break;
    case "eth_getCode":
      atPinned(second);
      account(address).code = result;
      break;
    case "eth_getStorageAt":
      atPinned(third);
      account(address).storage[word(second)] = word(result);
      break;
  }
}

/** True when `status`/`text` is the upstream refusing for load, not answering: worth a retry. */
function throttled(status, text) {
  if (status === 429 || status >= 500) return true;
  try {
    return [JSON.parse(text)]
      .flat()
      .some(
        (r) => r?.error && /rate limit|too many requests|capacity/i.test(r.error.message ?? ""),
      );
  } catch {
    return false;
  }
}

/**
 * POSTs `body` upstream. An RPC occasionally never answers, and anvil would then hang with it, so
 * each attempt times out and is retried; a throttled answer is retried with a longer back-off. All
 * of it within `deadline`: a retry that would end past it is not made.
 */
async function forward(body) {
  const until = Date.now() + deadline;
  const late = () => new Error(`the endpoint did not answer within ${deadline / 1_000} s`);
  /** Waits `ms` before the next attempt, unless the attempt would then start past the deadline. */
  const pause = async (ms) => {
    if (Date.now() + ms >= until) throw late();
    await new Promise((r) => setTimeout(r, ms));
  };
  for (let attempt = 1; ; attempt++) {
    let answer;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, until - Date.now()))),
      });
      answer = { status: response.status, text: await response.text() };
    } catch (error) {
      if (Date.now() >= until) throw late();
      if (attempt >= 4) throw error;
      await pause(500 * attempt);
      continue;
    }
    if (attempt < 12 && throttled(answer.status, answer.text)) {
      await pause(1_000 * attempt);
      continue;
    }
    return answer;
  }
}

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  let text;
  let status = 502;
  try {
    ({ status, text } = await forward(body));
    if (recording) {
      const requests = [JSON.parse(body)].flat();
      const responses = [JSON.parse(text)].flat();
      for (const request of requests) {
        const response = responses.find((r) => r.id === request.id);
        if (response && "result" in response) record(request, response.result);
      }
    }
  } catch (error) {
    // Never echo the upstream error: it can carry the RPC URL.
    errors.push(
      error instanceof Error && !revealing(error.message)
        ? error.message
        : "upstream request failed",
    );
    text ??= JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "recorder proxy error" },
    });
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${server.address().port}\n`);
});

process.on("SIGTERM", () => {
  if (recording) writeFileSync(out, JSON.stringify({ accounts, errors }));
  process.exit(0);
});
