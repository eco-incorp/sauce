// Pays `amount` of USDC from the Pot to `to`, as a program does on an EVM chain: the same source
// compiles for Base. On Solana a balance is a token account's, and compiling adds every account the
// calls move through to main — USDC's token program, the Pot, the Pot's USDC account and the USDC
// account of `to` — each with how it is derived (`sauce compile --json` lists them). The command
// derives each from the owner, the Pot and main's arguments, so it is given none. After the transfer
// the program checks the account it paid belongs to `to`.
//
//   sauce run pay.sauce.ts --chain <chain> --keypair <keypair> --args <to> <amount>
//
//   to: Address       who is paid: a wallet's base58 key. Its USDC account is created before the
//                     cook when it has none (the owner paying the rent, asked first, or --yes).
//   amount: Uint256   how much USDC, in its smallest units (6 decimals): 400 is 0.0004 USDC
//
// On Solana, 0.0004 USDC:
//
//   sauce run pay.sauce.ts --chain solana --keypair <keypair> --args <recipient> 400
function main(to: Address, amount: Uint256) {
  require(USDC.balanceOf(ctx.self()) >= amount, "not enough USDC");
  USDC.transfer(to, amount);
}
