import { uniswapV3 } from "@sauce/router";

// The body of an intent to Base: swap what arrived for WETH, and send the WETH bought on to
// Ethereum in an intent of its own. `bought` is the swap's output, known only when this runs, and
// it is the inner intent's reward as it is. POOL (a Base WETH/USDC Uniswap V3 pool), MIN_OUT and
// RECIPIENT are defines.
const amount = USDC.balanceOf(ctx.self());
const bought = uniswapV3(POOL, USDC, WETH, amount, 0n, MIN_OUT, ctx.self());
const payout = bought - bought / 1000n;
Ethereum(() => {
  WETH.transfer(RECIPIENT, payout);
}).reward({ tokens: [{ token: WETH, amount: bought }] });
