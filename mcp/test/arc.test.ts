/**
 * sauce_pot on Arc, whose native coin is USDC and also the ERC-20 `USDC`: one balance, read twice.
 * Against a JSON-RPC endpoint that answers as Arc, the Kitchen's fee and the Pot's native balance
 * are named in USDC, and a note says the two USDC balances are one, so an agent does not add them.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { encodeAbiParameters, toFunctionSelector } from "viem";

import { v12KitchenAddress } from "../../sdk/dist/deployments/index.js";
import { v12PredictPot } from "../../sdk/dist/deployments/pot.js";
import { connect, ok, type Connected } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const EXECUTION_FEE = toFunctionSelector("function executionFee()");
const word = (value: bigint): string => encodeAbiParameters([{ type: "uint256" }], [value]);
const PREDICT_POT = toFunctionSelector("function predictPot(address,bytes32)");
const POT = v12PredictPot(OWNER) as `0x${string}`;

describe("sauce_pot on Arc", () => {
  let server: Server;
  let url: string;
  let mcp: Connected;

  before(async () => {
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString()));
      request.on("end", () => {
        const parsed = JSON.parse(body) as object | object[];
        const calls = [parsed].flat() as Array<{
          id: number;
          method: string;
          params?: Array<{ data?: string }>;
        }>;
        const answers = calls.map((call) => {
          const data = call.params?.[0]?.data;
          const to = (call.params?.[0] as { to?: string } | undefined)?.to?.toLowerCase();
          const result = {
            eth_chainId: "0x13b2",
            eth_blockNumber: "0x1",
            // Every address has code but the Pot, not deployed yet: the released contracts.
            eth_getCode:
              String(call.params?.[0]).toLowerCase() === POT.toLowerCase() ? "0x" : "0x00",
            // 2 USDC, as the native coin: 18 decimals.
            eth_getBalance: `0x${(2n * 10n ** 18n).toString(16)}`,
            // The Kitchen's fee, 0.01 USDC; the Pot where the SDK predicts it, as the released
            // Kitchen does; else the same 2 USDC through the ERC-20: 6 decimals.
            eth_call: data?.startsWith(EXECUTION_FEE)
              ? word(10n ** 16n)
              : data?.startsWith(PREDICT_POT) && to === v12KitchenAddress().toLowerCase()
                ? encodeAbiParameters([{ type: "address" }], [POT])
                : word(2n * 10n ** 6n),
          }[call.method];

          return result === undefined
            ? { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "not here" } }
            : { jsonrpc: "2.0", id: call.id, result };
        });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(Array.isArray(parsed) ? answers : answers[0]));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    mcp = await connect();
  });

  after(async () => {
    await mcp?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("names the Kitchen's fee and the Pot's native balance in USDC, and says they are one", async () => {
    const out = ok(await mcp.call("sauce_pot", { chain: "arc", owner: OWNER, rpcUrl: url }));
    // Its unsigned deployment carries no fee fields: the signer is told Arc's floor.
    assert.ok(
      (out.notes as string[]).some((note) =>
        note.includes("a maxFeePerGas (or gasPrice) of at least 20 gwei"),
      ),
      JSON.stringify(out.notes),
    );
    assert.deepEqual(out.kitchenFee, {
      wei: "10000000000000000",
      native: "0.01",
      symbol: "USDC",
    });
    const balances = out.balances as {
      native: Record<string, string>;
      tokens: Array<{ address: string; formatted: string | null }>;
    };
    assert.deepEqual(balances.native, {
      symbol: "USDC",
      wei: "2000000000000000000",
      formatted: "2",
    });
    assert.equal(
      balances.tokens.find((token) => token.address.toLowerCase() === ARC_USDC)?.formatted,
      "2",
    );
    assert.ok(
      (out.notes as string[]).some((note) =>
        note.includes(
          `On Arc the native coin is USDC, and the token at ${ARC_USDC} is the same balance`,
        ),
      ),
      JSON.stringify(out.notes),
    );
  });
});
