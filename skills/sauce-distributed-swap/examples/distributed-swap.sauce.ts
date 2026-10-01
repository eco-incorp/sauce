// Distributed swap: sell `amountIn` of `tokenIn` for `tokenOut` on every price-limited pool of the
// chain.
//   1. Discover the pair's pools: Uniswap V3, PancakeSwap V3 and Aerodrome Slipstream through their
//      factories, hookless Uniswap V4 pools by the keys passed in `v4Keys`.
//   2. Liquidity before price: drop every pool with no liquidity at its price, whose price is
//      stale and would rank first. Give each one left its own limit (`sqrtPriceLimitX96` is the
//      worst price a taker accepts, fee included, so each pool stops where its price, less its fee,
//      reaches it) and keep those priced better than it.
//   3. Rank them by the price a taker gets, fee included, best first.
//   4. Swap once per pool with all remaining input: each fills up to its limit and leaves the rest
//      in the Pot for the next.
//   5. Check the fill, pay `recipient`, refund what is left of `amountIn` to `refundTo`, and
//      return what happened. Anything else the Pot holds stays there.
//
// It names no chain: `--chain` picks one, and each venue is used where that chain has it
// (`available(...)`), so one file compiles for every chain.
//
//   sauce run distributed-swap.sauce.ts --chain <chain> --config sauce.config.json \
//     --keystore <keystore> --args <tokenIn> <tokenOut> <amountIn> <sqrtPriceLimitX96> <minOut> \
//     <minAvgPrice> <recipient> <refundTo> <v4Keys>
import { ISauceRouter } from "./artifacts/ISauceRouter.json";

// A V3-style pool's current sqrtPriceX96: the first word of slot0().
function spotPrice(pool: Address): Uint256 {
  const slot0 = hex`3850c7bd`;
  const [sqrtPriceX96] = abi.decode(evm.static(pool, slot0), ["Uint256"]);
  return sqrtPriceX96;
}

// A V3-style pool's liquidity at its current price: liquidity(). 0 is a pool with nothing to trade.
function inRangeLiquidity(pool: Address): Uint256 {
  const liquidity = hex`1a686502`;
  const [inRange] = abi.decode(evm.static(pool, liquidity), ["Uint256"]);
  return inRange;
}

// A V3-style pool's swap fee in millionths: fee(). A Uniswap or PancakeSwap V3 pool's is its tier;
// a Slipstream pool's is set per pool and changes over time.
function poolFee(pool: Address): Uint256 {
  const fee = hex`ddca3f43`;
  const [millionths] = abi.decode(evm.static(pool, fee), ["Uint256"]);
  return millionths;
}

// A hookless Uniswap V4 pool's id: the hash of its key, the pair in address order.
function v4PoolId(
  fee: Uint256,
  tickSpacing: Uint256,
  tokenIn: Address,
  tokenOut: Address,
): Uint256 {
  const sellsToken0 = tokenIn < tokenOut;
  const currency0 = sellsToken0 ? tokenIn : tokenOut;
  const currency1 = sellsToken0 ? tokenOut : tokenIn;
  return crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, 0n));
}

// A V4 pool's swap fee in millionths: the LP fee (a hookless key's own fee) plus the protocol fee
// for this direction, where one is switched on. The protocol fee holds selling token0's in its low
// 12 bits and selling token1's in the next 12; it is taken first, and the LP fee from the rest.
function v4SwapFee(protocolFees: Uint256, lpFee: Uint256, sellsToken0: bool): Uint256 {
  let protocolFee = protocolFees & 0xfffn;
  if (!sellsToken0) {
    protocolFee = (protocolFees >> 12n) & 0xfffn;
  }
  return protocolFee + lpFee - (protocolFee * lpFee) / 1000000n;
}

// Selling token0 (the lower address) pushes the price down, so a higher price is better.
function isBetter(price: Uint256, than: Uint256, sellsToken0: bool): bool {
  if (sellsToken0) {
    return price > than;
  }
  return price < than;
}

// The price a taker gets, fee included, as token1 per token0 times 2^96. Selling token0, the pool
// pays out spot × (1 − fee); selling token1, it charges spot ÷ (1 − fee).
function takerPrice(sqrtPriceX96: Uint256, fee: Uint256, sellsToken0: bool): Uint256 {
  const spot = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1n << 96n);
  if (sellsToken0) {
    return Math.mulDiv(spot, 1000000n - fee, 1000000n);
  }
  return Math.mulDiv(spot, 1000000n, 1000000n - fee);
}

// A pool's own limit. `limit` bounds the price a taker gets, fee included; a pool's price limit
// bounds its price after the swap, before the fee. Selling token0 the price falls, and the pool
// stops at limit ÷ √(1 − fee); selling token1 it rises, and the pool stops at limit × √(1 − fee).
// Both round toward stopping sooner.
function poolLimit(limit: Uint256, fee: Uint256, sellsToken0: bool): Uint256 {
  const root = Math.sqrt((1000000n - fee) * 10n ** 30n); // √(1 − fee), times 1e18
  if (sellsToken0) {
    return Math.mulDiv(limit, 10n ** 18n, root);
  }
  return Math.mulDiv(limit, root, 10n ** 18n);
}

// One exact-input swap offering `amount`; returns the input the pool took. The pool takes what it
// can fill before the limit, the Router pays exactly that, and the rest stays in the Pot.
function swapIntoV3(
  pool: Address,
  tokenIn: Address,
  tokenOut: Address,
  amount: Uint256,
  limit: Uint256,
): Uint256 {
  const self = ctx.self();
  const before = Token(tokenIn).balanceOf(self);
  const router = ISauceRouter.at(self); // the Router, reached through this Pot
  router.swapV3(pool, tokenIn, tokenOut, amount, limit, self, self);
  return before - Token(tokenIn).balanceOf(self);
}

// The same for a hookless Uniswap V4 pool, named by its key. V4 exact input is a negative amount.
function swapIntoV4(
  fee: Uint256,
  tickSpacing: Uint256,
  tokenIn: Address,
  tokenOut: Address,
  amount: Uint256,
  limit: Uint256,
): Uint256 {
  if (!available(UniswapV4.PoolManager)) {
    return 0n;
  }
  const self = ctx.self();
  const before = Token(tokenIn).balanceOf(self);
  const zeroForOne = tokenIn < tokenOut;
  const key = {
    currency0: zeroForOne ? tokenIn : tokenOut,
    currency1: zeroForOne ? tokenOut : tokenIn,
    fee: fee,
    tickSpacing: tickSpacing,
    hooks: 0n,
  };
  const router = ISauceRouter.at(self);
  router.swapV4(UniswapV4.PoolManager, key, zeroForOne, -amount, limit, self, self);
  return before - Token(tokenIn).balanceOf(self);
}

// Runtime inputs, passed with the transaction. sqrtPriceLimitX96 is the worst price, fee included,
// as a sqrt price. minOut and minAvgPrice are 0 to turn them off; minAvgPrice is tokenOut units per
// tokenIn unit, times 1e18. v4Keys are the hookless Uniswap V4 pools to try, by fee and tick
// spacing ([] for none). Returns abi.encode(spent, bought, unspent): the input the pools took, the
// output paid to `recipient`, and the rest of `amountIn`, refunded to `refundTo`.
function main(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  minAvgPrice: Uint256,
  recipient: Address,
  refundTo: Address,
  v4Keys: { fee: Uint256; tickSpacing: Uint256 }[],
): bytes {
  const self = ctx.self();
  const sellsToken0 = tokenIn < tokenOut;
  const outBefore = Token(tokenOut).balanceOf(self);
  require(Token(tokenIn).balanceOf(self) >= amountIn, "amountIn is not in the Pot");

  // 1. Discover. Each venue the chain has gives a pool per fee tier or tick spacing (0 where there
  //    is none); a venue the chain lacks is left out when the program is compiled. A pair can have
  //    a Slipstream pool at the same tick spacing under each of its three factories.
  let found = new Array(23); // 4 + 4 + 3 * 5
  let m = 0n;
  if (available(UniswapV3.Factory)) {
    for (const fee of [100n, 500n, 3000n, 10000n]) {
      found[m] = UniswapV3.Factory.getPool(tokenIn, tokenOut, fee);
      m++;
    }
  }
  if (available(PancakeswapV3.Factory)) {
    for (const fee of [100n, 500n, 2500n, 10000n]) {
      found[m] = PancakeswapV3.Factory.getPool(tokenIn, tokenOut, fee);
      m++;
    }
  }
  const tickSpacings = [1n, 50n, 100n, 200n, 2000n];
  if (available(AerodromeSlipstream.CLFactory)) {
    for (const tickSpacing of tickSpacings) {
      found[m] = AerodromeSlipstream.CLFactory.getPool(tokenIn, tokenOut, tickSpacing);
      m++;
    }
  }
  if (available(AerodromeSlipstream.CLFactoryGaugeCaps)) {
    for (const tickSpacing of tickSpacings) {
      found[m] = AerodromeSlipstream.CLFactoryGaugeCaps.getPool(tokenIn, tokenOut, tickSpacing);
      m++;
    }
  }
  if (available(AerodromeSlipstream.CLFactoryGaugesV3)) {
    for (const tickSpacing of tickSpacings) {
      found[m] = AerodromeSlipstream.CLFactoryGaugesV3.getPool(tokenIn, tokenOut, tickSpacing);
      m++;
    }
  }

  // 2. Liquidity before price: a pool with no liquidity at its price is dropped before its price is
  //    looked at, since an abandoned pool can sit far from the market, rank first and fill nothing.
  //    Each pool left gets its own limit and the price a taker gets there. A V3-style pool is its
  //    address; a Uniswap V4 pool has pool 0 and is named by its key's fee and tick spacing.
  const most = m + v4Keys.length;
  let pools = new Array(most);
  let fees = new Array(most);
  let spacings = new Array(most);
  let limits = new Array(most);
  let prices = new Array(most);
  let n = 0n;
  for (let i = 0n; i < m; i++) {
    if (found[i] != 0n && inRangeLiquidity(found[i]) != 0n) {
      const spot = spotPrice(found[i]);
      if (spot != 0n) {
        const fee = poolFee(found[i]);
        const limit = poolLimit(sqrtPriceLimitX96, fee, sellsToken0);
        if (isBetter(spot, limit, sellsToken0)) {
          pools[n] = found[i];
          limits[n] = limit;
          prices[n] = takerPrice(spot, fee, sellsToken0);
          n++;
        }
      }
    }
  }
  if (available(UniswapV4.StateView)) {
    for (const key of v4Keys) {
      const id = v4PoolId(key.fee, key.tickSpacing, tokenIn, tokenOut);
      if (UniswapV4.StateView.getLiquidity(id) != 0n) {
        const [spot, tick, protocolFees, lpFee] = UniswapV4.StateView.getSlot0(id);
        const fee = v4SwapFee(protocolFees, lpFee, sellsToken0);
        const limit = poolLimit(sqrtPriceLimitX96, fee, sellsToken0);
        if (spot != 0n && isBetter(spot, limit, sellsToken0)) {
          pools[n] = 0n;
          fees[n] = key.fee;
          spacings[n] = key.tickSpacing;
          limits[n] = limit;
          prices[n] = takerPrice(spot, fee, sellsToken0);
          n++;
        }
      }
    }
  }

  // 3. Rank: an insertion sort of the candidates' indexes, best taker price first.
  let order = new Array(n);
  for (let i = 0n; i < n; i++) {
    let j = i;
    while (j > 0n && isBetter(prices[i], prices[order[j - 1n]], sellsToken0)) {
      order[j] = order[j - 1n];
      j--;
    }
    order[j] = i;
  }

  // 4. One swap per pool, best first, each offered everything still unsold, up to its own limit.
  let remaining = amountIn;
  for (let r = 0n; r < n && remaining > 0n; r++) {
    const i = order[r];
    if (pools[i] != 0n) {
      remaining -= swapIntoV3(pools[i], tokenIn, tokenOut, remaining, limits[i]);
    } else {
      remaining -= swapIntoV4(fees[i], spacings[i], tokenIn, tokenOut, remaining, limits[i]);
    }
  }

  // 5. Settle: the checks, the output out, the rest of amountIn back, and what happened. Only this
  //    trade's tokens move: the refund is what is left of amountIn, not the Pot's whole balance,
  //    so tokens the owner keeps in the Pot stay there.
  const spent = amountIn - remaining;
  const bought = Token(tokenOut).balanceOf(self) - outBefore;
  require(bought >= minOut, "output below minOut");
  require(bought * 10n ** 18n >= minAvgPrice * spent, "average price below minAvgPrice");
  if (bought > 0n) {
    Token(tokenOut).transfer(recipient, bought);
  }
  if (remaining > 0n) {
    Token(tokenIn).transfer(refundTo, remaining);
  }
  return abi.encode(spent, bought, remaining);
}
