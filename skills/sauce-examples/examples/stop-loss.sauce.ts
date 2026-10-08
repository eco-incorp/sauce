// A stop-loss and take-profit on the Pot's WETH, to run on a schedule: reads Chainlink's ETH/USD
// price, refuses a stale one, and when it is at or below `stop` or at or above `takeProfit` sells
// the Pot's WETH for USDC on the Uniswap V3 0.05% pool, every unit at no less than the oracle's
// price less `maxSlippageBps`, after the pool's fee. Between the two it sells nothing and does not
// fail; what the pool cannot take at that price stays in the Pot, with the USDC. Returns the
// oracle's price, whether it triggered, and the WETH sold and USDC received.
// The USDC received stays in the Pot on purpose (the swap's recipient is the Pot), beside any WETH
// left; a later cook sends it to the wallet.
//
//   sauce run stop-loss.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <stop> <takeProfit> <maxSlippageBps> <maxAge>
//
//   stop: Uint256            sell at or below this ETH price, in the feed's units (USD with 8
//                            decimals): 240000000000 is 2,400 USD; 0 sets no stop
//   takeProfit: Uint256      sell at or above this ETH price, in the same units: 320000000000 is
//                            3,200 USD; 0 sets none
//   maxSlippageBps: Uint256  how far below the oracle's price a unit may sell, fee included, in
//                            hundredths of a percent: 100 is 1%
//   maxAge: Uint256          the oldest price to act on, in seconds: 3600 is an hour
//
// On Ethereum, sell below 2,400 USD or above 3,200 USD, within 1% of the oracle:
//
//   sauce run stop-loss.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 240000000000 320000000000 100 3600
import { uniswapV3 } from "@sauce/router";

function main(
  stop: Uint256,
  takeProfit: Uint256,
  maxSlippageBps: Uint256,
  maxAge: Uint256,
): { price: Uint256; triggered: bool; sold: Uint256; received: Uint256 } {
  require(maxSlippageBps < 10000, "maxSlippageBps is 100% or more");
  const round = Chainlink.EthUsdFeed.latestRoundData();
  const price = round.answer; // USD per ETH, 8 decimals
  require(price > 0, "no price");
  require(ctx.timestamp() - round.updatedAt <= maxAge, "the price is stale");

  const triggered = (stop > 0 && price <= stop) || (takeProfit > 0 && price >= takeProfit);
  const held = WETH.balanceOf(ctx.self());
  if (!triggered || held == 0) {
    return { price, triggered, sold: 0, received: 0 };
  }

  // The least a unit may fetch, in USDC base units per WETH: the feed's 8 decimals become USDC's 6.
  const floor = Math.mulDiv(price, 10000 - maxSlippageBps, 10000 * 100);
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  require(pool != 0, "no WETH/USDC pool at 0.05%");
  // `floor` as the pool's sqrt price (token1 per token0, times 2^96), moved by √(1 − fee) so the
  // last unit sold fetches `floor` once the fee is paid. Selling token0 pushes the price down,
  // token1 pushes it up: the swap stops at the limit either way.
  const root = Math.sqrt((1000000 - UniswapV3.Pool(pool).fee()) * 10 ** 30); // √(1 − fee), × 1e18
  const wethIs0 = WETH < USDC;
  const limit = wethIs0
    ? Math.mulDiv(Math.sqrt(Math.mulDiv(floor, 1 << 192, 10 ** 18)), 10 ** 18, root)
    : Math.mulDiv(Math.sqrt(Math.mulDiv(1 << 192, 10 ** 18, floor)), root, 10 ** 18);
  // A pool already past the limit has no unit to sell at that price: nothing sells this time.
  const now = UniswapV3.Pool(pool).slot0().sqrtPriceX96;
  if (wethIs0 ? now <= limit : now >= limit) {
    return { price, triggered, sold: 0, received: 0 };
  }
  // The limit decides how much sells, so no minimum is known before the swap; the average is held
  // to the floor after it.
  const received = uniswapV3(pool, WETH, USDC, held, limit, 0, ctx.self());
  const sold = held - WETH.balanceOf(ctx.self());
  require(received >= Math.mulDiv(sold, floor, 10 ** 18), "sold below the floor");
  return { price, triggered, sold, received };
}
