// Sells WETH for USDC on Base, paying the solver in WETH on the chain this runs on: one intent
// whose body is a distributed swap. A solver delivers AMOUNT_IN of WETH on Base; the body goes once
// over every Uniswap V3 pool and hookless Uniswap V4 pool of the pair, and sells to each with
// liquidity the WETH still unsold, up to its own limit (the price paid, fee included, never below
// SQRT_PRICE_LIMIT_X96), then pays the USDC to RECIPIENT and returns the unsold WETH to REFUND_TO
// on Base. The solver earns REWARD of WETH. The whole file is the intent: top-level statements, no
// main, and every value a define. Nothing is measured on chain, so it can also be published from a
// wallet (sauce intent publish).
//
// `--chain` is the source chain: `WETH` in `.send(...)` is its WETH. In `.receive(...)`, and inside
// `.then(...)`'s braces, the body runs on Base: `WETH`, `USDC`, `UniswapV3.Factory`,
// `UniswapV3.Pool`, `UniswapV4.StateView` and `UniswapV4.PoolManager` there are Base's.
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

// A pool's own limit: the caller's sqrt price limit moved by sqrt(1 - fee), so that what the pool
// pays, fee included, never passes the caller's. Selling token0 pushes the price down: then the
// limit is a floor, and higher is better.
function ownLimit(limit: Uint256, fee: Uint256, sellsToken0: bool): Uint256 {
  const root = Math.sqrt((1000000n - fee) * 10n ** 30n); // sqrt(1 - fee), times 1e18
  if (sellsToken0) {
    return Math.mulDiv(limit, 10n ** 18n, root);
  }
  return Math.mulDiv(limit, root, 10n ** 18n);
}

Base.Portal.send({ token: WETH, amount: REWARD })
  .receive({ token: WETH, amount: AMOUNT_IN })
  .then(() => {
    require(SQRT_PRICE_LIMIT_X96 != 0n && RECIPIENT != 0n && REFUND_TO != 0n, "set the defines");
    const self = ctx.self();
    const sellsToken0 = WETH < USDC;
    const wethBefore = WETH.balanceOf(self);
    const usdcBefore = USDC.balanceOf(self);

    // One pass over the pools: each is offered all the WETH still unsold, up to its own limit, and
    // skipped when it is missing, has no liquidity, or is already past that limit. A pool fills
    // what it can and leaves the rest for the next.
    // Uniswap V3, by fee tier, each pool read through the `UniswapV3.Pool` namespace.
    for (const tier of [100n, 500n, 3000n, 10000n]) {
      const pool = UniswapV3.Factory.getPool(WETH, USDC, tier);
      if (pool != 0n) {
        if (UniswapV3.Pool(pool).liquidity() > 0n) {
          const limit = ownLimit(SQRT_PRICE_LIMIT_X96, UniswapV3.Pool(pool).fee(), sellsToken0);
          const price = UniswapV3.Pool(pool).slot0().sqrtPriceX96;
          const unsold = WETH.balanceOf(self);
          if (unsold > 0n && (sellsToken0 ? price > limit : price < limit)) {
            uniswapV3(pool, WETH, USDC, unsold, limit, 0n, self);
          }
        }
      }
    }
    // Uniswap V4's four standard hookless keys, read from the StateView. Its protocol fee for
    // this direction is taken first (selling token0's in the low 12 bits, token1's in the next 12),
    // and the LP fee from the rest.
    const currency0 = sellsToken0 ? WETH : USDC;
    const currency1 = sellsToken0 ? USDC : WETH;
    const v4Fees = [100n, 500n, 3000n, 10000n];
    const v4TickSpacings = [1n, 10n, 60n, 200n];
    for (let k = 0n; k < 4n; k++) {
      const id = crypto.keccak256(
        abi.encode(currency0, currency1, v4Fees[k], v4TickSpacings[k], 0n),
      );
      if (UniswapV4.StateView.getLiquidity(id) > 0n) {
        const slot0 = UniswapV4.StateView.getSlot0(id);
        let protocolFee = slot0.protocolFee & 0xfffn;
        if (!sellsToken0) {
          protocolFee = (slot0.protocolFee >> 12n) & 0xfffn;
        }
        const fee = protocolFee + slot0.lpFee - (protocolFee * slot0.lpFee) / 1000000n;
        const limit = ownLimit(SQRT_PRICE_LIMIT_X96, fee, sellsToken0);
        const unsold = WETH.balanceOf(self);
        if (
          unsold > 0n &&
          (sellsToken0 ? slot0.sqrtPriceX96 > limit : slot0.sqrtPriceX96 < limit)
        ) {
          uniswapV4(
            UniswapV4.PoolManager,
            WETH,
            USDC,
            unsold,
            v4Fees[k],
            v4TickSpacings[k],
            0n,
            limit,
            0n,
            self,
          );
        }
      }
    }

    // Settle on Base: the checks, the USDC out, and the WETH back. This body runs on the shared
    // intent Pot, which holds nothing of anyone's between intents, so it returns all the WETH there.
    const unsold = WETH.balanceOf(self);
    const spent = wethBefore - unsold;
    const out = USDC.balanceOf(self) - usdcBefore;
    require(out >= MIN_OUT, "output below MIN_OUT");
    require(out * 10n ** 18n >= MIN_AVG_PRICE * spent, "average price below MIN_AVG_PRICE");
    USDC.transfer(RECIPIENT, out);
    if (unsold > 0n) {
      WETH.transfer(REFUND_TO, unsold);
    }
  });
