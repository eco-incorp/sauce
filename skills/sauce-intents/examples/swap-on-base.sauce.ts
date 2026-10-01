// Sells WETH for USDC on Base, paying the solver in WETH on the chain this runs on: one intent
// whose body is the distributed swap. A solver delivers AMOUNT_IN of WETH on Base; the body sells
// it on every Uniswap V3 and hookless Uniswap V4 pool with liquidity, each up to its own limit (the
// price paid, fee included, never below SQRT_PRICE_LIMIT_X96), best taker price first, one swap
// per pool, pays the USDC to RECIPIENT and returns the unsold WETH to REFUND_TO on Base. The
// solver earns REWARD of WETH. The whole file is the intent: top-level statements, no main, and
// every value a define. Nothing is measured on chain, so it can also be published from a wallet
// (sauce intent publish).
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
//
//   AMOUNT_IN: Uint256             Base WETH the solver delivers and the body sells, in its
//                                  smallest units (18 decimals): 1000000000000000000 is 1 WETH
//   REWARD: Uint256                the source chain's WETH the solver earns, in its smallest units:
//                                  above AMOUNT_IN by the solver's margin
//   SQRT_PRICE_LIMIT_X96: Uint256  Base's WETH/USDC pool price below which no pool sells (`sauce
//                                  price --chain base 2500 USDC per WETH` gives it)
//   MIN_OUT: Uint256               the least USDC out, in its smallest units (6 decimals):
//                                  2490000000 is 2,490 USDC
//   MIN_AVG_PRICE: Uint256         the least USDC per WETH sold, as USDC units per WETH unit times
//                                  1e18: 2490000000 is 2,490 USDC per WETH
//   RECIPIENT: Address             who receives the USDC on Base
//   REFUND_TO: Address             who receives the unsold WETH on Base
//   --intent-execution-fee: wei    Base's Kitchen fee for the body's cook; `auto` reads it through
//                                  --config
//
// From Ethereum, selling 1 WETH on Base no lower than 2,500 USDC per WETH, for 1.002 WETH:
//
//   sauce run swap-on-base.sauce.ts --chain ethereum --config sauce.config.json \
//     --keystore <keystore> --define AMOUNT_IN=1000000000000000000 \
//     --define REWARD=1002000000000000000 --define SQRT_PRICE_LIMIT_X96=3961408125713216879677197 \
//     --define MIN_OUT=2490000000 --define MIN_AVG_PRICE=2490000000 \
//     --define RECIPIENT=<address> --define REFUND_TO=<address> \
//     --intent-deadline <unix seconds> --intent-creator <address> --intent-execution-fee auto
import { uniswapV3, uniswapV4 } from "@sauce/router";

Base(
  () => {
    require(SQRT_PRICE_LIMIT_X96 != 0n && RECIPIENT != 0n && REFUND_TO != 0n, "set the defines");
    const self = ctx.self();
    const sellsToken0 = WETH < USDC; // selling token0 pushes the price down: higher is better
    const currency0 = sellsToken0 ? WETH : USDC;
    const currency1 = sellsToken0 ? USDC : WETH;
    const outBefore = USDC.balanceOf(self);
    const slot0 = hex`3850c7bd`;
    const liquidity = hex`1a686502`;
    const feeOf = hex`ddca3f43`;

    // 1. Discover the pools that can trade. Candidates 0-3 are Uniswap V3's fee tiers (the
    //    factory's pool: liquidity, then slot0 and fee), 4-7 the four standard hookless V4 keys,
    //    written in because an intent has no main to pass them (from the StateView: liquidity,
    //    then the price and fees). Liquidity before price: a pool with none keeps a stale price,
    //    which would rank first, so it is dropped before its price is read. Each pool's own limit
    //    is the caller's moved by sqrt(1 - fee), so the price paid, fee included, never passes it,
    //    and a pool priced past its own limit is left out. Each kept pool gets its taker price, fee
    //    included, to rank by.
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
        pool = UniswapV3.Factory.getPool(WETH, USDC, v3Tiers[k]);
        if (pool != 0n) {
          const [poolLiquidity] = abi.decode(evm.static(pool, liquidity), ["Uint256"]);
          inRange = poolLiquidity;
        }
        if (inRange != 0n) {
          const [sqrtPriceX96] = abi.decode(evm.static(pool, slot0), ["Uint256"]);
          const [poolFee] = abi.decode(evm.static(pool, feeOf), ["Uint256"]);
          spot = sqrtPriceX96;
          fee = poolFee;
        }
      } else {
        const id = crypto.keccak256(
          abi.encode(currency0, currency1, v4Fees[k - 4n], v4TickSpacings[k - 4n], 0n),
        );
        inRange = UniswapV4.StateView.getLiquidity(id);
        if (inRange != 0n) {
          const [sqrtPriceX96, tick, protocolFees, lpFee] = UniswapV4.StateView.getSlot0(id);
          // The protocol fee for this direction: selling token0's in the low 12 bits, token1's in
          // the next 12. It is taken first, and the LP fee from the rest.
          let protocolFee = protocolFees & 0xfffn;
          if (!sellsToken0) {
            protocolFee = (protocolFees >> 12n) & 0xfffn;
          }
          spot = sqrtPriceX96;
          fee = protocolFee + lpFee - (protocolFee * lpFee) / 1000000n;
        }
      }
      const root = Math.sqrt((1000000n - fee) * 10n ** 30n); // sqrt(1 - fee), times 1e18
      let limit = Math.mulDiv(SQRT_PRICE_LIMIT_X96, root, 10n ** 18n);
      if (sellsToken0) {
        limit = Math.mulDiv(SQRT_PRICE_LIMIT_X96, 10n ** 18n, root);
      }
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

    // 3. One exact-input swap per pool through @sauce/router, each offered all the WETH still
    //    unsold, up to its own limit; each pool fills what it can and leaves the rest, and the
    //    USDC, in the Pot.
    let remaining = AMOUNT_IN;
    for (let r = 0n; r < n && remaining > 0n; r++) {
      const i = order[r];
      const before = WETH.balanceOf(self);
      if (pools[i] != 0n) {
        uniswapV3(pools[i], WETH, USDC, remaining, limits[i], 0n, self);
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
          limits[i],
          0n,
          self,
        );
      }
      remaining -= before - WETH.balanceOf(self);
    }

    // 4. Settle: the checks, the USDC out, and the WETH back, on Base. This body runs on the
    //    shared intent Pot, which holds nothing of anyone's between intents, so it returns all
    //    the WETH there. A program on an owner's Pot returns only what is left of its amount
    //    (distributed-swap.sauce.ts), leaving the owner's other tokens in place.
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
