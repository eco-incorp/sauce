// One guarded swap leg: sell `amountIn` of `tokenIn` on the chain's Uniswap V3 pool at `fee`, never
// past `sqrtPriceLimitX96`. `uniswapV3` swaps through the Pot's Router, pays `recipient` and reverts
// below `minOut`. The pool takes only what it can fill before the limit, so the rest of `amountIn`
// goes back too. Only this trade's tokens move: what else the Pot holds stays there.
//
//   sauce run swap-leg.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <tokenIn> <tokenOut> <fee> <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
//
//   tokenIn: Address            the token sold
//   tokenOut: Address           the token bought
//   fee: Uint256                the pool's fee tier, in millionths: 500 is 0.05%
//   amountIn: Uint256           how much `tokenIn` to sell, in its smallest units:
//                               100000000000000000 is 0.1 WETH (18 decimals)
//   sqrtPriceLimitX96: Uint256  the pool price past which nothing more is sold, as the pool
//                               states it (`sauce price` turns "2500 USDC per WETH" into it)
//   minOut: Uint256             the least `tokenOut` to accept, in its smallest units:
//                               249000000 is 249 USDC (6 decimals)
//   recipient: Address          who receives `tokenOut` and the unsold `tokenIn`
//
// On Base, 0.1 WETH sold for USDC on the 0.05% pool, no lower than 2,500 USDC per WETH:
//
//   sauce run swap-leg.sauce.ts --chain base --keystore <keystore> \
//     --args 0x4200000000000000000000000000000000000006 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
//     500 100000000000000000 3961408125713216879677197 249000000 <recipient>
import { uniswapV3 } from "@sauce/router";

function main(
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountIn: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  recipient: Address,
) {
  const self = ctx.self();
  const pool = UniswapV3.Factory.getPool(tokenIn, tokenOut, fee);
  require(pool != 0n, "no pool at that fee tier");
  const inBefore = Token(tokenIn).balanceOf(self);
  require(inBefore >= amountIn, "amountIn is not in the Pot");

  uniswapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient);

  // The rest of amountIn: what the pool did not take. Not the Pot's whole balance, which may hold
  // more of the token for other uses.
  const unspent = amountIn - (inBefore - Token(tokenIn).balanceOf(self));
  if (unspent > 0n) {
    Token(tokenIn).transfer(recipient, unspent);
  }
}
