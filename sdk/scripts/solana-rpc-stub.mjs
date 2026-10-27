// A Solana JSON-RPC endpoint on loopback holding only what `sauce simulate` reads to rehearse a cook
// in its local copy: the Rent sysvar at mainnet's rent, the Kitchen's fee config, and the mints it is
// given. Every other account is absent, as an owner's and a Pot's are before they exist, and no
// program owns any (`sauce pools` finds none). The packed check rehearses a Solana cook through it
// from the installed tarball, with no network; the MCP tests list a pair's pools through it.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

/** Mainnet's rent: 5080 lamports a byte-year, rent-exempt at one year, half of it burned. */
function rentSysvar() {
  const data = Buffer.alloc(17);
  data.writeBigUInt64LE(5080n, 0);
  data.writeDoubleLE(1, 8);
  data[16] = 50;
  return data;
}

/** The lamports that keep `size` bytes rent-exempt at that rent. */
const rentExempt = (size) => (128n + BigInt(size)) * 5080n;

/**
 * Serves `accounts` (address -> { owner, data, and optionally lamports and executable: rent-exempt
 * and not, unless given }) beside the Rent sysvar, the fee config at
 * `feeConfig` (when given) charging `fee` lamports, and a clock at `slot`. A scan
 * (`getProgramAccounts`) of a program in `refuseScans` is always refused, and the first
 * `rateLimitScans` scans of any program are, as a rate-limited endpoint refuses them; a scan of a
 * program in `scans` (program -> [{ pubkey, data }]) finds those accounts, whatever its filters.
 * Its cluster is `genesis`, mainnet-beta's unless given: the command reads it to pick the engine
 * build a local rehearsal runs.
 * Resolves to { url, methods, close }: `methods` counts what was asked, and an unknown method — a
 * transaction history, say — is answered with an error naming it.
 */
export async function solanaRpcStub({
  feeConfig,
  kitchen,
  fee = 0n,
  accounts = {},
  slot = 1_000n,
  refuseScans = [],
  rateLimitScans = 0,
  scans = {},
  genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} = {}) {
  let scanned = 0;
  const held = new Map(Object.entries(accounts));
  const discriminator = createHash("sha256").update("account:ExecutionFeeConfig").digest();
  const feeData = Buffer.alloc(16);
  discriminator.copy(feeData, 0, 0, 8);
  feeData.writeBigUInt64LE(BigInt(fee), 8);
  if (feeConfig !== undefined) held.set(feeConfig, { owner: kitchen, data: feeData });
  held.set("SysvarRent111111111111111111111111111111111", {
    owner: "Sysvar1111111111111111111111111111111111111",
    data: rentSysvar(),
  });
  const info = (key) => {
    const account = held.get(key);
    if (account === undefined) return null;
    const data = Buffer.from(account.data);
    return {
      data: [data.toString("base64"), "base64"],
      executable: account.executable === true,
      lamports: Number(account.lamports ?? rentExempt(data.length)),
      owner: account.owner,
      rentEpoch: 0,
      space: data.length,
    };
  };
  const context = { slot: Number(slot) };
  const methods = new Map();
  const answer = ({ method, params = [] }) => {
    methods.set(method, (methods.get(method) ?? 0) + 1);
    switch (method) {
      case "getMultipleAccounts":
        return { context, value: params[0].map(info) };
      case "getAccountInfo":
        return { context, value: info(params[0]) };
      case "getProgramAccounts":
        if (refuseScans.includes(params[0])) throw new Error("scans of this program are refused");
        if (++scanned <= rateLimitScans) throw new Error("too many requests: rate limited");
        return (scans[params[0]] ?? []).map(({ pubkey, data }) => {
          held.set(pubkey, { owner: params[0], data });

          return { pubkey, account: info(pubkey) };
        });
      case "getBalance":
        return { context, value: 0 };
      case "getSlot":
        return Number(slot);
      case "getGenesisHash":
        return genesis;
      case "getBlockTime":
        return Math.floor(Date.now() / 1000);
      case "getLatestBlockhash":
        return {
          context,
          value: {
            blockhash: "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k",
            lastValidBlockHeight: Number(slot) + 150,
          },
        };
      case "getMinimumBalanceForRentExemption":
        return Number(rentExempt(params[0]));
      default:
        throw new Error(`the stub does not answer ${method}`);
    }
  };
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const parsed = JSON.parse(body);
      const one = (call) => {
        try {
          return { jsonrpc: "2.0", id: call.id, result: answer(call) };
        } catch (error) {
          return { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: error.message } };
        }
      };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed)));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    methods,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
