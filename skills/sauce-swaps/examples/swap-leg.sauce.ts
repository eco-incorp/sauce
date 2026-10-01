// One guarded swap leg: sell `amountIn` of `tokenIn` on the chain's Uniswap V3 pool at `fee`, never
// past `sqrtPriceLimitX96`. `uniswapV3` swaps through the Pot's Router, pays `recipient` and reverts
// below `minOut`. The pool takes only what it can fill before the limit, so the unspent input goes
// back too, and the Pot ends holding neither token.
//
//   sauce run swap-leg.sauce.ts --chain <chain> --config sauce.config.json --keystore <keystore> \
//     --args <tokenIn> <tokenOut> <fee> <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
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
  const pool = UniswapV3.Factory.getPool(tokenIn, tokenOut, fee);
  require(pool != 0n, "no pool at that fee tier");

  uniswapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient);

  const unspent = Token(tokenIn).balanceOf(ctx.self());
  if (unspent > 0n) {
    Token(tokenIn).transfer(recipient, unspent);
  }
}
