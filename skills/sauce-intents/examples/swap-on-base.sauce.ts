// Sells WETH for USDC on Base, paying the solver in WETH on the chain this runs on: one intent
// whose body is a distributed swap. A solver delivers `amountIn` of WETH on Base; the body goes once
// over every Uniswap V3 pool and hookless Uniswap V4 pool of the pair, and sells to each with
// liquidity the WETH still unsold, up to its own limit (the price paid, fee included, never below
// `sqrtPriceLimitX96`), then pays the USDC to `recipient` and returns the unsold WETH to `refundTo`
// on Base. The solver earns `reward` of WETH. Nothing is measured on chain, so it can also be
// published from a wallet (sauce intent publish, with the same --args).
//
// `--chain` is the source chain: `WETH` in `.reward(...)` is its WETH. Inside the braces, and in
// the delivery argument after them, the body runs on Base: `WETH`, `USDC`, `UniswapV3.Factory`,
// `UniswapV3.Pool`, `UniswapV4.StateView` and `UniswapV4.PoolManager` there are Base's.
//
//   sauce run swap-on-base.sauce.ts --chain <chain> \
//     --keystore <keystore> --intent-deadline <unix seconds> --intent-creator <address> \
//     --intent-execution-fee <Base Kitchen fee in wei> --args <amountIn> <reward> \
//     <sqrtPriceLimitX96> <minOut> <minAvgPrice> <recipient> <refundTo>
//
//   amountIn: Uint256            Base WETH the solver delivers and the body sells, in its smallest
//                                units (18 decimals): 1000000000000000000 is 1 WETH
//   reward: Uint256              the source chain's WETH the solver earns, in its smallest units:
//                                above amountIn by the solver's margin
//   sqrtPriceLimitX96: Uint256   Base's WETH/USDC pool price below which no pool sells (`sauce
//                                price --chain base 2500 USDC per WETH` gives it)
//   minOut: Uint256              the least USDC out, in its smallest units (6 decimals):
//                                2490000000 is 2,490 USDC
//   minAvgPrice: Uint256         the least USDC per WETH sold, as USDC units per WETH unit times
//                                1e18: 2490000000 is 2,490 USDC per WETH
//   recipient: Address           who receives the USDC on Base
//   refundTo: Address            who receives the unsold WETH on Base
//   --intent-execution-fee: wei  Base's Kitchen fee for the body's cook; `auto` reads it from
//                                Base
//
// From Ethereum, selling 1 WETH on Base no lower than 2,500 USDC per WETH, for 1.002 WETH:
//
//   sauce run swap-on-base.sauce.ts --chain ethereum \
//     --keystore <keystore> --intent-deadline <unix seconds> --intent-creator <address> \
//     --intent-execution-fee auto --args 1000000000000000000 1002000000000000000 \
//     3961408125713216879677197 2490000000 2490000000 <recipient> <refundTo>
import { uniswapV3, uniswapV4 } from "@sauce/router";

// A pool's own limit: the caller's sqrt price limit moved by sqrt(1 - fee), so that what the pool
// pays, fee included, never passes the caller's. Selling token0 pushes the price down: then the
// limit is a floor, and higher is better.
function ownLimit(limit: Uint256, fee: Uint256, sellsToken0: bool): Uint256 {
  const root = Math.sqrt((1000000 - fee) * 10 ** 30); // sqrt(1 - fee), times 1e18
  if (sellsToken0) {
    return Math.mulDiv(limit, 10 ** 18, root);
  }
  return Math.mulDiv(limit, root, 10 ** 18);
}

function main(
  amountIn: Uint256,
  reward: Uint256,
  sqrtPriceLimitX96: Uint256,
  minOut: Uint256,
  minAvgPrice: Uint256,
  recipient: Address,
  refundTo: Address,
) {
  Base(
    () => {
      require(sqrtPriceLimitX96 != 0 &&
        recipient != 0 &&
        refundTo != 0, "give sqrtPriceLimitX96, recipient and refundTo");
      const self = ctx.self();
      const sellsToken0 = WETH < USDC;
      const wethBefore = self.WETH;
      const usdcBefore = self.USDC;

      // One pass over the pools: each is offered all the WETH still unsold, up to its own limit, and
      // skipped when it is missing, has no liquidity, or is already past that limit. A pool fills
      // what it can and leaves the rest for the next.
      // Uniswap V3, by fee tier, each pool read through the `UniswapV3.Pool` namespace.
      for (const tier of [100, 500, 3000, 10000]) {
        const pool = UniswapV3.Factory.getPool(WETH, USDC, tier);
        if (pool != 0) {
          if (UniswapV3.Pool(pool).liquidity() > 0) {
            const limit = ownLimit(sqrtPriceLimitX96, UniswapV3.Pool(pool).fee(), sellsToken0);
            const price = UniswapV3.Pool(pool).slot0().sqrtPriceX96;
            const unsold = self.WETH;
            if (unsold > 0 && (sellsToken0 ? price > limit : price < limit)) {
              uniswapV3(pool, WETH, USDC, unsold, limit, 0, self);
            }
          }
        }
      }
      // Uniswap V4's four standard hookless keys, read from the StateView. Its protocol fee for
      // this direction is taken first (selling token0's in the low 12 bits, token1's in the next 12),
      // and the LP fee from the rest.
      const currency0 = sellsToken0 ? WETH : USDC;
      const currency1 = sellsToken0 ? USDC : WETH;
      const v4Fees = [100, 500, 3000, 10000];
      const v4TickSpacings = [1, 10, 60, 200];
      for (let k = 0; k < 4; k++) {
        const id = crypto.keccak256(
          abi.encode(currency0, currency1, v4Fees[k], v4TickSpacings[k], 0),
        );
        if (UniswapV4.StateView.getLiquidity(id) > 0) {
          const slot0 = UniswapV4.StateView.getSlot0(id);
          let protocolFee = slot0.protocolFee & 0xfff;
          if (!sellsToken0) {
            protocolFee = (slot0.protocolFee >> 12) & 0xfff;
          }
          const fee = protocolFee + slot0.lpFee - (protocolFee * slot0.lpFee) / 1000000;
          const limit = ownLimit(sqrtPriceLimitX96, fee, sellsToken0);
          const unsold = self.WETH;
          if (
            unsold > 0 &&
            (sellsToken0 ? slot0.sqrtPriceX96 > limit : slot0.sqrtPriceX96 < limit)
          ) {
            uniswapV4(
              UniswapV4.PoolManager,
              WETH,
              USDC,
              unsold,
              v4Fees[k],
              v4TickSpacings[k],
              0,
              limit,
              0,
              self,
            );
          }
        }
      }

      // Settle on Base: the checks, the USDC out, and the WETH back. This body runs on the shared
      // intent Pot, which holds nothing of anyone's between intents, so it returns all the WETH there.
      const unsold = self.WETH;
      const spent = wethBefore - unsold;
      const out = self.USDC - usdcBefore;
      require(out >= minOut, "output below minOut");
      require(out * 10 ** 18 >= minAvgPrice * spent, "average price below minAvgPrice");
      USDC.transfer(recipient, out);
      if (unsold > 0) {
        WETH.transfer(refundTo, unsold);
      }
    },
    { tokens: [{ token: WETH, amount: amountIn }] },
  ).reward({ tokens: [{ token: WETH, amount: reward }] });
}
