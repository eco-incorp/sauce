// Three hops, written as three intents opening one another: Base, then Ethereum, then Base again.
// All of it is SauceScript, opened on Ethereum and published by a cook on your Pot:
//   sauce intent publish cross-chain-cascade.sauce.ts --chain ethereum --keystore <keystore> \
//     --fund USDC:<amount> --args <recipient> <delivered> <reward> <refundTo>
//
//   recipient: Address  who is paid on Base, at the end
//   delivered: Uint256  the USDC a solver delivers to Base for the first hop, in base units
//   reward: Uint256     the USDC on Ethereum that pays that solver
//   refundTo: Address   who reclaims any hop's reward if no solver earns it
//
// Each hop pays the next solver what it was delivered, and asks it for a tenth of a percent less:
// `second` is what the second hop delivers on Ethereum, `third` what the third delivers on Base.
// A body runs on a Pot every intent to its chain shares, so it moves only what its own intent
// delivered, never the Pot's whole balance. Each level is opened and published by the level above
// it, at that level's own execution time.
//
// Each body compiles to a program and runs on its chain's Pot, paying that chain's Kitchen fee,
// read for it; the `.receive(...)` of each names what a solver must deliver to it. Each level's
// deadlines count from when it opens, and each names its refundee, `refundTo`: no intent has a
// default one.
//
// Every `USDC` is the USDC of the chain where that part runs. Each body's is its destination's. Each
// reward is escrowed by the program offering it: the first hop's in Ethereum's USDC, the second's in
// Base's and the third's in Ethereum's.
function main(recipient: Address, delivered: Uint256, reward: Uint256, refundTo: Address) {
  Base.Portal.send({ token: USDC, amount: reward })
    .refundee(refundTo)
    .receive({ token: USDC, amount: delivered })
    .then(() => {
      const second = delivered - delivered / 1000;
      Ethereum.Portal.send({ token: USDC, amount: delivered })
        .refundee(refundTo)
        .receive({ token: USDC, amount: second })
        .then(() => {
          const third = second - second / 1000;
          Base.Portal.send({ token: USDC, amount: second })
            .refundee(refundTo)
            .receive({ token: USDC, amount: third })
            .then(() => {
              USDC.transfer(recipient, third);
            });
        });
    });
}
