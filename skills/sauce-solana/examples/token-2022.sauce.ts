// Pays `amount` of PYUSD, a Token-2022 mint, from the Pot's own account, and returns what the
// destination received: the amount less any transfer fee the mint withholds.
//
// `transferChecked` takes the mint as an account and its decimals, and calls the token program that
// owns the mint, the source and the destination: Token-2022 here, the SPL Token program for a legacy
// mint, the same call either way. Each account is passed by its token: `program:PYUSD` is the mint's
// token program, `mint:PYUSD` the mint, `pot:PYUSD` the Pot's account for it.
//
//   sauce run token-2022.sauce.ts --chain <chain> --keypair <keypair> \
//     --account tokenProgram=program:PYUSD --account source=pot:PYUSD --account mint=mint:PYUSD \
//     --account destination=<token account> --account pot=pot --args <amount>
//
//   tokenProgram: Account            the token program that owns PYUSD, Token-2022: program:PYUSD
//   source: Account<Writable>        the token account paying, the Pot's: pot:PYUSD
//   mint: Account                    the PYUSD mint: mint:PYUSD
//   destination: Account<Writable>   the PYUSD token account paid
//   pot: Account<Signer>             the Pot, which owns `source` and signs for it: pot
//   amount: Uint256                  how much, in PYUSD's smallest units: it has 6 decimals, so
//                                    1000000 is 1 PYUSD
//
// On Solana, 1 PYUSD from the Pot's PYUSD account:
//
//   sauce run token-2022.sauce.ts --chain solana --keypair <keypair> \
//     --account tokenProgram=program:PYUSD --account source=pot:PYUSD --account mint=mint:PYUSD \
//     --account destination=<token account> --account pot=pot --args 1000000
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  mint: Account,
  destination: Account<Writable>,
  pot: Account<Signer>,
  amount: Uint256,
): Uint256 {
  require(ownerOf(PYUSD, source) == pot.address, "not the Pot's account");
  const before = balanceOf(PYUSD, destination);
  transferChecked(PYUSD, tokenProgram, source, mint, destination, pot, amount, 6);
  return balanceOf(PYUSD, destination) - before;
}
