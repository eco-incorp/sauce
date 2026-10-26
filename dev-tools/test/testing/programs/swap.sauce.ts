// Sells `amountIn` USDC from the Pot for WETH on the chain's Uniswap V3 0.05% pool, sends the WETH
// to `recipient`, and returns how much it bought; below `minOut` the whole cook reverts.
import { uniswapV3 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256, recipient: Address): Uint256 {
  require(USDC.balanceOf(pot) >= amountIn, "amountIn is not in the Pot");
  const pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
  require(pool != 0, "no USDC/WETH 0.05% pool");
  return uniswapV3(pool, USDC, WETH, amountIn, 0, minOut, recipient);
}
