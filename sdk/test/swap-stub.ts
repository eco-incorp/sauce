/**
 * A stub of the services `kyberSwap`, `jupiterSwap` and `ecoSwap` ask for routes, answering as
 * each API does: KyberSwap's `GET /{chain}/api/v1/routes` and `POST /{chain}/api/v1/route/build`,
 * its calldata the registry router's `swap(...)` encoded for the sender and recipient asked for;
 * Jupiter's `GET /swap/v1/quote` and `POST /swap/v1/swap-instructions`, a `shared_accounts_route`
 * built for the Pot asked for; and eco-swap's `GET /swap?embed=1`, under the SDK's contract — a
 * program on an EVM chain, an instruction on Solana. Served as a `fetch` (`stubSwapFetch`) or, for
 * the EVM services, behind an HTTP server (`swap-routes.e2e.test.ts`); nothing reaches a network
 * either way.
 */
import { address } from "@solana/kit";
import { encodeFunctionData, type Address, type Hex } from "viem";

import { v12DeployedAddresses } from "../src/deployments/index.js";
import { KyberSwapMetaAggregationRouterABI } from "../src/protocols/kyberswap/abis.js";
import { KYBER_CHAINS } from "../src/routes/swap-apis.js";
import { svmTokenAccount } from "../src/svm/token-accounts.js";
import { TOKEN_PROGRAM_ID } from "../src/svm/token-program.js";
import { JUPITER_AGGREGATOR_PROGRAM_ID } from "../src/svm/venues/jupiter-aggregator/index.js";

const SOLANA = 1399811149;
/** Jupiter's program authority and event authority, as its own answers name them. */
const JUPITER_AUTHORITY = "6U91aKa8pmMxkJwBCfPTmUEfZi6dHe7DcFq2ALvB2tbB";
const JUPITER_EVENTS = "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf";
/** eco-swap's merge program on Solana, as the stub answers: any program id. */
export const ECO_SVM_PROGRAM = "BPFLoaderUpgradeab1e11111111111111111111111";

/** The registry's KyberSwap router: one address on every chain the stub serves. */
export const KYBER_ROUTER: Address = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";

export interface SwapStub {
  /** What KyberSwap quotes, and its router pays. */
  readonly kyberQuotes: bigint;
  /** The program eco-swap answers with. */
  readonly ecoProgram: () => Hex;
  /** What Jupiter quotes, and its instruction states as its quoted output. */
  readonly jupiterQuotes?: bigint;
}

/** The Pot's associated account for `mint`, under SPL Token. */
const potAccount = (mint: string, pot: string): Promise<string> =>
  svmTokenAccount({ mint: address(mint), tokenProgram: TOKEN_PROGRAM_ID }, address(pot));

/** `shared_accounts_route` with an empty route plan, then `in_amount`, `quoted_out_amount`,
 *  `slippage_bps` and `platform_fee_bps`: base64, as Jupiter answers it. */
function sharedAccountsRoute(inAmount: bigint, quotedOut: bigint, slippageBps: number): string {
  const data = new Uint8Array(8 + 1 + 4 + 19);
  data.set([0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81]);
  const view = new DataView(data.buffer);
  view.setBigUint64(13, inAmount, true);
  view.setBigUint64(21, quotedOut, true);
  view.setUint16(29, slippageBps, true);

  return Buffer.from(data).toString("base64");
}

/** Jupiter's two answers, and eco-swap's on Solana: built for the mints and the Pot asked for. */
async function answerSolana(
  url: URL,
  body: string | undefined,
  stub: SwapStub,
): Promise<{ status: number; json: unknown } | undefined> {
  const quoted = stub.jupiterQuotes ?? 834568839n;
  if (url.pathname.endsWith("/swap/v1/quote")) {
    return {
      status: 200,
      json: {
        inputMint: url.searchParams.get("inputMint"),
        inAmount: url.searchParams.get("amount"),
        outputMint: url.searchParams.get("outputMint"),
        outAmount: quoted.toString(),
        slippageBps: Number(url.searchParams.get("slippageBps")),
        swapMode: "ExactIn",
        routePlan: [],
      },
    };
  }
  const meta = (pubkey: string, isWritable = false, isSigner = false) => ({
    pubkey,
    isSigner,
    isWritable,
  });
  if (url.pathname.endsWith("/swap/v1/swap-instructions")) {
    const { quoteResponse: quote, userPublicKey: pot } = JSON.parse(body ?? "{}") as {
      quoteResponse: { inputMint: string; outputMint: string; inAmount: string };
      userPublicKey: string;
    };
    const jupiter = JUPITER_AGGREGATOR_PROGRAM_ID;
    return {
      status: 200,
      json: {
        swapInstruction: {
          programId: jupiter,
          accounts: [
            meta(TOKEN_PROGRAM_ID),
            meta(JUPITER_AUTHORITY),
            meta(pot, false, true),
            meta(await potAccount(quote.inputMint, pot), true),
            meta(await potAccount(quote.inputMint, JUPITER_AUTHORITY), true),
            meta(await potAccount(quote.outputMint, JUPITER_AUTHORITY), true),
            meta(await potAccount(quote.outputMint, pot), true),
            meta(quote.inputMint),
            meta(quote.outputMint),
            meta(jupiter),
            meta(jupiter),
            meta(JUPITER_EVENTS),
            meta(jupiter),
          ],
          data: sharedAccountsRoute(BigInt(quote.inAmount), quoted, 50),
        },
        addressLookupTableAddresses: [],
      },
    };
  }
  if (
    url.pathname.endsWith("/swap") &&
    url.searchParams.get("embed") === "1" &&
    Number(url.searchParams.get("chainId")) === SOLANA
  ) {
    const pot = url.searchParams.get("pot")!;
    return {
      status: 200,
      json: {
        embed: {
          version: 1,
          kind: "instruction",
          chainId: SOLANA,
          tokenIn: url.searchParams.get("from"),
          tokenOut: url.searchParams.get("to"),
          programId: ECO_SVM_PROGRAM,
          accounts: [
            meta(pot, false, true),
            meta(await potAccount(url.searchParams.get("from")!, pot), true),
            meta(await potAccount(url.searchParams.get("to")!, pot), true),
            meta(ECO_SVM_PROGRAM),
          ],
          data: Buffer.alloc(16).toString("base64"),
          offsets: { amountIn: 0, minOut: 8 },
        },
      },
    };
  }

  return undefined;
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

/** The stub as a `fetch`, recording each URL it was asked: every service's answers. */
export function stubSwapFetch(stub: SwapStub): { fetch: typeof fetch; asked: URL[] } {
  const asked: URL[] = [];
  const stubFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(url);
    const body = typeof init?.body === "string" ? init.body : undefined;
    const { status, json } =
      (await answerSolana(url, body, stub)) ?? answerSwapApi(url, body, stub);
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;

  return { fetch: stubFetch, asked };
}
