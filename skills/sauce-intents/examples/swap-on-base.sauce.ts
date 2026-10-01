// Sells WETH for USDC on Base, paying the solver in WETH on the chain this runs on: one intent
// whose body is the distributed swap. A solver delivers AMOUNT_IN of WETH on Base; the body sells
// it on every Uniswap V3 and hookless Uniswap V4 pool with liquidity, each up to its own limit (the
// price paid, fee included, never below SQRT_PRICE_LIMIT_X96), best taker price first, one swap
// per pool, pays the USDC to RECIPIENT and returns the unsold WETH to REFUND_TO on Base. The solver earns REWARD of WETH. The whole file is the intent: top-level statements,
// no main, and every value a define. Nothing is measured on chain, so it can also be published
// from a wallet (sauce publish).
//
// `--chain` is the source chain: `WETH` in `.reward(...)` is its WETH. Inside the braces the body
// runs on Base: `UniswapV3.Factory` and `UniswapV4.PoolManager` are Base's, and Base's WETH and
// USDC are named by their addresses there (the tokens index lists them). An intent file imports
// nothing, so every other contract is reached by selector, with evm.static and evm.call.
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
    const sellsToken0 = weth < usdc; // selling token0 pushes the price down: higher is better
    const currency0 = sellsToken0 ? weth : usdc;
    const currency1 = sellsToken0 ? usdc : weth;
    const outBefore = Token(usdc).balanceOf(self);
    const slot0 = hex`3850c7bd`;
    const liquidity = hex`1a686502`;
    const feeOf = hex`ddca3f43`;
    const extsload = hex`1e2eaeaf`;

    // 1. Discover the pools that can trade. Candidates 0-3 are Uniswap V3's fee tiers (slot0,
    //    liquidity and fee of the factory's pool), 4-7 the standard hookless V4 keys (the pool's
    //    state in the PoolManager through extsload: price and fees, and 3 words on, liquidity).
    //    Each pool's own limit is the caller's moved by sqrt(1 - fee), so the price paid, fee
    //    included, never passes it; a pool with no liquidity, or priced past its own limit, is
    //    left out. Each kept pool gets its taker price, fee included, for the ranking.
    const v3Tiers = [100n, 500n, 3000n, 10000n];
    const v4Fees = [100n, 500n, 3000n, 10000n];
    const v4TickSpacings = [1n, 10n, 60n, 200n];
    let pools = new Array(8); // a V3 pool, or 0 for a V4 key
    let fees = new Array(8);
    let tickSpacings = new Array(8);
    let limits = new Array(8);
    let prices = new Array(8);
    let n = 0n;
    for (let k = 0n; k < 8n; k++) {
      let pool = 0n;
      let spot = 0n;
      let fee = 0n;
      let inRange = 0n;
      if (k < 4n) {
        pool = UniswapV3.Factory.getPool(weth, usdc, v3Tiers[k]);
        if (pool != 0n) {
          spot = abi.decode(evm.static(pool, slot0), ["Uint256"])[0n];
          fee = abi.decode(evm.static(pool, feeOf), ["Uint256"])[0n];
          inRange = abi.decode(evm.static(pool, liquidity), ["Uint256"])[0n];
        }
      } else {
        const id = crypto.keccak256(
          abi.encode(currency0, currency1, v4Fees[k - 4n], v4TickSpacings[k - 4n], 0n)
        );
        const state = crypto.keccak256(abi.encode(id, 6n));
        const read = extsload.concat(abi.encode(state));
        const word = abi.decode(evm.static(UniswapV4.PoolManager, read), ["Uint256"])[0n];
        spot = word & ((1n << 160n) - 1n);
        let protocolFee = (word >> 184n) & 0xfffn; // selling token0; token1's is the next 12 bits
        if (!sellsToken0) {
          protocolFee = (word >> 196n) & 0xfffn;
        }
        const lpFee = (word >> 208n) & 0xffffffn;
        fee = protocolFee + lpFee - (protocolFee * lpFee) / 1000000n;
        const readLiquidity = extsload.concat(abi.encode(state + 3n));
        inRange = abi.decode(evm.static(UniswapV4.PoolManager, readLiquidity), ["Uint256"])[0n];
      }
      const root = Math.sqrt((1000000n - fee) * 10n ** 30n); // sqrt(1 - fee), times 1e18
      let limit = Math.mulDiv(SQRT_PRICE_LIMIT_X96, root, 10n ** 18n);
      if (sellsToken0) {
        limit = Math.mulDiv(SQRT_PRICE_LIMIT_X96, 10n ** 18n, root);
      }
      // Liquidity before price: a pool with none keeps a stale price, which would rank first.
      if (inRange != 0n && spot != 0n && (sellsToken0 ? spot > limit : spot < limit)) {
        const mid = Math.mulDiv(spot, spot, 1n << 96n);
        let price = Math.mulDiv(mid, 1000000n, 1000000n - fee);
        if (sellsToken0) {
          price = Math.mulDiv(mid, 1000000n - fee, 1000000n);
        }
        pools[n] = pool;
        if (k >= 4n) {
          fees[n] = v4Fees[k - 4n];
          tickSpacings[n] = v4TickSpacings[k - 4n];
        }
        limits[n] = limit;
        prices[n] = price;
        n++;
      }
    }

    // 2. Rank: an insertion sort of the kept pools' indexes, best taker price first.
    let order = new Array(n);
    for (let i = 0n; i < n; i++) {
      let j = i;
      while (
        j > 0n &&
        (sellsToken0 ? prices[i] > prices[order[j - 1n]] : prices[i] < prices[order[j - 1n]])
      ) {
        order[j] = order[j - 1n];
        j--;
      }
      order[j] = i;
    }

    // 3. One exact-input swap per pool through the Router (swapV3 / swapV4, by selector), each
    //    offered all the WETH still unsold, up to its own limit; each pool fills what it can and
    //    leaves the rest for the next.
    const swapV3 = hex`a5e2989d`;
    const swapV4 = hex`7c9e9da3`;
    let remaining = AMOUNT_IN;
    for (let r = 0n; r < n && remaining > 0n; r++) {
      const i = order[r];
      const before = Token(weth).balanceOf(self);
      if (pools[i] != 0n) {
        const args = abi.encode(pools[i], weth, usdc, remaining, limits[i], self, self);
        evm.call(self, 0n, swapV3.concat(args));
      } else {
        const key = abi.encode(currency0, currency1, fees[i], tickSpacings[i], 0n);
        const rest = abi.encode(sellsToken0 ? 1n : 0n, -remaining, limits[i], self, self);
        evm.call(
          self,
          0n,
          swapV4.concat(abi.encode(UniswapV4.PoolManager)).concat(key).concat(rest)
        );
      }
      remaining -= before - Token(weth).balanceOf(self);
    }

    // 4. Settle: the checks, the USDC out, every unsold WETH back, on Base.
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
