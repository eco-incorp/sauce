// Three hops, written as three intents opening one another: Base, then Ethereum, then Base again.
//
// No amount below the first exists when this is signed. `amount` is measured here, on Base.
// `arrived` is measured on Ethereum while that hop is being fulfilled, by the program the middle
// braces compiled to, and it is the reward of the third hop. Each level's numbers are filled in by
// the level above it, at that level's own execution time.
//
// The middle body is more than token writes, so it compiles to a program and runs on Ethereum's
// Pot; its second argument names what a solver must deliver for it to have something to measure.
//
// Every `USDC` is the USDC of the chain where that part runs. Each body's is its destination's. Each
// reward is escrowed by the program offering it, so the Ethereum hop's reward is Base's USDC and the
// last hop's is Ethereum's.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  Ethereum(
    () => {
      const arrived = USDC.balanceOf(ctx.self());
      Base(() => {
        USDC.transfer(RECIPIENT, arrived);
      }).reward({ tokens: [{ token: USDC, amount: arrived }] });
    },
    { tokens: [{ token: USDC, amount }] },
  ).reward({ tokens: [{ token: USDC, amount }] });
}
