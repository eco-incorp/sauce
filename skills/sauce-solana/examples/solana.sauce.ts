// Pays `amount` of the SPL mint `mint` from `source` to `destination`, and proves it arrived.
//
// A Solana program declares every account it touches as an `Account` parameter; the compiler
// returns them as the manifest, in this order, with these roles, and each is passed by name with
// `--account`. `mint` and `amount` are the runtime arguments, in order after the accounts: `mint`
// a public key, passed in base58. The @sauce/token SVM arm checks each account's owner and mint
// before it reads or writes, and requires `tokenProgram` to be the SPL Token program.
//
//   sauce run solana.sauce.ts --chain <chain> --keypair <keypair> \
//     --account tokenProgram=<SPL Token program> --account source=<the Pot's token account> \
//     --account destination=<token account> --account authority=pot --args <mint> <amount>
//
//   tokenProgram: Account        the SPL Token program
//   source: Account<Writable>    the token account paying, the Pot's: pot:<mint>
//   destination: Account<Writable>  the token account paid
//   authority: Account<Signer>   who signs for `source`: pot, the Pot itself
//   mint: Address                the SPL mint paid, base58
//   amount: Uint256              how much, in the mint's smallest units: USDC has 6 decimals, so
//                                1000000 is 1 USDC
//
// On Solana, 1 USDC from the Pot's USDC account:
//
//   sauce run solana.sauce.ts --chain solana --keypair <keypair> \
//     --account tokenProgram=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
//     --account source=pot:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
//     --account destination=<token account> --account authority=pot \
//     --args EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000000
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  destination: Account<Writable>,
  authority: Account<Signer>,
  mint: Address,
  amount: Uint256,
): Uint256 {
  const before = balanceOf(mint, destination);
  transfer(mint, tokenProgram, source, destination, authority, amount);
  const after = balanceOf(mint, destination);
  require(after - before == amount, "destination did not receive the amount");
  return after;
}
