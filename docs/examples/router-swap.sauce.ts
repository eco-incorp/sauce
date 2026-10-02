import { curve, uniswapV2 } from "@sauce/router";
import { balanceOf } from "@sauce/token";

// Ethereum: sell every WETH the Pot holds on Uniswap V2, then the USDC that returns for USDT in
// Curve's 3pool, and keep it. The tokens, the factory and the pool are the registry's names; the
// amounts are only known when this runs.
//
//   sauce run router-swap.sauce.ts --chain ethereum --config sauce.config.json \
//     --keystore <keystore> --args <minOut>
//
//   minOut: Uint256   the least USDT to keep, in its smallest units (6 decimals): below it the
//                     whole transaction reverts
function main(minOut: Uint256) {
  const pair = UniswapV2.Factory.getPair(WETH, USDC);
  const sold = balanceOf(WETH, ctx.self());
  const received = uniswapV2(pair, WETH, USDC, sold, 3000n, 0n, ctx.self());
  // USDC is the 3pool's coin 1 and USDT its coin 2.
  curve(Curve.ThreePool, USDC, USDT, received, 1n, 2n, false, minOut, ctx.self());
}
