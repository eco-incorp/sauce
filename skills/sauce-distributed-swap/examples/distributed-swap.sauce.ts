// Distributed swap: sell `amountIn` of `tokenIn` for `tokenOut` on every price-limited pool of the
// chain.
//   1. Discover the pair's pools and their prices: Uniswap V3, PancakeSwap V3 and Aerodrome
//      Slipstream through their factories, hookless Uniswap V4 pools by key.
//   2. Keep those priced better than `sqrtPriceLimitX96`, sorted best price first.
//   3. Swap once per pool with all remaining input: each fills up to the limit and leaves the rest
//      in the Pot for the next.
//   4. Check the fill, pay `recipient`, refund the unspent input to `refundTo`.
//
// It names no chain: `--chain` picks one, and the chain sets the Uniswap venues it has. The
// PancakeSwap V3 and Slipstream factories are optional `--define`s (the sauce-distributed-swap
// skill shows them for Base).
//
//   sauce run distributed-swap.sauce.ts --chain <chain> --config sauce.config.json \
//     --keystore <keystore> --args <tokenIn> <tokenOut> <amountIn> <sqrtPriceLimitX96> <minOut> \
//     <minAvgPrice> <recipient> <refundTo>
import { ISauceRouter } from "./artifacts/ISauceRouter.json";
import IUniswapV3Factory from "./protocols/uniswap-v3/UniswapV3FactoryABI.json";
import IPancakeV3Factory from "./protocols/pancakeswap-v3/PancakeSwapV3FactoryABI.json";
import ISlipstreamFactory from "./protocols/aerodrome-slipstream/SlipstreamCLFactoryABI.json";

// Venues, as compile-time addresses: 0 leaves a venue out. The chain sets the Uniswap ones where
// they are deployed; the others are `--define`s, from each protocol's registry deployments.
const UniswapV3_Factory = 0n;
const UniswapV4_PoolManager = 0n;
const PANCAKE_V3_FACTORY = 0n;
const SLIPSTREAM_INITIAL = 0n; // Aerodrome Slipstream has up to three CLFactory generations
const SLIPSTREAM_GAUGE_CAPS = 0n;
const SLIPSTREAM_GAUGES_V3 = 0n;

// A V3-style pool's current sqrtPriceX96: the first word of slot0().
function spotPrice(pool) {
  const slot0 = hex`3850c7bd`;
  const [sqrtPriceX96] = abi.decode(evm.static(pool, slot0), ["Uint256"]);
  return sqrtPriceX96;
}

// A hookless Uniswap V4 pool's current sqrtPriceX96, or 0 if the pool does not exist. Its id is the
// hash of its key; its price is the low 160 bits of the first word of its state, which lives in the
// PoolManager's `pools` mapping (storage slot 6) and is read with extsload(bytes32).
function v4SpotPrice(fee, tickSpacing, tokenIn, tokenOut) {
  const zeroForOne = tokenIn < tokenOut;
  const currency0 = zeroForOne ? tokenIn : tokenOut;
  const currency1 = zeroForOne ? tokenOut : tokenIn;
  const poolId = crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, 0n));
  const stateSlot = crypto.keccak256(abi.encode(poolId, 6n));
  const extsload = hex`1e2eaeaf`;
  const call = extsload.concat(abi.encode(stateSlot));
  const [slot0] = abi.decode(evm.static(UniswapV4_PoolManager, call), ["Uint256"]);
  return slot0 & ((1n << 160n) - 1n);
}

// Selling token0 (the lower address) pushes the price down, so a higher price is better.
function isBetter(price, than, tokenIn, tokenOut) {
  if (tokenIn < tokenOut) {
    return price > than;
  }
  return price < than;
}

// One exact-input swap offering `amount`; returns the input the pool took. The pool takes what it
// can fill before the limit, the Router pays exactly that, and the rest stays in the Pot.
function swapIntoV3(pool, tokenIn, tokenOut, amount, limit) {
  const self = ctx.self();
  const before = Token(tokenIn).balanceOf(self);
  const router = ISauceRouter.at(self); // the Router, reached through this Pot
  router.swapV3(pool, tokenIn, tokenOut, amount, limit, self, self);
  return before - Token(tokenIn).balanceOf(self);
}

// The same for a hookless Uniswap V4 pool, named by its key. V4 exact input is a negative amount.
function swapIntoV4(fee, tickSpacing, tokenIn, tokenOut, amount, limit) {
  const self = ctx.self();
  const before = Token(tokenIn).balanceOf(self);
  const zeroForOne = tokenIn < tokenOut;
  const key = {
    currency0: zeroForOne ? tokenIn : tokenOut,
    currency1: zeroForOne ? tokenOut : tokenIn,
    fee: fee,
    tickSpacing: tickSpacing,
    hooks: 0n
  };
  const router = ISauceRouter.at(self);
  router.swapV4(UniswapV4_PoolManager, key, zeroForOne, -amount, limit, self, self);
  return before - Token(tokenIn).balanceOf(self);
}

// Runtime inputs, passed with the transaction. minOut and minAvgPrice are 0 to turn them off;
// minAvgPrice is tokenOut units per tokenIn unit, times 1e18.
function main(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  minAvgPrice: Uint256,
  recipient: Address,
  refundTo: Address
) {
  const self = ctx.self();
  const outBefore = Token(tokenOut).balanceOf(self);
  require(Token(tokenIn).balanceOf(self) >= amountIn, "amountIn is not in the Pot");

  // 1. Discover. The factories give each fee tier's or tick spacing's pool (0 where there is none).
  let found = new Array(23); // 4 + 4 + 3 * 5
  let m = 0n;
  if (UniswapV3_Factory != 0n) {
    for (const fee of [100n, 500n, 3000n, 10000n]) {
      found[m] = IUniswapV3Factory.at(UniswapV3_Factory).getPool(tokenIn, tokenOut, fee);
      m++;
    }
  }
  if (PANCAKE_V3_FACTORY != 0n) {
    for (const fee of [100n, 500n, 2500n, 10000n]) {
      found[m] = IPancakeV3Factory.at(PANCAKE_V3_FACTORY).getPool(tokenIn, tokenOut, fee);
      m++;
    }
  }
  for (const factory of [SLIPSTREAM_INITIAL, SLIPSTREAM_GAUGE_CAPS, SLIPSTREAM_GAUGES_V3]) {
    if (factory != 0n) {
      for (const tickSpacing of [1n, 50n, 100n, 200n, 2000n]) {
        found[m] = ISlipstreamFactory.at(factory).getPool(tokenIn, tokenOut, tickSpacing);
        m++;
      }
    }
  }

  // Every candidate with its price. A V3-style pool is its address; a Uniswap V4 pool has pool 0
  // and is named by its key's fee and tick spacing.
  let pools = new Array(27); // the 23 above + 4 V4 keys
  let fees = new Array(27);
  let tickSpacings = new Array(27);
  let prices = new Array(27);
  let n = 0n;
  for (let i = 0n; i < m; i++) {
    if (found[i] != 0n) {
      pools[n] = found[i];
      prices[n] = spotPrice(found[i]);
      n++;
    }
  }
  if (UniswapV4_PoolManager != 0n) {
    const v4Fees = [100n, 500n, 3000n, 10000n];
    const v4TickSpacings = [1n, 10n, 60n, 200n];
    for (let k = 0n; k < 4n; k++) {
      pools[n] = 0n;
      fees[n] = v4Fees[k];
      tickSpacings[n] = v4TickSpacings[k];
      prices[n] = v4SpotPrice(v4Fees[k], v4TickSpacings[k], tokenIn, tokenOut);
      n++;
    }
  }

  // 2. Rank: the candidates priced better than the limit, best first (an insertion sort of their
  //    indexes). A price of 0 is a pool that does not exist.
  let order = new Array(n);
  let count = 0n;
  for (let i = 0n; i < n; i++) {
    if (prices[i] != 0n && isBetter(prices[i], sqrtPriceLimitX96, tokenIn, tokenOut)) {
      let j = count;
      while (j > 0n && isBetter(prices[i], prices[order[j - 1n]], tokenIn, tokenOut)) {
        order[j] = order[j - 1n];
        j--;
      }
      order[j] = i;
      count++;
    }
  }

  // 3. One swap per pool, best first, each offered everything still unsold.
  let remaining = amountIn;
  for (let r = 0n; r < count && remaining > 0n; r++) {
    const i = order[r];
    if (pools[i] != 0n) {
      remaining -= swapIntoV3(pools[i], tokenIn, tokenOut, remaining, sqrtPriceLimitX96);
    } else {
      remaining -= swapIntoV4(
        fees[i],
        tickSpacings[i],
        tokenIn,
        tokenOut,
        remaining,
        sqrtPriceLimitX96
      );
    }
  }

  // 4. Settle: the checks, the output out, every unspent input token back.
  const spent = amountIn - remaining;
  const out = Token(tokenOut).balanceOf(self) - outBefore;
  require(out >= minOut, "output below minOut");
  require(out * 10n ** 18n >= minAvgPrice * spent, "average price below minAvgPrice");
  if (out > 0n) {
    Token(tokenOut).transfer(recipient, out);
  }
  const unspent = Token(tokenIn).balanceOf(self);
  if (unspent > 0n) {
    Token(tokenIn).transfer(refundTo, unspent);
  }
}
