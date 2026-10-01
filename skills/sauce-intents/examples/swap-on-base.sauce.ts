// Sells WETH for USDC on Base, paying the solver in WETH on the chain this runs on: one intent
// whose body is the distributed swap. A solver delivers AMOUNT_IN of WETH on Base; the body sells
// it on every Uniswap V3 and hookless Uniswap V4 pool priced better than SQRT_PRICE_LIMIT_X96, best
// price first, one swap per pool, pays the USDC to RECIPIENT and returns the unsold WETH to
// REFUND_TO. The solver earns REWARD of WETH. The whole file is the intent: top-level statements,
// no main, and every value a define. Nothing is measured on chain, so it can also be published
// from a wallet (sauce publish).
//
// `--chain` is the source chain: `WETH` in `.reward(...)` is its WETH. Inside the braces, and in
// the delivery argument after them, the body runs on Base: `WETH`, `USDC`, `UniswapV3.Factory`,
// `UniswapV4.StateView` and `UniswapV4.PoolManager` there are Base's.
//
//   sauce run swap-on-base.sauce.ts --chain <chain> --config sauce.config.json \
//     --keystore <keystore> --define AMOUNT_IN=<amount> --define REWARD=<amount> \
//     --define SQRT_PRICE_LIMIT_X96=<sqrtPriceX96> --define MIN_OUT=<amount> \
//     --define MIN_AVG_PRICE=<price> --define RECIPIENT=<address> --define REFUND_TO=<address> \
//     --intent-deadline <unix seconds> --intent-creator <address> \
//     --intent-execution-fee <Base Kitchen fee in wei>
import { uniswapV3, uniswapV4 } from "@sauce/router";

Base(
  () => {
    require(SQRT_PRICE_LIMIT_X96 != 0n && RECIPIENT != 0n && REFUND_TO != 0n, "set the defines");
    const self = ctx.self();
    const zeroForOne = WETH < USDC; // selling token0 pushes the price down: higher is better
    const currency0 = zeroForOne ? WETH : USDC;
    const currency1 = zeroForOne ? USDC : WETH;
    const outBefore = USDC.balanceOf(self);

    // 1. Discover the pools and their prices: Uniswap V3 from its factory (slot0), hookless V4 by
    //    key from the StateView (0 where there is no pool).
    const slot0 = hex`3850c7bd`;
    let pools = new Array(8); // a V3 pool, or 0 for a V4 key
    let fees = new Array(8);
    let tickSpacings = new Array(8);
    let prices = new Array(8);
    let n = 0n;
    for (const fee of [100n, 500n, 3000n, 10000n]) {
      const pool = UniswapV3.Factory.getPool(WETH, USDC, fee);
      if (pool != 0n) {
        const [sqrtPriceX96] = abi.decode(evm.static(pool, slot0), ["Uint256"]);
        pools[n] = pool;
        prices[n] = sqrtPriceX96;
        n++;
      }
    }
    const v4Fees = [100n, 500n, 3000n, 10000n];
    const v4TickSpacings = [1n, 10n, 60n, 200n];
    for (let k = 0n; k < 4n; k++) {
      const id = crypto.keccak256(
        abi.encode(currency0, currency1, v4Fees[k], v4TickSpacings[k], 0n),
      );
      const [sqrtPriceX96] = UniswapV4.StateView.getSlot0(id);
      pools[n] = 0n;
      fees[n] = v4Fees[k];
      tickSpacings[n] = v4TickSpacings[k];
      prices[n] = sqrtPriceX96;
      n++;
    }

    // 2. Rank: the pools priced better than the limit, best first (an insertion sort of indexes).
    let order = new Array(n);
    let count = 0n;
    for (let i = 0n; i < n; i++) {
      const p = prices[i];
      if (p != 0n && (zeroForOne ? p > SQRT_PRICE_LIMIT_X96 : p < SQRT_PRICE_LIMIT_X96)) {
        let j = count;
        while (j > 0n && (zeroForOne ? p > prices[order[j - 1n]] : p < prices[order[j - 1n]])) {
          order[j] = order[j - 1n];
          j--;
        }
        order[j] = i;
        count++;
      }
    }

    // 3. One exact-input swap per pool through @sauce/router, each offered all the WETH still
    //    unsold; each pool fills up to the limit and leaves the rest, and the USDC, in the Pot.
    let remaining = AMOUNT_IN;
    for (let r = 0n; r < count && remaining > 0n; r++) {
      const i = order[r];
      const before = WETH.balanceOf(self);
      if (pools[i] != 0n) {
        uniswapV3(pools[i], WETH, USDC, remaining, SQRT_PRICE_LIMIT_X96, 0n, self);
      } else {
        const manager = UniswapV4.PoolManager;
        uniswapV4(
          manager,
          WETH,
          USDC,
          remaining,
          fees[i],
          tickSpacings[i],
          0n,
          SQRT_PRICE_LIMIT_X96,
          0n,
          self,
        );
      }
      remaining -= before - WETH.balanceOf(self);
    }

    // 4. Settle: the checks, the USDC out, every unsold WETH back.
    const spent = AMOUNT_IN - remaining;
    const out = USDC.balanceOf(self) - outBefore;
    require(out >= MIN_OUT, "output below MIN_OUT");
    require(out * 10n ** 18n >= MIN_AVG_PRICE * spent, "average price below MIN_AVG_PRICE");
    USDC.transfer(RECIPIENT, out);
    const unsold = WETH.balanceOf(self);
    if (unsold > 0n) {
      WETH.transfer(REFUND_TO, unsold);
    }
  },
  { tokens: [{ token: WETH, amount: AMOUNT_IN }] },
).reward({ tokens: [{ token: WETH, amount: REWARD }] });
