// An intent from Ethereum to Base whose body opens an intent of its own, from Base back to
// Ethereum. All of it is SauceScript, opened on Ethereum:
//   sauce intent publish nested-intent.sauce.ts --chain ethereum --define AMOUNT=… --define REWARD=…
//     --define RECIPIENT=… --intent-deadline … --intent-creator … --intent-execution-fee auto
//     --config sauce.config.json
//
// The outer body runs on Base, in the fulfilment of the outer intent, so `amount` is measured there:
// what the solver delivered to the Pot. The inner intent carries it on to Ethereum, less a tenth of
// a percent the next solver keeps. Its reward is paid into its vault on Base's Portal, and it is
// published, in that same fulfilment.
//
// Every `USDC` is the USDC of the chain where its part runs: the outer reward's is Ethereum's; the
// outer body's, its delivery's and the inner reward's are Base's; the inner body's is Ethereum's.
Base(
  () => {
    const amount = USDC.balanceOf(ctx.self());
    const payout = amount - amount / 1000n;
    Ethereum(() => {
      USDC.transfer(RECIPIENT, payout);
    }).reward({ tokens: [{ token: USDC, amount }] });
  },
  { tokens: [{ token: USDC, amount: AMOUNT }] },
).reward({ tokens: [{ token: USDC, amount: REWARD }] });
