// One guarded swap leg: sell `amountIn` of `tokenIn` on the chain's Uniswap V3 pool at `fee`, never
// past `sqrtPriceLimitX96`. The pool takes only what it can fill before the limit, and the Router's
// callback pays exactly that. The output is measured as a balance delta and checked against
// `minOut`, and the rest of `amountIn` goes back with it. Only this trade's tokens move: what else
// the Pot holds stays there.
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

  const inBefore = Token(tokenIn).balanceOf(self);
  require(inBefore >= amountIn, "amountIn is not in the Pot");
  const outBefore = Token(tokenOut).balanceOf(self);
  // A positive amountSpecified is exact input on this entry point.
  ISauceRouter.at(self).swapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, self, self);
  const out = Token(tokenOut).balanceOf(self) - outBefore;
  require(out >= minOut, "fill below minOut");

  Token(tokenOut).transfer(recipient, out);
  // The rest of amountIn: what the pool did not take. Not the Pot's whole balance, which may hold
  // more of the token for other uses.
  const unspent = amountIn - (inBefore - Token(tokenIn).balanceOf(self));
  if (unspent > 0n) {
    Token(tokenIn).transfer(recipient, unspent);
  }
}
