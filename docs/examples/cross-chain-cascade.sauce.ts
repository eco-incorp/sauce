// Three hops, written as three intents opening one another: Base, then Ethereum, then Base again.
// All of it is SauceScript, opened on Ethereum and published from a wallet:
//   sauce intent publish cross-chain-cascade.sauce.ts --chain ethereum \
//     --intent-deadline … --intent-creator … --intent-execution-fee auto \
//     --args <recipient> <delivered> <reward>
//
//   recipient: Address  who is paid on Base, at the end
//   delivered: Uint256  the USDC a solver delivers to Base for the first hop, in base units
//   reward: Uint256     the USDC on Ethereum that pays that solver
//
// Only the first hop's amounts exist when this is signed. `amount` is measured on Base, while the
// first hop is being fulfilled. `arrived` is measured on Ethereum while the second is, by the
// program the middle braces compiled to, and it is the reward of the third. Each level's numbers
// are filled in by the level above it, at that level's own execution time.
//
// The first two bodies are more than token writes, so each compiles to a program and runs on its
// chain's Pot; the second argument of each names what a solver must deliver for it to have
// something to measure.
//
// Every `USDC` is the USDC of the chain where that part runs. Each body's is its destination's. Each
// reward is escrowed by the program offering it: the first hop's in Ethereum's USDC, the second's in
// Base's and the third's in Ethereum's.
function main(recipient: Address, delivered: Uint256, reward: Uint256) {
  Base(
    () => {
      const amount = self.USDC;
      Ethereum(
        () => {
          const arrived = self.USDC;
          Base(() => {
            USDC.transfer(recipient, arrived);
          }).reward({ tokens: [{ token: USDC, amount: arrived }] });
        },
        { tokens: [{ token: USDC, amount }] },
      ).reward({ tokens: [{ token: USDC, amount }] });
    },
    { tokens: [{ token: USDC, amount: delivered }] },
  ).reward({ tokens: [{ token: USDC, amount: reward }] });
}
