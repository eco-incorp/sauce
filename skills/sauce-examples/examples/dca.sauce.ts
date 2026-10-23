// One tick of a dollar-cost-averaging plan, to run on a schedule (hourly, daily): buys WETH with
// `tranche` USDC from the Pot on the Uniswap V3 0.05% pool while WETH costs at most `priceLimit`,
// fee included. Above that price, or with less than a tranche in the Pot, it buys nothing and does
// not fail, so a skipped tick costs only gas. The pool fills only up to `priceLimit`: the USDC it
// leaves stays in the Pot for the next tick, beside the WETH bought. Returns the pool's price
// before the tick, and the USDC spent and WETH bought.
// The WETH bought stays in the Pot on purpose (the swap's recipient is the Pot): the plan
// accumulates there, and a later cook sends it to the wallet.
//
//   sauce run dca.sauce.ts --chain <chain> --keystore <keystore> --args <tranche> <priceLimit>
//
//   tranche: Uint256     the USDC to spend per tick, in its base units (6 decimals): 250000000
//                        is 250 USDC
//   priceLimit: Uint256  the most one WETH may cost, fee included, in USDC base units: 2800000000
//                        is 2,800 USDC
//
// On Base, 250 USDC a tick while WETH costs at most 2,800 USDC:
//
//   sauce run dca.sauce.ts --chain base --keystore <keystore> --args 250000000 2800000000
import { uniswapV3 } from "@sauce/router";

function main(
  tranche: Uint256,
  priceLimit: Uint256,
): { price: Uint256; spent: Uint256; bought: Uint256 } {
  require(tranche > 0 && priceLimit > 0, "set tranche and priceLimit");
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  require(pool != 0, "no WETH/USDC pool at 0.05%");
  const fee = UniswapV3.Pool(pool).fee();

  // The pool's price in USDC base units per WETH, from its sqrt price (token1 per token0, × 2^96).
  const sqrtPriceX96 = UniswapV3.Pool(pool).slot0().sqrtPriceX96;
  const ratio = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96);
  const price =
    WETH < USDC ? Math.mulDiv(ratio, 10 ** 18, 1 << 96) : Math.mulDiv(10 ** 18, 1 << 96, ratio);
  const usdc = pot.USDC;
  // Wait for a better price, or for the next tranche to arrive.
  if (Math.mulDiv(price, 1000000, 1000000 - fee) > priceLimit || usdc < tranche) {
    return { price, spent: 0, bought: 0 };
  }

  // The pool's price at which WETH, with the fee on top, costs priceLimit, as its sqrt price: the
  // swap stops there. Paying token1 pushes the price up, token0 pushes it down.
  const atLimit = Math.mulDiv(priceLimit, 1000000 - fee, 1000000);
  const limit =
    WETH < USDC
      ? Math.sqrt(Math.mulDiv(atLimit, 1 << 192, 10 ** 18))
      : Math.sqrt(Math.mulDiv(1 << 192, 10 ** 18, atLimit));
  // The limit decides how much is bought, so no minimum is known before the swap; the average is
  // held to priceLimit after it.
  const bought = uniswapV3(pool, USDC, WETH, tranche, limit, 0, pot);
  const spent = usdc - pot.USDC;
  require(Math.mulDiv(bought, priceLimit, 10 ** 18) >= spent, "paid more than priceLimit");
  return { price, spent, bought };
}
