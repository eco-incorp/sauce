// The services `kyberSwap` and `ecoSwap` ask for routes, stubbed for the offline check: a `fetch`
// answering KyberSwap's `GET /{chain}/api/v1/routes` and `POST /{chain}/api/v1/route/build` (its
// router's `swap(...)`, encoded with the registry's ABI for the recipient asked for) and eco-swap's
// `GET /swap?embed=1` (a stand-in program under the SDK's contract). A program that swaps this way
// compiles in the check as it would against the real services; nothing reaches a network.

/** The registry's KyberSwap router, at one address on every chain the check compiles for. */
const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";

/**
 * The stub `fetch`. `encodeFunctionData` is viem's, `kyberAbi` the registry's router ABI and
 * `compiler` the version the SDK's programs are compiled by: what an embedded program must state.
 */
export function swapStub({ encodeFunctionData, kyberAbi, compiler }) {
  const answer = (url, body) => {
    if (url.pathname.endsWith("/api/v1/routes")) {
      return {
        code: 0,
        data: {
          routeSummary: {
            tokenIn: url.searchParams.get("tokenIn"),
            amountIn: url.searchParams.get("amountIn"),
            tokenOut: url.searchParams.get("tokenOut"),
            amountOut: "1000000",
            route: [],
          },
          routerAddress: ROUTER,
        },
      };
    }
    if (url.pathname.endsWith("/api/v1/route/build")) {
      const { routeSummary: summary, recipient } = JSON.parse(body ?? "{}");
      const data = encodeFunctionData({
        abi: kyberAbi,
        functionName: "swap",
        args: [
          {
            callTarget: ROUTER,
            approveTarget: "0x0000000000000000000000000000000000000000",
            targetData: "0x",
            desc: {
              srcToken: summary.tokenIn,
              dstToken: summary.tokenOut,
              srcReceivers: [],
              srcAmounts: [],
              feeReceivers: [],
              feeAmounts: [],
              dstReceiver: recipient,
              amount: BigInt(summary.amountIn),
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
        compiler,
        chainId: Number(url.searchParams.get("chainId")),
        tokenIn: url.searchParams.get("from"),
        tokenOut: url.searchParams.get("to"),
        program: "0x00",
        entryParams: [
          { name: "amountIn", type: "uint256" },
          { name: "minOut", type: "uint256" },
        ],
      },
    };
  };

  return async (input, init) => {
    const url = new URL(String(input));
    return new Response(
      JSON.stringify(answer(url, typeof init?.body === "string" ? init.body : undefined)),
    );
  };
}
