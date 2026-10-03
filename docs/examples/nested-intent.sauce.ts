// An intent from Ethereum to Base whose body opens an intent of its own, from Base back to
// Ethereum. All of it is SauceScript, opened on Ethereum and published from a wallet:
//   sauce intent publish nested-intent.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <recipient> <delivered> <reward> <refundTo>
//
//   recipient: Address  who is paid on Ethereum, at the end
//   delivered: Uint256  the USDC a solver delivers to Base, in base units (6 decimals)
//   reward: Uint256     the USDC on Ethereum that pays that solver
//   refundTo: Address   who reclaims either intent's reward if no solver earns it
//
// The outer body runs on Base, in the fulfilment of the outer intent, on a Pot every intent to Base
// shares: it moves `delivered`, what this intent delivered, never the Pot's whole balance. The inner
// intent carries it on to Ethereum, less a tenth of a percent the next solver keeps. Its reward is
// paid into its vault on Base's Portal, and it is published, in that same fulfilment.
//
// Every `USDC` is the USDC of the chain where its part runs: the outer reward's is Ethereum's; the
// outer body's, its delivery's and the inner reward's are Base's; the inner body's is Ethereum's.
function main(recipient: Address, delivered: Uint256, reward: Uint256, refundTo: Address) {
  Base.Portal.send({ token: USDC, amount: reward })
    .refundee(refundTo)
    .receive({ token: USDC, amount: delivered })
    .then(() => {
      const payout = delivered - delivered / 1000;
      Ethereum.Portal.send({ token: USDC, amount: delivered })
        .refundee(refundTo) // every intent a program opens names its refundee
        .receive({ token: USDC, amount: payout })
        .then(() => {
          USDC.transfer(recipient, payout);
        });
    });
}
