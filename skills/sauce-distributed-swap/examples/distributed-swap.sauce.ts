// A limit buy spread over the chain's Uniswap V3 and Aerodrome Slipstream pools: spends up to
// `budget` of `payToken` on `buyToken`, never paying more than `maxPrice` for any unit, fees
// included. Returns abi.encode(spent, bought, unspent).
//
//   sauce run distributed-swap.sauce.ts --chain <chain> --config sauce.config.json \
//     --keystore <keystore> --fund <payToken>:<budget> \
//     --args <payToken> <buyToken> <budget> <maxPrice> <minTokens> <maxAvgPrice> \
//     <recipient> <refundTo>
//
//   payToken     Address  the token paid; the budget must be in the Pot (`--fund` pulls it in)
//   buyToken     Address  the token bought
//   budget       Uint256  the most payToken to spend, in its base units: 1000000000 is 1,000 USDC
//   maxPrice     Uint256  the most one buyToken may cost, fees included, as payToken base units per
//                         buyToken base unit times 1e18: the price in whole tokens times
//                         10^(18 + payDecimals - buyDecimals), so 150 USDC (6 decimals) for an
//                         8-decimal token is 150 × 10^16 = 1500000000000000000
//   minTokens    Uint256  the least buyToken to receive, in its base units; less reverts the cook
//   maxAvgPrice  Uint256  the most the average may cost, in maxPrice's units; 0 turns it off
//   recipient    Address  receives what is bought
//   refundTo     Address  receives what is left of the budget
//
//   Buying an 8-decimal token on Base with up to 1,000 USDC, at most 150 USDC each:
//   sauce run distributed-swap.sauce.ts --chain base --config sauce.config.json \
//     --keystore <keystore> --fund USDC:1000 \
//     --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 <buyToken> 1000000000 \
//     1500000000000000000 0 0 <recipient> <refundTo>
import { uniswapV3 } from "@sauce/router";

// A pool's own limit: the caller's sqrt price moved by √(1 − fee), so that the pool's last unit,
// fee paid, costs exactly maxPrice. Paying token0 pushes the price down, token1 pushes it up.
function poolLimit(limit: Uint256, fee: Uint256, paysToken0: bool): Uint256 {
  const root = Math.sqrt((1000000n - fee) * 10n ** 30n); // √(1 − fee), times 1e18
  if (paysToken0) {
    return Math.mulDiv(limit, 10n ** 18n, root);
  }
  return Math.mulDiv(limit, root, 10n ** 18n);
}

// Whether a pool's price is still better than its own limit.
function canTrade(price: Uint256, own: Uint256, paysToken0: bool): bool {
  if (paysToken0) {
    return price > own;
  }
  return price < own;
}

function main(
  payToken: Address,
  buyToken: Address,
  budget: Uint256,
  maxPrice: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
  refundTo: Address,
): bytes {
  const self = ctx.self();
  const pay = Token(payToken);
  require(maxPrice > 0n, "maxPrice is 0");
  require(pay.balanceOf(self) >= budget, "budget is not in the Pot");
  const kept = pay.balanceOf(self) - budget; // the Pot's other payToken, never spent
  const paysToken0 = payToken < buyToken;
  let bought = 0n;

  // maxPrice as a pool's sqrt price (token1 per token0, times 2^96): where a unit costs maxPrice.
  let limit = Math.sqrt(Math.mulDiv(maxPrice, 1n << 192n, 10n ** 18n));
  if (paysToken0) {
    limit = Math.sqrt(Math.mulDiv(1n << 192n, 10n ** 18n, maxPrice));
  }

  // Uniswap V3: one pool per fee tier. Skip it if missing, empty or already past its own limit;
  // otherwise offer it everything unspent, and its limit stops it.
  for (const fee of [100n, 500n, 3000n, 10000n]) {
    const pool = UniswapV3.Factory.getPool(payToken, buyToken, fee);
    const unspent = pay.balanceOf(self) - kept;
    if (pool != 0n && unspent > 0n && UniswapV3.Pool.at(pool).liquidity() > 0n) {
      const own = poolLimit(limit, fee, paysToken0);
      if (canTrade(UniswapV3.Pool.at(pool).slot0().sqrtPriceX96, own, paysToken0)) {
        bought += uniswapV3(pool, payToken, buyToken, unspent, own, 0n, recipient);
      }
    }
  }

  // Aerodrome Slipstream: one pool per tick spacing, the same way. A pool's fee is its own.
  for (const spacing of [1n, 10n, 50n, 80n, 100n, 150n, 200n, 500n, 2000n]) {
    const pool = AerodromeSlipstream.CLFactoryGaugesV3.getPool(payToken, buyToken, spacing);
    const unspent = pay.balanceOf(self) - kept;
    if (pool != 0n && unspent > 0n && AerodromeSlipstream.Pool.at(pool).liquidity() > 0n) {
      const own = poolLimit(limit, AerodromeSlipstream.Pool.at(pool).fee(), paysToken0);
      if (canTrade(AerodromeSlipstream.Pool.at(pool).slot0().sqrtPriceX96, own, paysToken0)) {
        bought += uniswapV3(pool, payToken, buyToken, unspent, own, 0n, recipient);
      }
    }
  }

  // Settle: what was bought is already with the recipient; what is left of the budget goes back.
  const unspent = pay.balanceOf(self) - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0n || spent * 10n ** 18n <= maxAvgPrice * bought, "average too high");
  if (unspent > 0n) {
    pay.transfer(refundTo, unspent);
  }
  return abi.encode(spent, bought, unspent);
}
