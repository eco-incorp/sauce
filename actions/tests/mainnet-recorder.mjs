/**
 * The capture-mode recording proxy for `mainnet.ts`, as its OWN process, so nothing a suite does on
 * its event loop can stall anvil, which — mid-transaction — waits on this proxy for the state it has
 * not fetched yet.
 *
 * Forwards every JSON-RPC request to `SAUCE_CAPTURE_UPSTREAM` and records each account and storage
 * slot it answers. A read at any block but `SAUCE_CAPTURE_BLOCK` is refused, so one capture cannot
 * mix two blocks. On SIGTERM it writes the records to `SAUCE_CAPTURE_OUT` and exits. Prints its port
 * on stdout once listening.
 */
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

const upstream = process.env.SAUCE_CAPTURE_UPSTREAM;
const pinned = process.env.SAUCE_CAPTURE_BLOCK?.toLowerCase();
const out = process.env.SAUCE_CAPTURE_OUT;
if (!upstream || !pinned || !out) throw new Error("mainnet-recorder: missing its environment");

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
 * POSTs `body` upstream. An RPC occasionally never answers, and anvil — mid-transaction, waiting on
 * this proxy — would then hang with it, so each attempt times out and is retried. A public RPC also
 * rate-limits, so a throttled answer is retried too, with a longer back-off.
 */
async function forward(body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      const answer = { status: response.status, text: await response.text() };
      if (attempt < 12 && throttled(answer.status, answer.text)) {
        await new Promise((r) => setTimeout(r, 1_000 * attempt));
        continue;
      }
      return answer;
    } catch (error) {
      if (attempt >= 4) throw error;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  let text;
  let status = 502;
  try {
    ({ status, text } = await forward(body));
    const requests = [JSON.parse(body)].flat();
    const responses = [JSON.parse(text)].flat();
    for (const request of requests) {
      const response = responses.find((r) => r.id === request.id);
      if (response && "result" in response) record(request, response.result);
    }
  } catch (error) {
    // Never echo the upstream error: it can carry the RPC URL.
    errors.push(
      error instanceof Error && !String(error.message).includes(upstream)
        ? error.message
        : "upstream request failed",
    );
    text ??= JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: "capture proxy error" },
    });
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${server.address().port}\n`);
});

process.on("SIGTERM", () => {
  writeFileSync(out, JSON.stringify({ accounts, errors }));
  process.exit(0);
});
