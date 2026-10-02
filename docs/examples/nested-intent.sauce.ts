// The body of an intent to Base, which opens an intent of its own back to Ethereum.
//
// It runs on Base, in the fulfilment of the outer intent, so `amount` is measured there: what the
// solver delivered to the Pot. The intent it opens carries that amount on to Ethereum, less a tenth
// of a percent the next solver keeps for filling it. Its reward is paid into its vault on Base's
// Portal, and it is published, in this same fulfilment.
//
// Every `USDC` is the USDC of the chain where its part runs: the first line's and the reward's are
// Base's, the inner body's is Ethereum's. RECIPIENT and MIN_AMOUNT are defines.
const amount = USDC.balanceOf(ctx.self());
require(amount >= MIN_AMOUNT, "nothing arrived to forward");
const payout = amount - amount / 1000n;
Ethereum(() => {
  USDC.transfer(RECIPIENT, payout);
}).reward({ tokens: [{ token: USDC, amount }] });
