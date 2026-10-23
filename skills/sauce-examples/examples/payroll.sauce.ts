// Pays a payroll in USDC from the Pot: `budget` split among `recipients` by `weights`, each paid
// budget × weight ÷ the sum of the weights, and the last the rounding remainder, so the payroll
// spends exactly `budget`. A list that does not match its weights, a zero or repeated address, the
// Pot itself, weights that sum to zero, or a budget the Pot does not hold is refused before
// anything moves. Each payment is measured at its recipient. Returns what each one received, in
// order.
//
//   sauce run payroll.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <recipients> <weights> <budget>
//
//   recipients: Address[]  who is paid, as a JSON array of addresses
//   weights: Uint256[]     each recipient's share, a JSON array in the same order: [3, 2, 1] pays
//                          half, a third and a sixth
//   budget: Uint256        the USDC paid in all, in its base units (6 decimals): 6000000000 is
//                          6,000 USDC
//
// On Base, 6,000 USDC to three people at 3:2:1:
//
//   sauce run payroll.sauce.ts --chain base --keystore <keystore> \
//     --args '["<alice>","<bob>","<carol>"]' '[3,2,1]' 6000000000
function main(recipients: Address[], weights: Uint256[], budget: Uint256): Uint256[] {
  const count = recipients.length;
  require(count > 0 && weights.length == count, "give one weight per recipient");
  let total: Uint256 = 0;
  for (let i = 0; i < count; i++) {
    const to = recipients[i];
    require(to != 0 && to != pot, "a recipient is the zero address or the Pot");
    for (let j = 0; j < i; j++) {
      require(recipients[j] != to, "a recipient is listed twice");
    }
    total += weights[i];
  }
  require(total > 0, "the weights sum to 0");
  require(pot.USDC >= budget, "budget is not in the Pot");

  const paid: Uint256[] = new Array(count);
  let left = budget;
  for (let i = 0; i < count; i++) {
    const to = recipients[i];
    const share = i == count - 1 ? left : Math.mulDiv(budget, weights[i], total);
    left -= share;
    if (share > 0) {
      const before = to.USDC;
      USDC.transfer(to, share);
      paid[i] = to.USDC - before;
    }
  }
  return paid;
}
