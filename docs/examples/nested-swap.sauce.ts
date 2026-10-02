import { uniswapV3 } from "@sauce/router";

// The nested intent with a swap in the middle: buy WETH on Base with the USDC delivered there, and
// send the WETH bought on to Ethereum. `bought` is the swap's output, known only when the outer body
// runs, and it is the inner intent's reward as it is. Opened on Ethereum and published from a
// wallet:
//   sauce intent publish nested-swap.sauce.ts --chain ethereum --intent-deadline … \
//     --intent-creator … --intent-execution-fee auto --args <recipient> <delivered> <reward> <minOut>
//
//   recipient: Address  who is paid the WETH on Ethereum, at the end
//   delivered: Uint256  the USDC a solver delivers to Base, in base units (6 decimals)
//   reward: Uint256     the USDC on Ethereum that pays that solver
//   minOut: Uint256     the least WETH the swap may buy on Base, in base units (18 decimals)
//
// The swap is on Base's Uniswap V3 WETH/USDC pool at the 0.05% tier, looked up where the body runs.
function main(recipient: Address, delivered: Uint256, reward: Uint256, minOut: Uint256) {
  Base(
    () => {
      const amount = USDC.balanceOf(ctx.self());
      const pool = UniswapV3.Factory.getPool(USDC, WETH, 500);
      const bought = uniswapV3(pool, USDC, WETH, amount, 0, minOut, ctx.self());
      const payout = bought - bought / 1000;
      Ethereum(() => {
        WETH.transfer(recipient, payout);
      }).reward({ tokens: [{ token: WETH, amount: bought }] });
    },
    { tokens: [{ token: USDC, amount: delivered }] },
  ).reward({ tokens: [{ token: USDC, amount: reward }] });
}
