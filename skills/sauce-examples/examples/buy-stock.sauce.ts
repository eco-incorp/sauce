// Buys SpaceX stock (SPCXon, Ondo's tokenized SpaceX) with up to `budget` USDC from the Pot, from
// the one Uniswap V3 pool of the pair that sells a share cheapest once its fee is paid, and never
// above `maxPrice` a share, fee included. The pool fills only up to that price; the shares go to
// `recipient` and the budget it leaves to `refundTo`. Returns the pool's fee tier, the USDC spent
// and the shares bought.
//
//   sauce run buy-stock.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <budget> <maxPrice> <minShares> <recipient> <refundTo>
//
//   budget: Uint256      the most USDC to spend, in its base units (6 decimals): 1000000000 is
//                        1,000 USDC; the Pot must hold it
//   maxPrice: Uint256    the most one share may cost, fee included, in USDC base units:
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

const ONE_SHARE = 1000000000000000000n; // SPCXon has 18 decimals

// What one whole share costs, in USDC base units, at a pool's sqrt price (token1 per token0, times
// 2^96). The lower address of the pair is the pool's token0.
function sharePrice(sqrtPriceX96: Uint256): Uint256 {
  const ratio = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1n << 96n); // token1 per token0, × 2^96
  return USDC < SPCXon
    ? Math.mulDiv(ONE_SHARE, 1n << 96n, ratio)
    : Math.mulDiv(ratio, ONE_SHARE, 1n << 96n);
}

function main(
  budget: Uint256,
  maxPrice: Uint256,
  minShares: Uint256,
  recipient: Address,
  refundTo: Address,
): { fee: Uint256; spent: Uint256; shares: Uint256 } {
  const self = ctx.self();
  require(maxPrice > 0n, "maxPrice is 0");
  const before = USDC.balanceOf(self);
  require(before >= budget, "budget is not in the Pot");

  // Every fee tier the factory has, and the cheapest share among the pools with liquidity.
  let pool = 0n;
  let fee = 0n;
  let cheapest = 0n;
  for (const tier of [100n, 500n, 3000n, 10000n]) {
    const candidate = UniswapV3.Factory.getPool(USDC, SPCXon, tier);
    if (candidate == 0n || UniswapV3.Pool(candidate).liquidity() == 0n) {
      continue;
    }
    // The price a buyer pays there: the pool's price with its fee on top.
    const price = sharePrice(UniswapV3.Pool(candidate).slot0().sqrtPriceX96);
    const paid = Math.mulDiv(price, 1000000n, 1000000n - tier);
    if (pool == 0n || paid < cheapest) {
      pool = candidate;
      fee = tier;
      cheapest = paid;
    }
  }
  require(pool != 0n, "no SPCXon/USDC pool with liquidity");
  require(cheapest <= maxPrice, "every pool is above maxPrice");

  // The pool's price at which a share, with the fee on top, costs maxPrice, as its sqrt price:
  // the swap stops there. Paying token0 pushes the price down, token1 pushes it up.
  const atLimit = Math.mulDiv(maxPrice, 1000000n - fee, 1000000n);
  const limit =
    USDC < SPCXon
      ? Math.sqrt(Math.mulDiv(1n << 192n, ONE_SHARE, atLimit))
      : Math.sqrt(Math.mulDiv(atLimit, 1n << 192n, ONE_SHARE));
  const shares = uniswapV3(pool, USDC, SPCXon, budget, limit, minShares, recipient);

  // What the pool took; the rest of the budget goes back. The Pot's other USDC stays.
  const spent = before - USDC.balanceOf(self);
  if (budget > spent) {
    USDC.transfer(refundTo, budget - spent);
  }
  return { fee, spent, shares };
}
