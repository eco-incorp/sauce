// Three hops, written as three intents opening one another: Base, then Ethereum, then Base again.
// All of it is SauceScript, opened on Ethereum and published from a wallet:
//   sauce intent publish cross-chain-cascade.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <recipient> <delivered> <reward> <refundTo>
//
//   recipient: Address  who is paid on Base, at the end
//   delivered: Uint256  the USDC a solver delivers to Base for the first hop, in base units
//   reward: Uint256     the USDC on Ethereum that pays that solver
//   refundTo: Address   who reclaims any hop's reward if no solver earns it
//
// Only the first hop's amounts exist when this is signed. `amount` is measured on Base, while the
// first hop is being fulfilled. `arrived` is measured on Ethereum while the second is, by the
// program the middle body compiled to, and it is the reward of the third. Each level's numbers
// are filled in by the level above it, at that level's own execution time.
//
// The first two bodies are more than token writes, so each compiles to a program and runs on its
// chain's Pot, paying that chain's Kitchen fee, read for it; the `.receive(...)` of each names what
// a solver must deliver for it to have something to measure. Each level's deadlines count from when
// it opens, and each names its creator, `refundTo`: one a program opens has no default.
//
// Every `USDC` is the USDC of the chain where that part runs. Each body's is its destination's. Each
// reward is escrowed by the program offering it: the first hop's in Ethereum's USDC, the second's in
// Base's and the third's in Ethereum's.
function main(recipient: Address, delivered: Uint256, reward: Uint256, refundTo: Address) {
  Base.Portal.send({ token: USDC, amount: reward })
    .creator(refundTo)
    .receive({ token: USDC, amount: delivered })
    .then(() => {
      const amount = USDC.balanceOf(ctx.self());
      Ethereum.Portal.send({ token: USDC, amount })
        .creator(refundTo)
        .receive({ token: USDC, amount })
        .then(() => {
          const arrived = USDC.balanceOf(ctx.self());
          Base.Portal.send({ token: USDC, amount: arrived })
            .creator(refundTo)
            .receive({ token: USDC, amount: arrived })
            .then(() => {
              USDC.transfer(recipient, arrived);
            });
        });
    });
}
