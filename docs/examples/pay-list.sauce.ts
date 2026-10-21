// Pays `amount` of USDC from your Pot to each of `recipients` in turn, and stops paying once the
// next payment would take the total past `limit`. Returns the total it paid.
//
//   sauce simulate pay-list.sauce.ts --chain base --wallet me --assume-balance USDC:5 --args '["<recipient>","<recipient>"]' 1000000 1500000
//   sauce run pay-list.sauce.ts --chain base --wallet me --args '["<recipient>","<recipient>"]' 1000000 1500000
//
//   recipients: Address[]   who gets paid, in order: addresses on Base
//   amount: Uint256         what each one gets, in USDC's smallest unit: 1000000 is 1 USDC
//   limit: Uint256          the most it pays in all, in the same unit
function main(recipients: Address[], amount: Uint256, limit: Uint256): Uint256 {
  let paid = 0;
  for (const to of recipients) {
    if (paid + amount > limit) {
      break;
    }
    require(self.USDC >= amount, "not enough USDC");
    USDC.transfer(to, amount);
    paid += amount;
  }
  return paid;
}
