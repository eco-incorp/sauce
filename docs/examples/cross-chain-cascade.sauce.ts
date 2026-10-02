// Three hops, written as three intents opening one another.
//
// No amount below the first exists when this is signed. `amount` is measured here. `swapped` is
// measured on Arbitrum while that hop is being fulfilled, by the program the middle braces compiled
// to, and it is the reward of the third hop. Each level's numbers are filled in by the level above
// it, at that level's own execution time.
//
// The middle body is more than token writes, so it compiles to a program and runs on Arbitrum's
// Pot; its `.receive(...)` names what a solver must deliver for it to have something to measure.
//
// Every `USDC` is the USDC of the chain where that part runs. Each body's is its destination's. Each
// reward is escrowed by the program offering it, so the Arbitrum hop's reward is the first chain's
// USDC and the Optimism hop's is Arbitrum's.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Arbitrum.Portal.send({ token: USDC, amount })
    .receive({ token: USDC, amount })
    .then(() => {
      const swapped = USDC.balanceOf(ctx.self());
      Optimism.Portal.send({ token: USDC, amount: swapped })
        .receive()
        .then(() => {
          USDC.transfer(RECIPIENT, swapped);
        });
    });
}
