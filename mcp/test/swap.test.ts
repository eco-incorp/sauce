/**
 * `kyberSwap` and `ecoSwap` through the server's tools: each route asked of the SERVER's services
 * (`sauce mcp --swap-api`, the `--config` file's `swapApis`, KyberSwap's public API), never a
 * caller's. The services are a stub `fetch` answering as each API does (the SDK suites' is
 * `sdk/test/swap-stub.ts`): nothing reaches a network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encodeFunctionData, type Address } from "viem";

import { v12DeployedAddresses } from "../../sdk/dist/deployments/index.js";
import { KyberSwapMetaAggregationRouterABI } from "../../sdk/dist/protocols/kyberswap/abis.js";
import { NO_ENDPOINTS, readEndpoints } from "../src/config.js";
import { connect, failed, ok } from "./harness.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const KYBER = "https://kyber.test";
const ECO = "https://eco.test";
const ECO_PROGRAM = `0x${"5a".repeat(40)}` as const;

const BOTH = `function main(recipient: Address, minOut: Uint256) {
  let filled = true;
  try {
    const out = kyberSwap(USDC, WETH, 1000000000, minOut);
    WETH.transfer(recipient, out);
  } catch {
    filled = false;
  }
  if (!filled) {
    const out = ecoSwap(USDC, WETH, 1000000000, minOut);
    WETH.transfer(recipient, out);
  }
}
`;

const ROUTER: Address = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const QUOTE = 372_000_000_000_000_000n;

/** KyberSwap's two calls on Base and eco-swap's embed, answered as each API does. */
function stub(): { fetch: typeof fetch; asked: URL[] } {
  const asked: URL[] = [];
  const answer = (url: URL, body: string | undefined): unknown => {
    if (url.pathname === "/base/api/v1/routes") {
      return {
        code: 0,
        data: {
          routeSummary: { amountOut: QUOTE.toString(), route: [] },
          routerAddress: ROUTER,
        },
      };
    }
    if (url.pathname === "/base/api/v1/route/build") {
      const built = JSON.parse(body ?? "{}") as { recipient: Address };
      const data = encodeFunctionData({
        abi: KyberSwapMetaAggregationRouterABI,
        functionName: "swap",
        args: [
          {
            callTarget: ROUTER,
            approveTarget: "0x0000000000000000000000000000000000000000",
            targetData: "0x",
            desc: {
              srcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              dstToken: "0x4200000000000000000000000000000000000006",
              srcReceivers: [],
              srcAmounts: [],
              feeReceivers: [],
              feeAmounts: [],
              dstReceiver: built.recipient,
              amount: 1_000_000_000n,
              minReturnAmount: 1n,
              flags: 0n,
              permit: "0x",
            },
            clientData: "0x",
          },
        ],
      });
      return { code: 0, data: { data, routerAddress: ROUTER, transactionValue: "0" } };
    }
    return {
      embed: {
        version: 1,
        compiler: v12DeployedAddresses().compiler,
        chainId: Number(url.searchParams.get("chainId")),
        tokenIn: url.searchParams.get("from"),
        tokenOut: url.searchParams.get("to"),
        program: ECO_PROGRAM,
        entryParams: [
          { name: "amountIn", type: "uint256" },
          { name: "minOut", type: "uint256" },
        ],
      },
    };
  };
  const stubFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(url);
    const body = typeof init?.body === "string" ? init.body : undefined;
    return new Response(JSON.stringify(answer(url, body)));
  }) as typeof fetch;

  return { fetch: stubFetch, asked };
}

describe("kyberSwap and ecoSwap through the tools", () => {
  it("sauce_tx asks the server's services for the cook's Pot", async () => {
    const served = stub();
    const mcp = await connect({
      ...NO_ENDPOINTS,
      swapApis: { kyber: KYBER, eco: ECO },
      swapFetch: served.fetch,
    });
    try {
      const tx = ok(
        await mcp.call("sauce_tx", {
          source: BOTH,
          chain: "base",
          owner: OWNER,
          value: 0,
          args: [OWNER, "1"],
        }),
      );
      assert.ok(
        String(tx.data).includes(ECO_PROGRAM.slice(2)),
        "eco-swap's program is in the cook",
      );
      assert.deepEqual(served.asked.map((url) => url.origin).sort(), [ECO, KYBER, KYBER]);
    } finally {
      await mcp.close();
    }
  });

  it("a --config file's swapApis are the server's", () => {
    const endpoints = readEndpoints(
      JSON.stringify({ rpcUrls: {}, swapApis: { eco: ECO } }),
      "test.config.json",
    );
    assert.deepEqual(endpoints.swapApis, { eco: ECO });
    assert.throws(
      () =>
        readEndpoints(JSON.stringify({ rpcUrls: {}, swapApis: { fynd: ECO } }), "test.config.json"),
      /swapApis.fynd: the providers are kyber and eco/,
    );
  });

  it("a server with no eco-swap API refuses ecoSwap, saying how its operator gives one", async () => {
    const served = stub();
    const mcp = await connect({
      ...NO_ENDPOINTS,
      swapApis: { kyber: KYBER },
      swapFetch: served.fetch,
    });
    try {
      const message = failed(
        await mcp.call("sauce_compile", {
          source:
            "function main(amount: Uint256): Uint256 { return ecoSwap(USDC, WETH, amount, 0); }\n",
          chain: "base",
        }),
      );
      assert.match(message, /ecoSwap asks eco-swap's API for its route, and none is given/);
      assert.deepEqual(served.asked, []);
    } finally {
      await mcp.close();
    }
  });
});
