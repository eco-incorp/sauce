// Sells WETH for USDC on Base, paying the solver in WETH on the chain this runs on: one intent
// whose body is the distributed swap. A solver delivers AMOUNT_IN of WETH on Base; the body sells
// it on every Uniswap V3 and hookless Uniswap V4 pool priced better than SQRT_PRICE_LIMIT_X96, best
// price first, one swap per pool, pays the USDC to RECIPIENT and returns the unsold WETH to
// REFUND_TO. The solver earns REWARD of WETH. The whole file is the intent: top-level statements,
// no main, and every value a define. Nothing is measured on chain, so it can also be published
// from a wallet (sauce publish).
//
// `--chain` is the source chain: `WETH` in `.reward(...)` is its WETH. Inside the braces the body
// runs on Base: `UniswapV3.Factory` and `UniswapV4.PoolManager` are Base's, and Base's WETH and
// USDC are named by their addresses there (the tokens index lists them).
//
//   sauce run swap-on-base.sauce.ts --chain <chain> --config sauce.config.json \
//     --keystore <keystore> --define AMOUNT_IN=<amount> --define REWARD=<amount> \
//     --define SQRT_PRICE_LIMIT_X96=<sqrtPriceX96> --define MIN_OUT=<amount> \
//     --define MIN_AVG_PRICE=<price> --define RECIPIENT=<address> --define REFUND_TO=<address> \
//     --intent-deadline <unix seconds> --intent-creator <address> \
//     --intent-execution-fee <Base Kitchen fee in wei>
Base(
  () => {
    require(SQRT_PRICE_LIMIT_X96 != 0n && RECIPIENT != 0n && REFUND_TO != 0n, "set the defines");
    const weth = 0x4200000000000000000000000000000000000006n; // Base WETH
    const usdc = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n; // Base USDC
    const self = ctx.self();
    const zeroForOne = weth < usdc; // selling token0 pushes the price down: higher is better
    const currency0 = zeroForOne ? weth : usdc;
    const currency1 = zeroForOne ? usdc : weth;
    const outBefore = Token(usdc).balanceOf(self);

    // 1. Discover the pools and their prices: Uniswap V3 from its factory (slot0), hookless V4 by
    //    key (extsload of the pool's state in the PoolManager; 0 where there is no pool).
    const slot0 = hex`3850c7bd`;
    const extsload = hex`1e2eaeaf`;
    let pools = new Array(8); // a V3 pool, or 0 for a V4 key
    let fees = new Array(8);
    let tickSpacings = new Array(8);
    let prices = new Array(8);
    let n = 0n;
    for (const fee of [100n, 500n, 3000n, 10000n]) {
      const pool = UniswapV3.Factory.getPool(weth, usdc, fee);
      if (pool != 0n) {
        pools[n] = pool;
        prices[n] = abi.decode(evm.static(pool, slot0), ["Uint256"])[0n];
        n++;
      }
    }
    const v4Fees = [100n, 500n, 3000n, 10000n];
    const v4TickSpacings = [1n, 10n, 60n, 200n];
    for (let k = 0n; k < 4n; k++) {
      const id = crypto.keccak256(
        abi.encode(currency0, currency1, v4Fees[k], v4TickSpacings[k], 0n)
      );
      const state = extsload.concat(abi.encode(crypto.keccak256(abi.encode(id, 6n))));
      const word = abi.decode(evm.static(UniswapV4.PoolManager, state), ["Uint256"])[0n];
      pools[n] = 0n;
      fees[n] = v4Fees[k];
      tickSpacings[n] = v4TickSpacings[k];
      prices[n] = word & ((1n << 160n) - 1n);
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

    // 3. One exact-input swap per pool through the Router (swapV3 / swapV4), each offered all the
    //    WETH still unsold; each pool fills up to the limit and leaves the rest for the next.
    const swapV3 = hex`a5e2989d`;
    const swapV4 = hex`7c9e9da3`;
    let remaining = AMOUNT_IN;
    for (let r = 0n; r < count && remaining > 0n; r++) {
      const i = order[r];
      const before = Token(weth).balanceOf(self);
      if (pools[i] != 0n) {
        const args = abi.encode(pools[i], weth, usdc, remaining, SQRT_PRICE_LIMIT_X96, self, self);
        evm.call(self, 0n, swapV3.concat(args));
      } else {
        const key = abi.encode(currency0, currency1, fees[i], tickSpacings[i], 0n);
        const rest = abi.encode(zeroForOne ? 1n : 0n, -remaining, SQRT_PRICE_LIMIT_X96, self, self);
        evm.call(
          self,
          0n,
          swapV4.concat(abi.encode(UniswapV4.PoolManager)).concat(key).concat(rest)
        );
      }
      remaining -= before - Token(weth).balanceOf(self);
    }

    // 4. Settle: the checks, the USDC out, every unsold WETH back.
    const spent = AMOUNT_IN - remaining;
    const out = Token(usdc).balanceOf(self) - outBefore;
    require(out >= MIN_OUT, "output below MIN_OUT");
    require(out * 10n ** 18n >= MIN_AVG_PRICE * spent, "average price below MIN_AVG_PRICE");
    Token(usdc).transfer(RECIPIENT, out);
    const unsold = Token(weth).balanceOf(self);
    if (unsold > 0n) {
      Token(weth).transfer(REFUND_TO, unsold);
    }
  },
  { tokens: [{ token: 0x4200000000000000000000000000000000000006n, amount: AMOUNT_IN }] }
).reward({ tokens: [{ token: WETH, amount: REWARD }] });
