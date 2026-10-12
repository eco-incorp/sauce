// KyberSwap's own example of its aggregator API, as one Sauce program.
//
// Ported from: github.com/KyberNetwork/ks-aggregator-api-demo (src/operations/V1Swap.ts, with
// src/apis/V1Get.ts and src/apis/V1Post.ts), the example KyberSwap's docs give for executing a swap
// with the aggregator API. It sells 1 USDC.e for KNC on Polygon from a wallet, in four steps:
//
//   1. GET /{chain}/api/v1/routes         a route for tokenIn, tokenOut and amountIn
//   2. POST /{chain}/api/v1/route/build   the router's calldata for that route: the wallet as sender
//                                         and recipient, 0.1% slippage off the quote
//   3. approve                            a signed transaction: the router may pull amountIn
//   4. swap                               a signed transaction to the router, with the calldata
//
// Two API calls and two transactions, each signed and sent on its own; an approval the swap leaves
// unused stays standing.
//
// Here the same swap, 1 USDC for WETH with the registry's tokens, is one program the Pot runs in one
// transaction. `kyberSwap` asks the same two endpoints while the program compiles, the route built
// for the Pot. As the program runs, the Pot approves the router for exactly amountIn, the router's
// floor is `minOut` (an input, rather than a slippage off the quote), what reached the Pot is
// measured, and whatever approval is left is reset. A route expires twenty minutes after it is
// built, so compile close to running.
//
//   sauce run kyberswap-swap.sauce.ts --chain <chain> --keystore <keystore> --fund USDC:1 \
//     --args <minOut> <recipient>
//
//   minOut: Uint256     the least WETH to accept, in its smallest units (18 decimals):
//                       300000000000000 is 0.0003 WETH; below it the whole transaction reverts
//   recipient: Address  who receives the WETH, the demo's wallet
//
// On Base, at least 0.0003 WETH for the 1 USDC the Pot is funded with:
//
//   sauce run kyberswap-swap.sauce.ts --chain base --keystore <keystore> --fund USDC:1 \
//     --args 300000000000000 <recipient>
function main(minOut: Uint256, recipient: Address): Uint256 {
  const out = kyberSwap(USDC, WETH, 1000000, minOut);
  WETH.transfer(recipient, out);
  return out;
}
