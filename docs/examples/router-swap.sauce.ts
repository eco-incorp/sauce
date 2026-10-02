import { curve, uniswapV2 } from "@sauce/router";
import { balanceOf } from "@sauce/token";

// Base: sell every WETH the Pot holds on Uniswap V2, then the USDC that returns for crvUSD in
// Curve's 4pool, and keep it. The amounts are only known when this runs.
//
// WETH, USDC and UniswapV2.Factory are the registry's names for Base's. The registry records
// neither crvUSD nor the 4pool, so CRVUSD and CURVE_4POOL are defines, beside the floor MIN_OUT.
function main() {
  const pair = UniswapV2.Factory.getPair(WETH, USDC);
  const sold = balanceOf(WETH, ctx.self());
  const received = uniswapV2(pair, WETH, USDC, sold, 3000n, 0n, ctx.self());
  // USDC is the 4pool's coin 0 and crvUSD its coin 3.
  curve(CURVE_4POOL, USDC, CRVUSD, received, 0n, 3n, false, MIN_OUT, ctx.self());
}
