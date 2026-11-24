// Buys exactly `amountOut` of `tokenOut` with the Pot's `tokenIn` on Uniswap V3's SwapRouter, paying
// no more than `maxIn`, and delivers it to `recipient`. @sauce/router's functions are exact input;
// this is the exact-output swap, which the SwapRouter runs itself. The Pot lets the router pull up to
// `maxIn`, and the pool takes only what the output costs, so the program takes back what is left of
// that allowance before it ends: no allowance outlives the cook. Returns what the swap cost.
//
//   sauce run exact-output.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <tokenIn> <tokenOut> <fee> <amountOut> <maxIn> <recipient>
//
//   tokenIn: Address   the token paid
//   tokenOut: Address  the token bought
//   fee: Uint256       the pool's fee tier, in millionths: 3000 is 0.3%
//   amountOut: Uint256 how much `tokenOut` to deliver, in its smallest units:
//                      100000000000000000 is 0.1 WETH (18 decimals)
//   maxIn: Uint256     the most `tokenIn` to pay, in its smallest units: 400000000000000000000
//                      is 400 DAI (18 decimals). The swap reverts if the output costs more
//   recipient: Address who receives `tokenOut`
//
// On Ethereum, 0.1 WETH bought with at most 400 DAI on the 0.3% pool:
//
//   sauce run exact-output.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 0x6B175474E89094C44Da98b954EedeAC495271d0F 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
//     3000 100000000000000000 400000000000000000000 <recipient>
function main(
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountOut: Uint256,
  maxIn: Uint256,
  recipient: Address,
): Uint256 {
  require(maxIn > 0 && Token(tokenIn).balanceOf(pot) >= maxIn, "maxIn is not in the Pot");

  Token(tokenIn).approve(UniswapV3.SwapRouter, maxIn);
  // A price limit of 0 sets none: `maxIn` is the bound on what the output may cost.
  const spent = UniswapV3.SwapRouter.exactOutputSingle({
    tokenIn,
    tokenOut,
    fee,
    recipient,
    deadline: ctx.timestamp(),
    amountOut,
    amountInMaximum: maxIn,
    sqrtPriceLimitX96: 0,
  });

  // The router pulled `spent` of the `maxIn` it was allowed; withdraw the rest of the allowance.
  Token(tokenIn).approve(UniswapV3.SwapRouter, 0);
  return spent;
}
