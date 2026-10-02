// Reads the price of ETH in USDC everywhere a program on Ethereum can see it, and changes nothing:
// Chainlink's ETH/USD feed, the Uniswap V3 WETH/USDC pools at 0.05% and 0.3%, and the Uniswap V2
// pair. Returns each price in USDC base units per WETH (6 decimals: 2690000000 is 2,690 USDC), the
// widest gap between the three pools and the gap between the 0.05% pool and the oracle, each in
// hundredths of a percent. Run it with `sauce simulate`: nothing is sent.
//
//   sauce simulate eth-prices.sauce.ts --chain <chain> --owner <address> --args <amount>
//
//   amount: Uint256  the trade the V2 pair is priced for, in WETH base units (18 decimals):
//                    1000000000000000000 is 1 WETH; a pair's price for a trade includes its impact
//
// On Ethereum, priced for 1 WETH:
//
//   sauce simulate eth-prices.sauce.ts --chain ethereum --owner <address> \
//     --args 1000000000000000000

// USDC base units per WETH at a V3-style pool's sqrt price (token1 per token0, times 2^96).
function v3Price(pool: Address): Uint256 {
  require(pool != 0, "no such pool");
  require(UniswapV3.Pool(pool).liquidity() > 0, "a pool has no liquidity");
  const sqrtPriceX96 = UniswapV3.Pool(pool).slot0().sqrtPriceX96;
  const ratio = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96); // token1 per token0, × 2^96
  return WETH < USDC
    ? Math.mulDiv(ratio, 10 ** 18, 1 << 96)
    : Math.mulDiv(10 ** 18, 1 << 96, ratio);
}

// The gap between two prices, in hundredths of a percent of the lower.
function gapBps(a: Uint256, b: Uint256): Uint256 {
  return a > b ? Math.mulDiv(a - b, 10000, b) : Math.mulDiv(b - a, 10000, a);
}

function main(amount: Uint256): {
  oracle: Uint256;
  updatedAt: Uint256;
  v3Fee500: Uint256;
  v3Fee3000: Uint256;
  v2: Uint256;
  spreadBps: Uint256;
  oracleGapBps: Uint256;
} {
  require(amount > 0, "amount is 0");
  const round = Chainlink.EthUsdFeed.latestRoundData();
  require(round.answer > 0, "no oracle price");
  const oracle = round.answer / 100; // the feed's 8 decimals as USDC's 6

  const v3Fee500 = v3Price(UniswapV3.Factory.getPool(WETH, USDC, 500));
  const v3Fee3000 = v3Price(UniswapV3.Factory.getPool(WETH, USDC, 3000));

  // What the pair pays for `amount` WETH, its 0.3% fee taken, per whole WETH.
  const pair = UniswapV2.Factory.getPair(WETH, USDC);
  require(pair != 0, "no WETH/USDC pair");
  const reserves = UniswapV2.Pair(pair).getReserves();
  const wethReserve = WETH < USDC ? reserves._reserve0 : reserves._reserve1;
  const usdcReserve = WETH < USDC ? reserves._reserve1 : reserves._reserve0;
  const afterFee = amount * 997;
  const out = Math.mulDiv(afterFee, usdcReserve, wethReserve * 1000 + afterFee);
  const v2 = Math.mulDiv(out, 10 ** 18, amount);

  let low = v3Fee500;
  let high = v3Fee500;
  for (const price of [v3Fee3000, v2]) {
    if (price < low) {
      low = price;
    }
    if (price > high) {
      high = price;
    }
  }
  return {
    oracle,
    updatedAt: round.updatedAt,
    v3Fee500,
    v3Fee3000,
    v2,
    spreadBps: gapBps(low, high),
    oracleGapBps: gapBps(v3Fee500, oracle),
  };
}
