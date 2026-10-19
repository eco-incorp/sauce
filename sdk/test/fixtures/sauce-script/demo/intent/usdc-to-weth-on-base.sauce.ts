// From Arbitrum USDC to WETH on Base, as one cross-chain intent. A solver delivers `amountIn` of
// Base USDC to the destination Pot; the body buys WETH with it on every Base pool that takes a
// price limit (Uniswap V3, PancakeSwap V3, the three Aerodrome Slipstream factories, hookless
// Uniswap V4), cheapest first, one exact-input swap per pool, never paying more at the margin than
// the price `sqrtPriceLimitX96` encodes, LP fee included. It checks `minOut`, sends the WETH to
// `recipient` and returns every unsold USDC to `refundTo`. The solver earns `reward` of Arbitrum
// USDC, escrowed when the intent is published. The gap between `reward` (paid on Arbitrum) and
// `amountIn` (brought on Base) is the solver's margin.
//
// Nothing is measured on chain, so it is published from a wallet, with no Pot on Arbitrum, and
// main's arguments are fixed into the intent:
//
//   sauce intent publish programs/intent/usdc-to-weth-on-base.sauce.ts --chain arbitrum \
//     --config sauce.config.json --keystore <keystore> \
//     --intent-deadline <unix seconds> --intent-creator <address> \
//     --intent-execution-fee <Base Kitchen fee in wei> \
//     --args <amountIn> <reward> <sqrtPriceLimitX96> <minOut> <recipient> <refundTo>
//
// `--chain arbitrum` is the source: `USDC` in `.reward(...)` is Arbitrum's USDC. Inside the braces
// the body runs on Base: `UniswapV3.Factory` and `UniswapV4.PoolManager` are Base's, and every other
// Base address is a literal from the package's registry (tokens, pancakeswap-v3,
// aerodrome-slipstream).
//
// The arguments, in base units:
//   amountIn: Uint256           Base USDC the solver delivers (6 decimals)
//   reward: Uint256             Arbitrum USDC the solver earns (6 decimals)
//   sqrtPriceLimitX96: Uint256  the most USDC per WETH to pay at the margin, fee included, as
//                               Base's WETH/USDC sqrtPriceX96 (WETH is token0, so buying WETH
//                               pushes the price up: the limit is a ceiling)
//   minOut: Uint256             the least WETH to receive (18 decimals)
//   recipient, refundTo: Address  who gets the WETH, and who gets unsold USDC, on Base
//
// The limit is fee-inclusive: a pool charging fee f is stopped at limit * sqrt(1 - f) of its own
// sqrtPrice, so every fill costs at most the limit after its fee, and the pools are ranked by that
// same fee-inclusive price. When `amountIn` is enough to reach the limit everywhere, every pool ends
// at the same marginal cost, and what is left over is refunded.
function main(
  amountIn: Uint256,
  reward: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  recipient: Address,
  refundTo: Address,
) {
  Base(
    () => {
      require(sqrtPriceLimitX96 != 0n &&
        minOut != 0n &&
        recipient != 0n &&
        refundTo != 0n, "give every argument");
      const usdc = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n; // Base USDC, the input
      const weth = 0x4200000000000000000000000000000000000006n; // Base WETH, the output
      const pancakeV3Factory = 0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865n;
      const slipstreamFactories = [
        0x5e7bb104d84c7cb9b682aac2f3d509f5f406809an, // CLFactory (initial)
        0xade65c38cd4849adba595a4323a8c7ddfe89716an, // CLFactory (Gauge Caps)
        0xf8f2eb4940cfe7d13603dddd87f123820fc061efn, // CLFactory (Gauges V3)
      ];
      const self = ctx.self();
      const zeroForOne = usdc < weth; // false on Base: USDC is token1, so a lower price is better
      const currency0 = zeroForOne ? usdc : weth;
      const currency1 = zeroForOne ? weth : usdc;
      const outBefore = Token(weth).balanceOf(self);

      // 1. Discover the pools, their prices and their LP fees (in millionths). V3-style pools come
      //    from their factories, price from slot0() and fee from fee(); hookless V4 pools are named by
      //    key, priced from the PoolManager's storage (extsload of the pool's state, slot 6 of
      //    `pools`), which reads 0 where there is no pool, and charge their key's fee.
      const getPoolByFee = hex`1698ee82`; // getPool(address,address,uint24)
      const getPoolBySpacing = hex`28af8d0b`; // getPool(address,address,int24)
      const slot0 = hex`3850c7bd`;
      const feeOf = hex`ddca3f43`; // fee()
      const extsload = hex`1e2eaeaf`;
      let found = new Array(23); // 4 Uniswap V3 + 4 PancakeSwap V3 + 3 * 5 Slipstream
      let m = 0n;
      for (const fee of [100n, 500n, 3000n, 10000n]) {
        found[m] = UniswapV3.Factory.getPool(usdc, weth, fee);
        m++;
      }
      for (const fee of [100n, 500n, 2500n, 10000n]) {
        const query = getPoolByFee.concat(abi.encode(usdc, weth, fee));
        found[m] = abi.decode(evm.static(pancakeV3Factory, query), ["Address"])[0n];
        m++;
      }
      for (const factory of slipstreamFactories) {
        for (const tickSpacing of [1n, 50n, 100n, 200n, 2000n]) {
          const query = getPoolBySpacing.concat(abi.encode(usdc, weth, tickSpacing));
          found[m] = abi.decode(evm.static(factory, query), ["Address"])[0n];
          m++;
        }
      }
      let pools = new Array(27); // the 23 above + 4 V4 keys; a V3-style pool, or 0 for a V4 key
      let fees = new Array(27);
      let tickSpacings = new Array(27); // V4 keys only
      let prices = new Array(27);
      let n = 0n;
      for (let i = 0n; i < m; i++) {
        if (found[i] != 0n) {
          pools[n] = found[i];
          prices[n] = abi.decode(evm.static(found[i], slot0), ["Uint256"])[0n];
          fees[n] = abi.decode(evm.static(found[i], feeOf), ["Uint256"])[0n];
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

      // 2. Fee-inclusive prices. sqrt(1 - fee), scaled by 1e9, turns a pool's sqrtPrice into what a
      //    trade actually costs there, and the common limit into each pool's own limit. Rank the pools
      //    whose cost is still within the limit, cheapest first (an insertion sort of indexes).
      let limits = new Array(n);
      let costs = new Array(n);
      let order = new Array(n);
      let count = 0n;
      for (let i = 0n; i < n; i++) {
        const p = prices[i];
        const keep = Math.sqrt((1000000n - fees[i]) * 1000000000000n);
        limits[i] = zeroForOne
          ? (sqrtPriceLimitX96 * 1000000000n) / keep
          : (sqrtPriceLimitX96 * keep) / 1000000000n;
        costs[i] = zeroForOne ? (p * keep) / 1000000000n : (p * 1000000000n) / keep;
        if (p != 0n && (zeroForOne ? p > limits[i] : p < limits[i])) {
          let j = count;
          while (
            j > 0n &&
            (zeroForOne ? costs[i] > costs[order[j - 1n]] : costs[i] < costs[order[j - 1n]])
          ) {
            order[j] = order[j - 1n];
            j--;
          }
          order[j] = i;
          count++;
        }
      }

      // 3. One exact-input swap per pool through the Router (swapV3 / swapV4, reached through the Pot
      //    itself), each offered all the USDC still unsold under its own limit; each pool fills up to
      //    it and leaves the rest for the next.
      const swapV3 = hex`a5e2989d`;
      const swapV4 = hex`7c9e9da3`;
      let remaining = amountIn;
      for (let r = 0n; r < count && remaining > 0n; r++) {
        const i = order[r];
        const before = Token(usdc).balanceOf(self);
        if (pools[i] != 0n) {
          const args = abi.encode(pools[i], usdc, weth, remaining, limits[i], self, self);
          evm.call(self, 0n, swapV3.concat(args));
        } else {
          const key = abi.encode(currency0, currency1, fees[i], tickSpacings[i], 0n);
          const rest = abi.encode(zeroForOne ? 1n : 0n, -Int256(remaining), limits[i], self, self);
          evm.call(
            self,
            0n,
            swapV4.concat(abi.encode(UniswapV4.PoolManager)).concat(key).concat(rest)
          );
        }
        remaining -= before - Token(usdc).balanceOf(self);
      }

      // 4. Settle: the minimum, the WETH out, every unsold USDC back. The Pot is shared by every
      //    intent through Base's Portal, so nothing stays in it.
      const out = Token(weth).balanceOf(self) - outBefore;
      require(out >= minOut, "output below minOut");
      Token(weth).transfer(recipient, out);
      const unsold = Token(usdc).balanceOf(self);
      if (unsold > 0n) {
        Token(usdc).transfer(refundTo, unsold);
      }
    },
    { tokens: [{ token: 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913n, amount: amountIn }] }
  ).reward({ tokens: [{ token: USDC, amount: reward }] });
}
