// Deposits `amount` of the Pot's USDC into Circle Gateway, credited to `depositor`, and checks that
// the depositor's Gateway balance rose by exactly that amount. `depositFor` credits the address it
// is given; `deposit` would credit the caller, which is the Pot. Gateway's burn intents and
// attestations are off-chain: this program ends at the deposit, and the balance read back is the
// proof it landed.
//
//   sauce simulate gateway-deposit.sauce.ts --chain <chain> --owner <owner> \
//     --assume-balance USDC:<tokens> --args <amount> <depositor>
//
//   amount: Uint256     the USDC to deposit, in its base units (6 decimals, on Arc too, never the
//                       18 of Arc's native coin): 5000000 is 5 USDC; the Pot must hold it
//   depositor: Address  whose Gateway balance is credited: the user's own address to spend it
//                       through Gateway from their wallet
//
// On Arc Testnet, 5 USDC credited to a wallet (`--assume-balance` gives the Pot the 5 USDC for the
// simulation only; a cook needs the Pot to hold it):
//
//   sauce simulate gateway-deposit.sauce.ts --chain arc-testnet --owner <owner> \
//     --assume-balance USDC:5 --args 5000000 <depositor>
function main(amount: Uint256, depositor: Address): { deposited: Uint256; total: Uint256 } {
  require(amount > 0, "amount is 0");
  require(CircleGateway.GatewayWallet.isTokenSupported(USDC), "Gateway does not take USDC here");
  // Exactly `amount`, never `pot.USDC` whole: on Arc the Pot's native balance is the same money,
  // and any native fee the cook pays from the Pot comes out of it.
  require(pot.USDC >= amount, "amount is not in the Pot");

  const before = CircleGateway.GatewayWallet.totalBalance(USDC, depositor);
  USDC.approve(CircleGateway.GatewayWallet, amount);
  CircleGateway.GatewayWallet.depositFor(USDC, depositor, amount);
  const total = CircleGateway.GatewayWallet.totalBalance(USDC, depositor);
  require(total - before == amount, "the Gateway balance did not rise by the deposit");
  return { deposited: amount, total };
}
