// Pays `amount` of the SPL mint MINT from `source` to `destination`, and proves it arrived.
//
// A Solana program declares every account it touches as an `Account` parameter; the compiler
// returns them as the manifest, in this order, with these roles, and each is passed by name with
// `--account`. `amount` is the one runtime argument; MINT, a 32-byte key, is a define. The
// @sauce/token SVM arm checks each account's owner and mint before it reads or writes, and
// requires `tokenProgram` to be the SPL Token program.
//
//   sauce run solana.sauce.ts --chain <chain> --config sauce.config.json --keypair <keypair> \
//     --define MINT=<mint, as 32-byte hex> --account tokenProgram=<SPL Token program> \
//     --account source=<the Pot's token account> --account destination=<token account> \
//     --account authority=pot --args <amount>
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  destination: Account<Writable>,
  authority: Account<Signer>,
  amount: Uint256
): Uint256 {
  const before = balanceOf(MINT, destination);
  transfer(MINT, tokenProgram, source, destination, authority, amount);
  const after = balanceOf(MINT, destination);
  require(after - before == amount, "destination did not receive the amount");
  return after;
}
