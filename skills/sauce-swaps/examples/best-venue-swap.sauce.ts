// Sells `amountIn` of `tokenIn` for `tokenOut` at whichever of two pools pays more for it now: the
// chain's Uniswap V3 pool at fee tier `fee`, or its Aerodrome Slipstream pool at tick spacing
// `tickSpacing`, from `AerodromeSlipstream.CLFactory`. Each pool is priced from its sqrt price with
// its own fee taken off; a missing or empty pool is skipped, and the cook reverts when neither has
// liquidity. The comparison is each pool's marginal price now, which suits a trade small next to
// both pools' depth; for a trade that moves the price, compare by simulating each swap inside the
// cook instead (`sauce-swaps`, choosing the better venue). `minOut` bounds what the whole trade
// receives, and the swap stops at `sqrtPriceLimitX96`. The output goes to `recipient`, and so does
// the input the pool did not take. Returns the venue chosen (0 Uniswap V3, 1 Slipstream), what was
// spent and what was received.
//
//   sauce run best-venue-swap.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <tokenIn> <tokenOut> <amountIn> <fee> <tickSpacing> <sqrtPriceLimitX96> <minOut> \
//     <recipient>
//
//   tokenIn: Address            the token sold
//   tokenOut: Address           the token bought
//   amountIn: Uint256           how much `tokenIn` to sell, in its base units: 100000000 is
//                               100 USDC (6 decimals); the Pot must hold it
//   fee: Uint256                the Uniswap V3 pool's fee tier, in millionths: 500 is 0.05%
//   tickSpacing: Int256         the Slipstream pool's tick spacing: 1, 50, 100, ...
//   sqrtPriceLimitX96: Uint256  the pool price past which nothing more is sold, as the pool
//                               states it (`sauce price` turns "0.88 EURC per USDC" into it); the
//                               pair is the same at both venues, so one limit serves both
//   minOut: Uint256             the least `tokenOut` to accept, in its base units: 89000000 is
//                               89 EURC (6 decimals); less reverts the whole cook
//   recipient: Address          receives `tokenOut` and the `tokenIn` the pool did not take
//
// On Arc, 100 USDC sold for EURC at the better of Uniswap V3's 0.05% pool and Slipstream's tick
// spacing 1 pool, never below 0.88 EURC per USDC, for at least 89 EURC:
//
//   sauce simulate best-venue-swap.sauce.ts --chain arc --owner <owner> --assume-balance USDC:100 \
//     --args 0x3600000000000000000000000000000000000000 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1 \
//     100000000 500 1 74322604415751464381725743603 89000000 <recipient>
import { uniswapV3 } from "@sauce/router";

function main(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  fee: Uint256,
  tickSpacing: Int256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  recipient: Address,
): { venue: Uint256; spent: Uint256; received: Uint256 } {
  const inBefore = Token(tokenIn).balanceOf(pot);
  require(inBefore >= amountIn, "amountIn is not in the Pot");
  // The lower address of the pair is token0 at both venues; a pool's price is token1 per token0.
  const sellsToken0 = tokenIn < tokenOut;

  // What one unit of tokenIn buys at each pool now, its fee taken off, in tokenOut times 2^96;
  // 0 where the pool is missing or empty.
  let uniswap = 0;
  const v3 = UniswapV3.Factory.getPool(tokenIn, tokenOut, fee);
  if (v3 != 0 && UniswapV3.Pool(v3).liquidity() > 0) {
    const sqrtPriceX96 = UniswapV3.Pool(v3).slot0().sqrtPriceX96;
    const ratio = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96);
    const gross = sellsToken0 ? ratio : Math.mulDiv(1 << 96, 1 << 96, ratio);
    uniswap = Math.mulDiv(gross, 1000000 - fee, 1000000);
  }
  let slipstream = 0;
  const cl = AerodromeSlipstream.CLFactory.getPool(tokenIn, tokenOut, tickSpacing);
  if (cl != 0 && AerodromeSlipstream.Pool(cl).liquidity() > 0) {
    // Slipstream's own binding: its slot0 has no feeProtocol, and its fee can change any block.
    const sqrtPriceX96 = AerodromeSlipstream.Pool(cl).slot0().sqrtPriceX96;
    const ratio = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96);
    const gross = sellsToken0 ? ratio : Math.mulDiv(1 << 96, 1 << 96, ratio);
    slipstream = Math.mulDiv(gross, 1000000 - AerodromeSlipstream.Pool(cl).fee(), 1000000);
  }
  require(uniswap > 0 || slipstream > 0, "neither venue has a pool with liquidity");

  // A Slipstream pool swaps and calls back as a Uniswap V3 pool does: uniswapV3 swaps both.
  const venue = slipstream > uniswap ? 1 : 0;
  const pool = venue == 1 ? cl : v3;
  const received = uniswapV3(
    pool,
    tokenIn,
    tokenOut,
    amountIn,
    sqrtPriceLimitX96,
    minOut,
    recipient,
  );

  // What the pool took; the rest of amountIn goes back. The Pot's other tokenIn stays.
  const spent = inBefore - Token(tokenIn).balanceOf(pot);
  if (amountIn > spent) {
    Token(tokenIn).transfer(recipient, amountIn - spent);
  }
  return { venue, spent, received };
}
