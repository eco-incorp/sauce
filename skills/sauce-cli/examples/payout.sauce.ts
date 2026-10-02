// Pays out all the USDC the Pot holds when it runs, by weight: each payee gets its `bps` share of the
// balance, in basis points, and the last payee the rounding remainder too, so none is left behind.
// The weights must add up to 10,000. Returns what each payee was paid, in order.
//
//   sauce run payout.sauce.ts --chain <chain> --wallet <name> --password-env <NAME> \
//     --args <payees>
//
//   payees: { to: Address, bps: Uint256 }[]  who is paid, and their share of the balance in basis
//                                            points (10000 is all of it), as a JSON array of
//                                            records: '[{"to":"<payee>","bps":7000}]'
//
// On Base, 1,000 USDC pulled from the signer into the Pot and paid out in the same transaction, 70%
// to one payee and 30% to another:
//
//   sauce run payout.sauce.ts --chain base --wallet <name> --password-env <NAME> --fund USDC:1000 \
//     --args '[{"to":"<payee>","bps":7000},{"to":"<payee>","bps":3000}]'
function main(payees: { to: Address; bps: Uint256 }[]): Uint256[] {
  let weights = 0;
  for (const payee of payees) {
    weights += payee.bps;
  }
  require(weights == 10000, "the weights do not add up to 10000");
  const balance = USDC.balanceOf(ctx.self());
  require(balance > 0, "the Pot holds no USDC");

  const paid: Uint256[] = new Array(payees.length);
  let left = balance;
  for (let i = 0; i < payees.length; i++) {
    // Each share rounds down; the last payee takes what is left, rounding included.
    let amount = (balance * payees[i].bps) / 10000;
    if (i == payees.length - 1) {
      amount = left;
    }
    USDC.transfer(payees[i].to, amount);
    paid[i] = amount;
    left -= amount;
  }
  return paid;
}
