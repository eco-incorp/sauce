/**
 * A stub of the two services `kyberSwap` and `ecoSwap` ask for routes, answering as each API does:
 * KyberSwap's `GET /{chain}/api/v1/routes` and `POST /{chain}/api/v1/route/build`, its calldata
 * the registry router's `swap(...)` encoded for the sender and recipient asked for, and eco-swap's
 * `GET /swap?embed=1`, under the SDK's contract. Served as a `fetch` (`stubSwapFetch`) or behind an
 * HTTP server (`swap-routes.e2e.test.ts`); nothing reaches a network either way.
 */
import { encodeFunctionData, type Address, type Hex } from "viem";

import { v12DeployedAddresses } from "../src/deployments/index.js";
import { KyberSwapMetaAggregationRouterABI } from "../src/protocols/kyberswap/abis.js";
import { KYBER_CHAINS } from "../src/routes/swap-apis.js";

/** The registry's KyberSwap router: one address on every chain the stub serves. */
export const KYBER_ROUTER: Address = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";

export interface SwapStub {
  /** What KyberSwap quotes, and its router pays. */
  readonly kyberQuotes: bigint;
  /** The program eco-swap answers with. */
  readonly ecoProgram: () => Hex;
}

/** The answer to one request, by its URL and body: a 404 for a path neither API has. */
export function answerSwapApi(
  url: URL,
  body: string | undefined,
  stub: SwapStub,
): { status: number; json: unknown } {
  const slug = url.pathname.split("/")[1] ?? "";
  const chainId = Number(
    Object.entries(KYBER_CHAINS).find(([, name]) => name === slug)?.[0] ?? Number.NaN,
  );
  if (url.pathname.endsWith("/api/v1/routes") && !Number.isNaN(chainId)) {
    return {
      status: 200,
      json: {
        code: 0,
        message: "successfully",
        data: {
          routeSummary: {
            tokenIn: url.searchParams.get("tokenIn"),
            amountIn: url.searchParams.get("amountIn"),
            tokenOut: url.searchParams.get("tokenOut"),
            amountOut: stub.kyberQuotes.toString(),
            route: [],
          },
          routerAddress: KYBER_ROUTER,
        },
      },
    };
  }
  if (url.pathname.endsWith("/api/v1/route/build") && !Number.isNaN(chainId)) {
    const asked = JSON.parse(body ?? "{}") as {
      routeSummary: { tokenIn: Address; tokenOut: Address; amountIn: string; amountOut: string };
      recipient: Address;
      slippageTolerance: number;
    };
    const summary = asked.routeSummary;
    const quoted = BigInt(summary.amountOut);
    const data = encodeFunctionData({
      abi: KyberSwapMetaAggregationRouterABI,
      functionName: "swap",
      args: [
        {
          callTarget: KYBER_ROUTER,
          approveTarget: "0x0000000000000000000000000000000000000000",
          targetData: "0x",
          desc: {
            srcToken: summary.tokenIn,
            dstToken: summary.tokenOut,
            srcReceivers: [KYBER_ROUTER],
            srcAmounts: [BigInt(summary.amountIn)],
            feeReceivers: [],
            feeAmounts: [],
            dstReceiver: asked.recipient,
            amount: BigInt(summary.amountIn),
            minReturnAmount: (quoted * BigInt(10_000 - asked.slippageTolerance)) / 10_000n,
            flags: 0n,
            permit: "0x",
          },
          clientData: "0x",
        },
      ],
    });
    return {
      status: 200,
      json: {
        code: 0,
        message: "successfully",
        data: {
          data,
          routerAddress: KYBER_ROUTER,
          transactionValue: "0",
          amountOut: summary.amountOut,
        },
      },
    };
  }
  if (url.pathname.endsWith("/swap") && url.searchParams.get("embed") === "1") {
    return {
      status: 200,
      json: {
        embed: {
          version: 1,
          compiler: v12DeployedAddresses().compiler,
          chainId: Number(url.searchParams.get("chainId")),
          tokenIn: url.searchParams.get("from"),
          tokenOut: url.searchParams.get("to"),
          program: stub.ecoProgram(),
          entryParams: [
            { name: "amountIn", type: "uint256" },
            { name: "minOut", type: "uint256" },
          ],
        },
      },
    };
  }

  return { status: 404, json: { error: `unknown route ${url.pathname}` } };
}

/** The stub as a `fetch`, recording each URL it was asked. */
export function stubSwapFetch(stub: SwapStub): { fetch: typeof fetch; asked: URL[] } {
  const asked: URL[] = [];
  const stubFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(url);
    const { status, json } = answerSwapApi(
      url,
      typeof init?.body === "string" ? init.body : undefined,
      stub,
    );
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;

  return { fetch: stubFetch, asked };
}
