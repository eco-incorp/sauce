// An intent BODY that measures what the calls before it left in the Pot and opens a new intent
// carrying it to Arbitrum. A body takes no `main` arguments, so RECIPIENT and MIN_AMOUNT are the
// defines its route is compiled with. This was the README's example until that became a program a
// Pot runs with `main(recipient, minAmount)`; the suites that run a body opening an intent keep it.
function main() {
  const amount = USDC.balanceOf(ctx.self());
  if (amount < MIN_AMOUNT) {
    throw "cross-chain-intent: nothing to forward";
  }

  Arbitrum(() => {
    USDC.transfer(RECIPIENT, amount);
  }).reward({ tokens: [{ token: USDC, amount }] });
}
