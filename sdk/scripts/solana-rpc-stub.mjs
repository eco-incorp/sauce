// A Solana JSON-RPC endpoint on loopback holding only what `sauce simulate` reads to rehearse a cook
// in its local copy: the Rent sysvar at mainnet's rent, the Kitchen's fee config, and the mints it is
// given. Every other account is absent, as an owner's and a Pot's are before they exist. The packed
// check rehearses a Solana cook through it from the installed tarball, with no network.
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
 * Serves `accounts` (address -> { owner, data }) beside the Rent sysvar, the fee config at
 * `feeConfig` charging `fee` lamports, and a clock at `slot`. Resolves to { url, methods, close }:
 * `methods` counts what was asked, and an unknown method is answered with an error naming it.
 */
export async function solanaRpcStub({ feeConfig, kitchen, fee, accounts = {}, slot = 1_000n }) {
  const held = new Map(Object.entries(accounts));
  const discriminator = createHash("sha256").update("account:ExecutionFeeConfig").digest();
  const feeData = Buffer.alloc(16);
  discriminator.copy(feeData, 0, 0, 8);
  feeData.writeBigUInt64LE(BigInt(fee), 8);
  held.set(feeConfig, { owner: kitchen, data: feeData });
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
      executable: false,
      lamports: Number(rentExempt(data.length)),
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
      case "getBalance":
        return { context, value: 0 };
      case "getSlot":
        return Number(slot);
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
