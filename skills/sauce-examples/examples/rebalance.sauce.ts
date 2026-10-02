// Rebalances the Pot's WETH and USDC to `targetBps` of their value in WETH, priced by the Uniswap V3
// 0.05% pool, once the WETH share has drifted more than `bandBps` from it: sells the excess of the
// side that is over on that pool, never past the pool's price moved `maxSlippageBps` against the
// trade, so a thin pool fills part of it and the rest waits for the next run. Inside the band it
// trades nothing. Returns the WETH share before and after, whether WETH was sold or bought, and
// the amounts in and out.
//
//   sauce run rebalance.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <targetBps> <bandBps> <maxSlippageBps>
//
//   targetBps: Uint256       WETH's share of the two, by value, in hundredths of a percent:
//                            5000 is half
//   bandBps: Uint256         how far the share may drift before a trade, in the same units:
//                            500 trades below 45% or above 55% at a 5000 target
//   maxSlippageBps: Uint256  how far the trade may move the pool's price, in hundredths of a
//                            percent: 30 is 0.3%
//
// On Base, half and half, trading once the share leaves 45-55%, moving the price at most 0.3%:
//
//   sauce run rebalance.sauce.ts --chain base --keystore <keystore> --args 5000 500 30
import { uniswapV3 } from "@sauce/router";

// USDC base units per WETH at a pool's sqrt price (token1 per token0, times 2^96).
function priceAt(sqrtPriceX96: Uint256): Uint256 {
  const ratio = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96);
  return WETH < USDC
    ? Math.mulDiv(ratio, 10 ** 18, 1 << 96)
    : Math.mulDiv(10 ** 18, 1 << 96, ratio);
}

// The other way: the pool's sqrt price at `price` USDC base units per WETH.
function sqrtPriceAt(price: Uint256): Uint256 {
  return WETH < USDC
    ? Math.sqrt(Math.mulDiv(price, 1 << 192, 10 ** 18))
    : Math.sqrt(Math.mulDiv(1 << 192, 10 ** 18, price));
}

// WETH's share of the two balances' value at `price`, in hundredths of a percent.
function wethShare(weth: Uint256, usdc: Uint256, price: Uint256): Uint256 {
  const wethValue = Math.mulDiv(weth, price, 10 ** 18);
  return Math.mulDiv(wethValue, 10000, wethValue + usdc);
}

function main(
  targetBps: Uint256,
  bandBps: Uint256,
  maxSlippageBps: Uint256,
): { before: Uint256; after: Uint256; soldWeth: bool; amountIn: Uint256; amountOut: Uint256 } {
  require(targetBps <= 10000 && maxSlippageBps < 10000, "a share above 100%");
  const self = ctx.self();
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500);
  require(pool != 0, "no WETH/USDC pool at 0.05%");
  const price = priceAt(UniswapV3.Pool(pool).slot0().sqrtPriceX96);
  const weth = WETH.balanceOf(self);
  const usdc = USDC.balanceOf(self);
  require(weth > 0 || usdc > 0, "the Pot holds neither");

  const before = wethShare(weth, usdc, price);
  const soldWeth = before > targetBps;
  if ((soldWeth ? before - targetBps : targetBps - before) <= bandBps) {
    return { before, after: before, soldWeth, amountIn: 0, amountOut: 0 };
  }
  // The value to move, in USDC, to bring WETH to its target share.
  const wethValue = Math.mulDiv(weth, price, 10 ** 18);
  const wanted = Math.mulDiv(wethValue + usdc, targetBps, 10000);
  const fee = UniswapV3.Pool(pool).fee();
  let amountOut: Uint256 = 0;
  let amountIn: Uint256 = 0;
  if (soldWeth) {
    // Sell WETH down to `floor`: every unit fetches at least that, less the pool's fee.
    const floor = Math.mulDiv(price, 10000 - maxSlippageBps, 10000);
    amountOut = uniswapV3(
      pool,
      WETH,
      USDC,
      Math.mulDiv(wethValue - wanted, 10 ** 18, price),
      sqrtPriceAt(floor),
      0,
      self,
    );
    amountIn = weth - WETH.balanceOf(self);
    const least = Math.mulDiv(Math.mulDiv(amountIn, floor, 10 ** 18), 1000000 - fee, 1000000);
    require(amountOut >= least, "sold below the floor");
  } else {
    // Buy WETH up to `ceiling`: no unit costs more than that, plus the pool's fee.
    const ceiling = Math.mulDiv(price, 10000 + maxSlippageBps, 10000);
    amountOut = uniswapV3(pool, USDC, WETH, wanted - wethValue, sqrtPriceAt(ceiling), 0, self);
    amountIn = usdc - USDC.balanceOf(self);
    const most = Math.mulDiv(Math.mulDiv(amountOut, ceiling, 10 ** 18), 1000000, 1000000 - fee);
    require(amountIn <= most + 1, "bought above the ceiling");
  }
  const after = wethShare(
    WETH.balanceOf(self),
    USDC.balanceOf(self),
    priceAt(UniswapV3.Pool(pool).slot0().sqrtPriceX96),
  );
  return { before, after, soldWeth, amountIn, amountOut };
}
