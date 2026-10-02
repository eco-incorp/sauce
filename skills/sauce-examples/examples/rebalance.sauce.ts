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
  const ratio = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1n << 96n);
  return WETH < USDC
    ? Math.mulDiv(ratio, 10n ** 18n, 1n << 96n)
    : Math.mulDiv(10n ** 18n, 1n << 96n, ratio);
}

// The other way: the pool's sqrt price at `price` USDC base units per WETH.
function sqrtPriceAt(price: Uint256): Uint256 {
  return WETH < USDC
    ? Math.sqrt(Math.mulDiv(price, 1n << 192n, 10n ** 18n))
    : Math.sqrt(Math.mulDiv(1n << 192n, 10n ** 18n, price));
}

// WETH's share of the two balances' value at `price`, in hundredths of a percent.
function wethShare(weth: Uint256, usdc: Uint256, price: Uint256): Uint256 {
  const wethValue = Math.mulDiv(weth, price, 10n ** 18n);
  return Math.mulDiv(wethValue, 10000n, wethValue + usdc);
}

function main(
  targetBps: Uint256,
  bandBps: Uint256,
  maxSlippageBps: Uint256,
): { before: Uint256; after: Uint256; soldWeth: bool; amountIn: Uint256; amountOut: Uint256 } {
  require(targetBps <= 10000n && maxSlippageBps < 10000n, "a share above 100%");
  const self = ctx.self();
  const pool = UniswapV3.Factory.getPool(WETH, USDC, 500n);
  require(pool != 0n, "no WETH/USDC pool at 0.05%");
  const price = priceAt(UniswapV3.Pool(pool).slot0().sqrtPriceX96);
  const weth = WETH.balanceOf(self);
  const usdc = USDC.balanceOf(self);
  require(weth > 0n || usdc > 0n, "the Pot holds neither");

  const before = wethShare(weth, usdc, price);
  const soldWeth = before > targetBps;
  if ((soldWeth ? before - targetBps : targetBps - before) <= bandBps) {
    return { before, after: before, soldWeth, amountIn: 0n, amountOut: 0n };
  }
  // The value to move, in USDC, to bring WETH to its target share.
  const wethValue = Math.mulDiv(weth, price, 10n ** 18n);
  const wanted = Math.mulDiv(wethValue + usdc, targetBps, 10000n);
  const fee = UniswapV3.Pool(pool).fee();
  let amountOut = 0n;
  let amountIn = 0n;
  if (soldWeth) {
    // Sell WETH down to `floor`: every unit fetches at least that, less the pool's fee.
    const floor = Math.mulDiv(price, 10000n - maxSlippageBps, 10000n);
    amountOut = uniswapV3(
      pool,
      WETH,
      USDC,
      Math.mulDiv(wethValue - wanted, 10n ** 18n, price),
      sqrtPriceAt(floor),
      0n,
      self,
    );
    amountIn = weth - WETH.balanceOf(self);
    const least = Math.mulDiv(Math.mulDiv(amountIn, floor, 10n ** 18n), 1000000n - fee, 1000000n);
    require(amountOut >= least, "sold below the floor");
  } else {
    // Buy WETH up to `ceiling`: no unit costs more than that, plus the pool's fee.
    const ceiling = Math.mulDiv(price, 10000n + maxSlippageBps, 10000n);
    amountOut = uniswapV3(pool, USDC, WETH, wanted - wethValue, sqrtPriceAt(ceiling), 0n, self);
    amountIn = usdc - USDC.balanceOf(self);
    const most = Math.mulDiv(Math.mulDiv(amountOut, ceiling, 10n ** 18n), 1000000n, 1000000n - fee);
    require(amountIn <= most + 1n, "bought above the ceiling");
  }
  const after = wethShare(
    WETH.balanceOf(self),
    USDC.balanceOf(self),
    priceAt(UniswapV3.Pool(pool).slot0().sqrtPriceX96),
  );
  return { before, after, soldWeth, amountIn, amountOut };
}
