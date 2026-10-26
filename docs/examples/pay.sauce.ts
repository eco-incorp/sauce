// Pays `amount` of USDC from your Pot to `to`, and stops if the Pot holds less.
// The same file runs on Base and on Solana.
//
// Try it on a copy of the chain first: no password, no money, nothing sent.
//
//   sauce simulate pay.sauce.ts --chain base --wallet me --assume-balance USDC:5 --args <recipient> 1000000
//
// Then run it for real: your wallet signs and pays the fee, and your Pot pays the USDC.
//
//   sauce run pay.sauce.ts --chain base --wallet me --args <recipient> 1000000
//
// On Solana, the same way, with a Solana wallet:
//
//   sauce simulate pay.sauce.ts --chain solana --wallet me-solana --assume-balance USDC:5 --args <recipient> 1000000
//   sauce run pay.sauce.ts --chain solana --wallet me-solana --args <recipient> 1000000
//
//   to: Address       who gets the USDC, an address on the chain it runs on
//   amount: Uint256   how much, in USDC's smallest unit: USDC has 6 decimals, so 1000000 is 1 USDC
function main(to: Address, amount: Uint256) {
  require(pot.USDC >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
