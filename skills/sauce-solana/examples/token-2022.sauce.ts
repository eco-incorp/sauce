// Pays `amount` of PYUSD, a Token-2022 mint, from the Pot's own account, and returns what the
// destination received: the amount less any transfer fee the mint withholds.
//
// `transferChecked` takes the mint as an account and its decimals, and calls the token program that
// owns the mint, the source and the destination: Token-2022 here, the SPL Token program for a legacy
// mint, the same call either way. Each account is passed by its token: `program:PYUSD` is the mint's
// token program, `mint:PYUSD` the mint, `pot:PYUSD` the Pot's account for it.
//
//   sauce run token-2022.sauce.ts --chain <chain> --config sauce.config.json --keypair <keypair> \
//     --account tokenProgram=program:PYUSD --account source=pot:PYUSD --account mint=mint:PYUSD \
//     --account destination=<token account> --account pot=pot --args <amount>
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
  transferChecked(PYUSD, tokenProgram, source, mint, destination, pot, amount, 6n);
  return balanceOf(PYUSD, destination) - before;
}
