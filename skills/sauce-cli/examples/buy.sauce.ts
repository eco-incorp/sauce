#!/usr/bin/env -S npx -y @eco-incorp/sauce simulate
// Buys `token` with up to `budget` of the Pot's USDC on the chain's Uniswap V3 pools: on the one with
// the most liquidity among those whose price has not reached `sqrtPriceLimitX96`, and never past that
// price. Reverts unless at least `minOut` reaches `recipient`, who also gets back what the limit
// leaves of the budget; the Pot's other USDC stays. Returns the pool, what it spent and bought.
//
//   sauce run buy.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <token> <budget> <sqrtPriceLimitX96> <minOut> <recipient>
//
//   token: Address              the token bought
//   budget: Uint256             the most USDC to spend, in its smallest units (6 decimals):
//                               100000000 is 100 USDC
//   sqrtPriceLimitX96: Uint256  the pool price past which nothing more is bought, as the pool
//                               states it: `sauce price` turns 2,700 USDC per WETH into it
//   minOut: Uint256             the least `token` to accept, in its smallest units:
//                               37000000000000000 is 0.037 WETH (18 decimals)
//   recipient: Address          who receives what is bought, and the unspent USDC
//
// On Base, WETH for up to 100 USDC, at no more than 2,700 USDC per WETH and at least 0.037 WETH:
//
//   sauce run buy.sauce.ts --chain base --wallet <name> --password-env <NAME> \
//     --args 0x4200000000000000000000000000000000000006 100000000 4116816085950893928074568 \
//     37000000000000000 <recipient>
import { uniswapV3 } from "@sauce/router";

function main(
  token: Address,
  budget: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  recipient: Address,
): { pool: Address; spent: Uint256; bought: Uint256 } {
  const self = ctx.self();
  // Paying USDC lowers a pool's price where USDC is its token0 (the lower address) and raises it
  // where USDC is its token1, so a pool can still trade while its price is on the far side.
  const usdcIsToken0 = USDC < token;

  // The pool with the most liquidity at its price, of the four fee tiers', that can still trade.
  let pool = 0n;
  let deepest = 0n;
  for (const fee of [100n, 500n, 3000n, 10000n]) {
    const candidate = UniswapV3.Factory.getPool(USDC, token, fee);
    if (candidate != 0n) {
      const price = UniswapV3.Pool(candidate).slot0().sqrtPriceX96;
      const liquidity = UniswapV3.Pool(candidate).liquidity();
      const room = usdcIsToken0 ? price > sqrtPriceLimitX96 : price < sqrtPriceLimitX96;
      if (room && liquidity > deepest) {
        pool = candidate;
        deepest = liquidity;
      }
    }
  }
  require(pool != 0n, "no pool of USDC and this token has liquidity short of the limit");
  const before = USDC.balanceOf(self);
  require(before >= budget, "the budget is not in the Pot");

  const bought = uniswapV3(pool, USDC, token, budget, sqrtPriceLimitX96, 0n, recipient);
  require(bought >= minOut, "bought less than minOut");

  // What the pool took, measured; the rest of the budget goes to the recipient too.
  const spent = before - USDC.balanceOf(self);
  if (spent < budget) {
    USDC.transfer(recipient, budget - spent);
  }
  return { pool, spent, bought };
}
