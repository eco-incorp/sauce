// Buys WETH with USDC across every pool on the chain that takes a sqrt-price limit: Uniswap V3,
// PancakeSwap V3, Aerodrome Slipstream and hookless Uniswap V4. The pools are ranked best price
// first (the price a taker gets, fee included), and each is offered all the USDC still unsold
// under one common sqrtPriceLimitX96, so the limit decides how much each pool fills. Then the fill is checked, the WETH is paid to `recipient`
// and the unsold USDC is refunded to `refundTo`.
//
// The Pot must hold `amountIn` USDC before the cook (or pull it in with `--fund`).
import { ISauceRouter } from "./artifacts/ISauceRouter.json";
import IUniswapV3Factory from "./protocols/uniswap-v3/UniswapV3FactoryABI.json";
import IPancakeV3Factory from "./protocols/pancakeswap-v3/PancakeSwapV3FactoryABI.json";
import ISlipstreamFactory from "./protocols/aerodrome-slipstream/SlipstreamCLFactoryABI.json";

// Venues. The chain sets the two Uniswap names where they are deployed; the PancakeSwap V3 and
// Slipstream factories are defines (programs/usdc-to-weth.base.json for Base). A venue left at 0n
// is left out.
const UniswapV3_Factory = 0n;
const UniswapV4_PoolManager = 0n;
const PANCAKE_V3_FACTORY = 0n;
const SLIPSTREAM_INITIAL = 0n;
const SLIPSTREAM_GAUGE_CAPS = 0n;
const SLIPSTREAM_GAUGES_V3 = 0n;

// The bounds a V3 or V4 pool accepts for a price limit, exclusive.
const MIN_SQRT_PRICE = 4295128739n;
const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;

// Room for every candidate: 4 Uniswap V3 fees, 4 PancakeSwap V3 fees, 3 Slipstream factories with
// 5 tick spacings each, and 4 Uniswap V4 keys.
const MAX_POOLS = 27n;

// Selling token0 moves a pool's price down, so a higher price is better; selling token1, a lower.
function isBetter(price: Uint256, than: Uint256): bool {
  if (USDC < WETH) {
    return price > than;
  }
  return price < than;
}

// A V3-style pool's sqrtPriceX96: the first word of slot0(). An uninitialized pool reads 0.
function slot0Price(pool: Address): Uint256 {
  const slot0 = hex`3850c7bd`;
  const [sqrtPriceX96] = abi.decode(evm.static(pool, slot0), ["Uint256"]);
  return sqrtPriceX96;
}

// A V3-style pool's swap fee in hundredths of a bip, from fee(); Slipstream's varies per pool.
function poolFee(pool: Address): Uint256 {
  const fee = hex`ddca3f43`;
  const [pips] = abi.decode(evm.static(pool, fee), ["Uint256"]);
  return pips;
}

// The price a taker gets from a pool, fee included, as token1 per token0 times 2^96: the spot
// price grossed up by the fee when buying token0, netted down when selling it.
function takerPrice(sqrtPriceX96: Uint256, fee: Uint256): Uint256 {
  const spotX96 = Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1n << 96n);
  if (USDC < WETH) {
    return Math.mulDiv(spotX96, 1000000n - fee, 1000000n);
  }
  return Math.mulDiv(spotX96, 1000000n, 1000000n - fee);
}

// A hookless V4 pool's sqrtPriceX96, from the PoolManager's `pools` mapping (slot 6) through
// extsload(bytes32). A key with no pool reads 0.
function v4Price(fee: Uint256, tickSpacing: Uint256): Uint256 {
  const currency0 = USDC < WETH ? USDC : WETH;
  const currency1 = USDC < WETH ? WETH : USDC;
  const poolId = crypto.keccak256(abi.encode(currency0, currency1, fee, tickSpacing, 0n));
  const slot = crypto.keccak256(abi.encode(poolId, 6n));
  const extsload = hex`1e2eaeaf`;
  const reply = evm.static(UniswapV4_PoolManager, extsload.concat(slot.toBytesBe(32n)));
  const [word] = abi.decode(reply, ["Uint256"]);
  return word & ((1n << 160n) - 1n);
}

// One exact-input swap on a V3-style pool. Returns the USDC the pool took.
function swapOnPool(pool: Address, amount: Uint256, limit: Uint256): Uint256 {
  const self = ctx.self();
  const before = USDC.balanceOf(self);
  ISauceRouter.at(self).swapV3(pool, USDC, USDC < WETH, amount, limit, self);
  return before - USDC.balanceOf(self);
}

// One exact-input swap on a hookless V4 pool. Returns the USDC it took.
function swapOnV4(fee: Uint256, tickSpacing: Uint256, amount: Uint256, limit: Uint256): Uint256 {
  const self = ctx.self();
  const key = {
    currency0: USDC < WETH ? USDC : WETH,
    currency1: USDC < WETH ? WETH : USDC,
    fee: fee,
    tickSpacing: Int256(tickSpacing),
    hooks: 0n,
  };
  const before = USDC.balanceOf(self);
  ISauceRouter.at(self).swapV4(UniswapV4_PoolManager, key, USDC, USDC < WETH, amount, limit, self);
  return before - USDC.balanceOf(self);
}

// amountIn: the USDC to sell, in base units (6 decimals).
// sqrtPriceLimitX96: the common limit, floor(sqrt(token1 units / token0 units) * 2^96).
// minOut: the least WETH bought, in wei; 0 turns it off.
// minAvgPrice: the least average price, in WETH wei per USDC unit times 1e18; 0 turns it off.
function main(
  amountIn: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  minAvgPrice: Uint256,
  recipient: Address,
  refundTo: Address
) {
  const self = ctx.self();
  const limitInRange = sqrtPriceLimitX96 > MIN_SQRT_PRICE && sqrtPriceLimitX96 < MAX_SQRT_PRICE;
  require(limitInRange, "sqrtPriceLimitX96 out of range");
  require(amountIn > 0n, "amountIn is zero");
  require(USDC.balanceOf(self) >= amountIn, "the Pot holds less USDC than amountIn");
  const wethBefore = WETH.balanceOf(self);

  // 1. Discover the pair's pools on every venue. A V3-style candidate is a pool address (0 where
  // the factory has none); a V4 candidate is a key's fee and tick spacing, with pool 0.
  let pools = new Array(MAX_POOLS);
  let keyFees = new Array(MAX_POOLS);
  let keySpacings = new Array(MAX_POOLS);
  let found = 0n;
  if (UniswapV3_Factory != 0n) {
    for (const fee of [100n, 500n, 3000n, 10000n]) {
      pools[found] = IUniswapV3Factory.at(UniswapV3_Factory).getPool(USDC, WETH, fee);
      found++;
    }
  }
  if (PANCAKE_V3_FACTORY != 0n) {
    for (const fee of [100n, 500n, 2500n, 10000n]) {
      pools[found] = IPancakeV3Factory.at(PANCAKE_V3_FACTORY).getPool(USDC, WETH, fee);
      found++;
    }
  }
  for (const factory of [SLIPSTREAM_INITIAL, SLIPSTREAM_GAUGE_CAPS, SLIPSTREAM_GAUGES_V3]) {
    if (factory != 0n) {
      for (const tickSpacing of [1n, 50n, 100n, 200n, 2000n]) {
        pools[found] = ISlipstreamFactory.at(factory).getPool(USDC, WETH, tickSpacing);
        found++;
      }
    }
  }
  if (UniswapV4_PoolManager != 0n) {
    const fees = [100n, 500n, 3000n, 10000n];
    const spacings = [1n, 10n, 60n, 200n];
    for (let k = 0n; k < fees.length; k++) {
      keyFees[found] = fees[k];
      keySpacings[found] = spacings[k];
      found++;
    }
  }

  // 2. Price every candidate and insertion-sort the indexes of those whose spot price is better
  // than the limit, best taker price (fee included) first. A missing or uninitialized pool prices
  // at 0 and is skipped.
  let prices = new Array(MAX_POOLS);
  let order = new Array(MAX_POOLS);
  let ranked = 0n;
  for (let i = 0n; i < found; i++) {
    let spot = 0n;
    let fee = 0n;
    if (pools[i] != 0n) {
      spot = slot0Price(pools[i]);
      if (spot != 0n) {
        fee = poolFee(pools[i]);
      }
    } else if (keyFees[i] != 0n) {
      spot = v4Price(keyFees[i], keySpacings[i]);
      fee = keyFees[i];
    }
    if (spot != 0n && isBetter(spot, sqrtPriceLimitX96)) {
      const price = takerPrice(spot, fee);
      prices[i] = price;
      let j = ranked;
      while (j > 0n && isBetter(price, prices[order[j - 1n]])) {
        order[j] = order[j - 1n];
        j--;
      }
      order[j] = i;
      ranked++;
    }
  }

  // 3. One swap per pool, in that order, each offered everything still unsold. A pool fills only
  // up to the limit; what it does not take stays in the Pot for the next one.
  let unsold = amountIn;
  for (let r = 0n; r < ranked; r++) {
    if (unsold == 0n) {
      break;
    }
    const i = order[r];
    if (pools[i] != 0n) {
      unsold -= swapOnPool(pools[i], unsold, sqrtPriceLimitX96);
    } else {
      unsold -= swapOnV4(keyFees[i], keySpacings[i], unsold, sqrtPriceLimitX96);
    }
  }

  // 4. Check the fill, pay out the WETH and refund the unsold USDC.
  const spent = amountIn - unsold;
  const bought = WETH.balanceOf(self) - wethBefore;
  require(bought >= minOut, "bought less WETH than minOut");
  require(bought * 10n ** 18n >= minAvgPrice * spent, "average price below minAvgPrice");
  if (bought > 0n) {
    WETH.transfer(recipient, bought);
  }
  if (unsold > 0n) {
    USDC.transfer(refundTo, unsold);
  }
}
