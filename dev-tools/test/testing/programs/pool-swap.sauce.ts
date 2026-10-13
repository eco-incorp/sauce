// Sells `amountIn` of `tokenIn` from the Pot on the Uniswap V3 `pool` for `tokenOut`, sends it to
// `recipient`, and returns how much it bought.
import { uniswapV3 } from "@sauce/router";

function main(
  pool: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  recipient: Address,
): Uint256 {
  return uniswapV3(pool, tokenIn, tokenOut, amountIn, 0, 0, recipient);
}
