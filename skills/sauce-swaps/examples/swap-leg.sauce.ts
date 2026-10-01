// One guarded swap leg: sell `amountIn` of `tokenIn` on the chain's Uniswap V3 pool at `fee`, never
// past `sqrtPriceLimitX96`. The pool takes only what it can fill before the limit, and the Router's
// callback pays exactly that. The output is measured as a balance delta and checked against
// `minOut`, and the unspent input goes back, so the Pot ends holding neither token.
//
//   sauce run swap-leg.sauce.ts --chain <chain> --config sauce.config.json --keystore <keystore> \
//     --args <tokenIn> <tokenOut> <fee> <amountIn> <sqrtPriceLimitX96> <minOut> <recipient>
import { ISauceRouter } from "./artifacts/ISauceRouter.json";

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

  const outBefore = Token(tokenOut).balanceOf(self);
  // A positive amountSpecified is exact input on this entry point.
  ISauceRouter.at(self).swapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, self, self);
  const out = Token(tokenOut).balanceOf(self) - outBefore;
  require(out >= minOut, "fill below minOut");

  Token(tokenOut).transfer(recipient, out);
  const unspent = Token(tokenIn).balanceOf(self);
  if (unspent > 0n) {
    Token(tokenIn).transfer(recipient, unspent);
  }
}
