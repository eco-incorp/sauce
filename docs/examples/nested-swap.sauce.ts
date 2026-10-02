import { uniswapV3 } from "@sauce/router";

// The same shape with a swap in the middle: buy WETH on Base with the USDC delivered there, and send
// the WETH bought on to Ethereum. `bought` is the swap's output, known only when the outer body
// runs, and it is the inner intent's reward as it is. POOL (a Base WETH/USDC Uniswap V3 pool),
// MIN_OUT, AMOUNT, REWARD and RECIPIENT are defines.
Base(
  () => {
    const amount = USDC.balanceOf(ctx.self());
    const bought = uniswapV3(POOL, USDC, WETH, amount, 0n, MIN_OUT, ctx.self());
    const payout = bought - bought / 1000n;
    Ethereum(() => {
      WETH.transfer(RECIPIENT, payout);
    }).reward({ tokens: [{ token: WETH, amount: bought }] });
  },
  { tokens: [{ token: USDC, amount: AMOUNT }] },
).reward({ tokens: [{ token: USDC, amount: REWARD }] });
