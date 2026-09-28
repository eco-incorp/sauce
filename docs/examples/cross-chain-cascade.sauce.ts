// Three hops, written as three intents opening one another.
//
// No amount below the first exists when this is signed. `amount` is measured here. `swapped` is
// measured on Arbitrum while that hop is being fulfilled, by the program the middle braces compiled
// to, and it is the reward of the third hop. Each level's numbers are filled in by the level above
// it, at that level's own execution time.
//
// The middle body is more than token writes, so it compiles to a program and runs on Arbitrum's
// Pot; its second argument names what a solver must deliver for it to have something to measure.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum(
    () => {
      const swapped = USDC.balanceOf(ctx.self());
      Optimism(() => {
        USDC.transfer(RECIPIENT, swapped);
      }).reward({ tokens: [{ token: USDC, amount: swapped }] });
    },
    { tokens: [{ token: USDC, amount }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
}
