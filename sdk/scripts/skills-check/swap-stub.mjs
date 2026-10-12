// The services `kyberSwap`, `jupiterSwap` and `ecoSwap` ask for routes, stubbed for the offline
// check: a `fetch` answering KyberSwap's `GET /{chain}/api/v1/routes` and
// `POST /{chain}/api/v1/route/build` (its router's `swap(...)`, encoded with the registry's ABI for
// the recipient asked for), Jupiter's `GET /swap/v1/quote` and `POST /swap/v1/swap-instructions`
// (a `shared_accounts_route` for the Pot asked for) and eco-swap's `GET /swap?embed=1` (a stand-in
// program, or on Solana an instruction, under the SDK's contract). A program that swaps this way
// compiles in the check as it would against the real services; nothing reaches a network.

/** The registry's KyberSwap router, at one address on every chain the check compiles for. */
const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const SOLANA = 1399811149;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
/** Jupiter's program authority and event authority, as its own answers name them. */
const JUPITER_AUTHORITY = "6U91aKa8pmMxkJwBCfPTmUEfZi6dHe7DcFq2ALvB2tbB";
const JUPITER_EVENTS = "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf";
/** eco-swap's merge program, as the stub answers: any program id. */
const ECO_SVM_PROGRAM = "BPFLoaderUpgradeab1e11111111111111111111111";

const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey, isSigner, isWritable });

/** `shared_accounts_route` with an empty route plan, then `in_amount`, `quoted_out_amount`,
 *  `slippage_bps` and `platform_fee_bps`: base64, as Jupiter answers it. */
function sharedAccountsRoute(inAmount, quotedOut) {
  const data = new Uint8Array(8 + 1 + 4 + 19);
  data.set([0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81]);
  const view = new DataView(data.buffer);
  view.setBigUint64(13, inAmount, true);
  view.setBigUint64(21, quotedOut, true);
  view.setUint16(29, 50, true);
  return Buffer.from(data).toString("base64");
}

/**
 * The stub `fetch`. `encodeFunctionData` is viem's, `kyberAbi` the registry's router ABI,
 * `compiler` the version the SDK's programs are compiled by (what an embedded program must state)
 * and `svmTokenAccount` the SDK's, which derives the Pot's token accounts on Solana.
 */
export function swapStub({ encodeFunctionData, kyberAbi, compiler, svmTokenAccount }) {
  const potAccount = (mint, owner) => svmTokenAccount({ mint, tokenProgram: TOKEN_PROGRAM }, owner);
  const answer = async (url, body) => {
    if (url.pathname.endsWith("/swap/v1/quote")) {
      return {
        inputMint: url.searchParams.get("inputMint"),
        inAmount: url.searchParams.get("amount"),
        outputMint: url.searchParams.get("outputMint"),
        outAmount: "1000000",
        swapMode: "ExactIn",
        routePlan: [],
      };
    }
    if (url.pathname.endsWith("/swap/v1/swap-instructions")) {
      const { quoteResponse: quote, userPublicKey: pot } = JSON.parse(body ?? "{}");
      return {
        swapInstruction: {
          programId: JUPITER,
          accounts: [
            meta(TOKEN_PROGRAM),
            meta(JUPITER_AUTHORITY),
            meta(pot, false, true),
            meta(await potAccount(quote.inputMint, pot), true),
            meta(await potAccount(quote.inputMint, JUPITER_AUTHORITY), true),
            meta(await potAccount(quote.outputMint, JUPITER_AUTHORITY), true),
            meta(await potAccount(quote.outputMint, pot), true),
            meta(quote.inputMint),
            meta(quote.outputMint),
            meta(JUPITER),
            meta(JUPITER),
            meta(JUPITER_EVENTS),
            meta(JUPITER),
          ],
          data: sharedAccountsRoute(BigInt(quote.inAmount), BigInt(quote.outAmount)),
        },
        addressLookupTableAddresses: [],
      };
    }
    if (url.pathname.endsWith("/swap") && Number(url.searchParams.get("chainId")) === SOLANA) {
      const pot = url.searchParams.get("pot");
      return {
        embed: {
          version: 1,
          kind: "instruction",
          chainId: SOLANA,
          tokenIn: url.searchParams.get("from"),
          tokenOut: url.searchParams.get("to"),
          programId: ECO_SVM_PROGRAM,
          accounts: [
            meta(pot, false, true),
            meta(await potAccount(url.searchParams.get("from"), pot), true),
            meta(await potAccount(url.searchParams.get("to"), pot), true),
            meta(ECO_SVM_PROGRAM),
          ],
          data: Buffer.alloc(16).toString("base64"),
          offsets: { amountIn: 0, minOut: 8 },
        },
      };
    }
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
      JSON.stringify(await answer(url, typeof init?.body === "string" ? init.body : undefined)),
    );
  };
}
