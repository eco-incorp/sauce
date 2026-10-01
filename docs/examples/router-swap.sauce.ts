import { curve, uniswapV2 } from "@sauce/router";
import { balanceOf } from "@sauce/token";

// Base: sell every WETH the Pot holds on Uniswap V2, then the USDC that returns for crvUSD in
// Curve's 4pool, and keep it. The amounts are only known when this runs; MIN_OUT is a define.
function main() {
  const weth = 0x4200000000000000000000000000000000000006n;
  const usdc = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n;
  const crvusd = 0x417ac0e078398c154edfadd9ef675d30be60af93n;
  const pair = 0x88a43bbdf9d098eec7bceda4e2494615dfd9bb9cn; // Uniswap V2 WETH/USDC
  const fourPool = 0xf6c5f01c7f3148891ad0e19df78743d31e390d1fn; // USDC is coin 0, crvUSD 3

  const sold = balanceOf(weth, ctx.self());
  const received = uniswapV2(pair, weth, usdc, sold, 3000n, 0n, ctx.self());
  curve(fourPool, usdc, crvusd, received, 0n, 3n, false, MIN_OUT, ctx.self());
}
