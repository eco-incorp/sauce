// Buys SpaceX stock (SPCXon, Ondo's tokenized SpaceX) with up to `budget` USDC from the Pot, from
// the one Uniswap V3 pool of the pair that sells a share cheapest once its fee is paid, and never
// above `priceLimit` a share, fee included. The pool fills only up to that price; the shares go to
// `recipient` and the budget it leaves to `refundTo`. Returns the pool's fee tier, the USDC spent
// and the shares bought.
//
//   sauce run buy-stock.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <budget> <priceLimit> <minShares> <recipient> <refundTo>
//
//   budget: Uint256      the most USDC to spend, in its base units (6 decimals): 1000000000 is
//                        1,000 USDC; the Pot must hold it
//   priceLimit: Uint256  the most one share may cost, fee included, in USDC base units:
//                        150000000 is 150 USDC
//   minShares: Uint256   the fewest shares to accept, in SPCXon base units (18 decimals):
//                        5000000000000000000 is 5 shares; fewer reverts the whole cook
//   recipient: Address   receives the shares
//   refundTo: Address    receives the USDC the pool did not take
//
// On Ethereum, up to 1,000 USDC of SpaceX at no more than 150 USDC a share, at least 5 shares:
//
//   sauce run buy-stock.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 1000000000 150000000 5000000000000000000 <recipient> <refundTo>
import { uniswapV3 } from "@sauce/router";

const ONE_SHARE = 1000000000000000000; // SPCXon has 18 decimals

function main(
  budget: Uint256,
  priceLimit: Uint256,
  minShares: Uint256,
  recipient: Address,
  refundTo: Address,
): { fee: Uint256; spent: Uint256; shares: Uint256 } {
  const self = ctx.self();
  require(priceLimit > 0, "priceLimit is 0");
  const before = self.USDC;
  require(before >= budget, "budget is not in the Pot");

  // Every fee tier the factory has, and the cheapest share among the pools with liquidity.
  let pool: Address = 0;
  let fee: Uint256 = 0;
  let cheapest: Uint256 = 0;
  for (const tier of [100, 500, 3000, 10000]) {
    const candidate = UniswapV3.Factory.getPool(USDC, SPCXon, tier);
    if (candidate == 0 || UniswapV3.Pool(candidate).liquidity() == 0) {
      continue;
    }
    // What a share costs there in USDC base units, from the pool's sqrt price (token1 per token0,
    // times 2^96; the lower address of the pair is token0), and with the pool's fee on top.
    const sqrtPriceX96 = UniswapV3.Pool(candidate).slot0().sqrtPriceX96;
    const ratio = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96);
    const price =
      USDC < SPCXon
        ? Math.mulDiv(ONE_SHARE, 1 << 96, ratio)
        : Math.mulDiv(ratio, ONE_SHARE, 1 << 96);
    const paid = Math.mulDiv(price, 1000000, 1000000 - tier);
    if (pool == 0 || paid < cheapest) {
      pool = candidate;
      fee = tier;
      cheapest = paid;
    }
  }
  require(pool != 0, "no SPCXon/USDC pool with liquidity");
  require(cheapest <= priceLimit, "every pool is above priceLimit");

  // The pool's price at which a share, with the fee on top, costs priceLimit, as its sqrt price:
  // the swap stops there. Paying token0 pushes the price down, token1 pushes it up.
  const atLimit = Math.mulDiv(priceLimit, 1000000 - fee, 1000000);
  const limit =
    USDC < SPCXon
      ? Math.sqrt(Math.mulDiv(1 << 192, ONE_SHARE, atLimit))
      : Math.sqrt(Math.mulDiv(atLimit, 1 << 192, ONE_SHARE));
  const shares = uniswapV3(pool, USDC, SPCXon, budget, limit, minShares, recipient);

  // What the pool took; the rest of the budget goes back. The Pot's other USDC stays.
  const spent = before - self.USDC;
  if (budget > spent) {
    USDC.transfer(refundTo, budget - spent);
  }
  return { fee, spent, shares };
}
