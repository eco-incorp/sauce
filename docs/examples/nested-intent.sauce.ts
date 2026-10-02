// An intent from Ethereum to Base whose body opens an intent of its own, from Base back to
// Ethereum. All of it is SauceScript, opened on Ethereum and published from a wallet:
//   sauce intent publish nested-intent.sauce.ts --chain ethereum \
//     --intent-deadline … --intent-creator … --intent-execution-fee auto \
//     --args <recipient> <delivered> <reward>
//
//   recipient: Address  who is paid on Ethereum, at the end
//   delivered: Uint256  the USDC a solver delivers to Base, in base units (6 decimals)
//   reward: Uint256     the USDC on Ethereum that pays that solver
//
// The outer body runs on Base, in the fulfilment of the outer intent, so `amount` is measured there:
// what the solver delivered to the Pot. The inner intent carries it on to Ethereum, less a tenth of
// a percent the next solver keeps. Its reward is paid into its vault on Base's Portal, and it is
// published, in that same fulfilment.
//
// Every `USDC` is the USDC of the chain where its part runs: the outer `.send(...)`'s is Ethereum's;
// the outer `.receive(...)`'s, the outer body's and the inner `.send(...)`'s are Base's; the inner
// `.receive(...)`'s and the inner body's are Ethereum's.
function main(recipient: Address, delivered: Uint256, reward: Uint256) {
  Base.Portal.send({ token: USDC, amount: reward })
    .receive({ token: USDC, amount: delivered })
    .then(() => {
      const amount = USDC.balanceOf(ctx.self());
      const payout = amount - amount / 1000n;
      Ethereum.Portal.send({ token: USDC, amount })
        .receive({ token: USDC, amount: payout })
        .then(() => {
          USDC.transfer(recipient, payout);
        });
    });
}
