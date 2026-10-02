// The CLI suites' program with array and bool arguments: pays each of `recipients` `amount` of
// `token` from the Pot, and as much again in the chain's USDC when `alsoUsdc`.
function main(token: Address, recipients: Address[], amount: Uint256, alsoUsdc: bool) {
  for (let i = 0; i < recipients.length; i = i + 1) {
    transfer(token, recipients[i], amount);
    if (alsoUsdc) {
      USDC.transfer(recipients[i], amount);
    }
  }
}
