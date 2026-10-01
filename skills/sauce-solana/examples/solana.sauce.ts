// Pays `amount` of the SPL mint MINT from `source` to `destination`, and proves it arrived.
//
// A Solana program declares every account it touches as an `Account` parameter; the compiler
// returns them as the manifest, in this order, with these roles, and each is passed by name with
// `--account`. `amount` is the one runtime argument; MINT, a 32-byte key chosen per compile, is a
// module constant that `--define MINT=<mint>` replaces (base58, or 32-byte hex). The @sauce/token
// SVM arm checks each account's owner and mint before it reads or writes, and requires
// `tokenProgram` to be the SPL Token program.
//
//   sauce run solana.sauce.ts --chain <chain> --config sauce.config.json --keypair <keypair> \
//     --define MINT=<mint> --account tokenProgram=<SPL Token program> \
//     --account source=<the Pot's token account> --account destination=<token account> \
//     --account authority=pot --args <amount>
//
//   MINT: define                 the SPL mint paid, base58
//   tokenProgram: Account        the SPL Token program
//   source: Account<Writable>    the token account paying, the Pot's: pot:<mint>
//   destination: Account<Writable>  the token account paid
//   authority: Account<Signer>   who signs for `source`: pot, the Pot itself
//   amount: Uint256              how much, in the mint's smallest units: USDC has 6 decimals, so
//                                1000000 is 1 USDC
//
// On Solana, 1 USDC from the Pot's USDC account:
//
//   sauce run solana.sauce.ts --chain solana --config sauce.config.json --keypair <keypair> \
//     --define MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
//     --account tokenProgram=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
//     --account source=pot:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
//     --account destination=<token account> --account authority=pot --args 1000000
const MINT = 0n; // the SPL mint's 32-byte key: a define replaces it

function main(
  tokenProgram: Account,
  source: Account<Writable>,
  destination: Account<Writable>,
  authority: Account<Signer>,
  amount: Uint256,
): Uint256 {
  require(MINT != 0n, "set MINT");
  const before = balanceOf(MINT, destination);
  transfer(MINT, tokenProgram, source, destination, authority, amount);
  const after = balanceOf(MINT, destination);
  require(after - before == amount, "destination did not receive the amount");
  return after;
}
