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
 * on SIGTERM it writes the records to `out` and exits, and one request may take `deadline` ms
 * upstream, retries included (60 s by default), so an endpoint that has gone away fails in a minute
 * rather than stalling. Without `out` (a live fork) it records nothing, SIGTERM only stops it, and
 * each request goes upstream once, as anvil sent it: anvil's own timeout and retries apply. A
 * configuration it cannot use is refused with one fixed message that quotes nothing of it, and the
 * answers of an endpoint are never quoted either: both can carry a key. Exits when its parent does.
 * Prints its port on stdout once listening.
 */
import { writeFileSync, writeSync } from "node:fs";
import { createServer } from "node:http";

let input = "";
for await (const chunk of process.stdin) input += chunk;
let upstream, block, out, deadline, endpoint, headers, secrets;
try {
  ({ upstream, block, out, deadline = 60_000 } = JSON.parse(input));
  if (!upstream || (out !== undefined && !block)) throw new Error("missing");
  ({ endpoint, headers, secrets } = requestOf(upstream));
} catch {
  // Never the error itself: Node's `ERR_INVALID_URL` carries the whole URL, key included, and this
  // process's stderr is the parent's (a test run, a CI log). Written synchronously so that it lands
  // before the exit.
  writeSync(2, "recorder: invalid configuration\n");
  process.exit(1);
}
const recording = out !== undefined;
const pinned = String(block).toLowerCase();

/**
 * Where to POST, and with what headers. Node's fetch refuses a URL that carries credentials
 * (`https://user:pass@host/…`), which anvil's `--fork-url` took: they go as the Basic header anvil
 * would have sent, and the URL without them. `secrets` is everything an echo of them would show.
 */
function requestOf(url) {
  const target = new URL(url);
  const headers = { "content-type": "application/json" };
  if (target.username === "" && target.password === "") {
    return { endpoint: url, headers, secrets: [] };
  }
  const user = decoded(target.username);
  const secret = decoded(target.password);
  const credential = Buffer.from(`${user}:${secret}`).toString("base64");
  headers.authorization = `Basic ${credential}`;
  target.username = "";
  target.password = "";

  return {
    endpoint: target.href,
    headers,
    secrets: [user, secret, headers.authorization, credential],
  };
}

/** Percent-decoded as anvil does it: a `%` that starts no escape stays as it is. */
function decoded(part) {
  return Buffer.from(
    part.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))),
    "latin1",
  ).toString();
}

/** Whether `text` holds the endpoint, or a part of it, that may carry a key. */
const revealing = (text) =>
  [upstream, endpoint, ...secrets].some((part) => part && String(text).includes(part));

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

/** A live fork's request: one attempt, answered as the endpoint answered. */
async function relay(body, signal) {
  const response = await fetch(endpoint, { method: "POST", headers, body, signal });

  return { status: response.status, text: await response.text() };
}

const server = createServer(async (req, res) => {
  let body = "";
  try {
    for await (const chunk of req) body += chunk;
  } catch {
    // The client hung up mid-body: nothing to answer, and nothing to bring the proxy down for.
    return res.destroy();
  }
  let text;
  let status = 502;
  // A live fork's retries and timeouts are anvil's: when it hangs up, so does the request upstream.
  const hungUp = new AbortController();
  res.on("close", () => hungUp.abort());
  try {
    ({ status, text } = await (recording ? forward(body) : relay(body, hungUp.signal)));
    if (recording) {
      const requests = [JSON.parse(body)].flat();
      const responses = [JSON.parse(text)].flat();
      for (const request of requests) {
        const response = responses.find((r) => r.id === request.id);
        if (response && "result" in response) record(request, response.result);
      }
    }
  } catch (error) {
    // Never echo the upstream error: it can carry the RPC URL, and a JSON error quotes the answer,
    // which can echo the Basic header. A SyntaxError here can only come from the answer, so it is
    // replaced by a fixed message; any other message is kept only when it holds nothing of the
    // credentials, with the cause's code (`ECONNREFUSED`, `ENOTFOUND`), which cannot.
    const code = typeof error?.cause?.code === "string" ? ` (${error.cause.code})` : "";
    const said =
      error instanceof SyntaxError
        ? "the endpoint's answer is not JSON"
        : error instanceof Error && !revealing(error.message)
          ? `${error.message}${code}`
          : "upstream request failed";
    if (recording) errors.push(said);
    else if (!hungUp.signal.aborted) process.stderr.write(`recorder: ${said}\n`);
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

// A parent that is killed (SIGKILL) cannot SIGTERM this process: it exits when the parent is gone.
const parent = process.ppid;
setInterval(() => process.ppid !== parent && process.exit(0), 1_000).unref();

process.on("SIGTERM", () => {
  if (recording) writeFileSync(out, JSON.stringify({ accounts, errors }));
  process.exit(0);
});
