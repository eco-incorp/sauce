// Pays `amount` of Tesla stock (TSLAx, Backed's tokenized Tesla, a Token-2022 mint) from the Pot to
// `payee`, with each account bound before anything moves: `source` must be the Pot's own TSLAx
// account, `destination` the payee's, and the Pot must keep at least `keep` after paying. Returns
// what the payee received, measured at the destination, and what the Pot has left.
//
// `transferChecked` takes the mint's token program, the mint and its decimals beside the token
// accounts. `sauce` names each by the symbol: `program:TSLAx` the token program, `mint:TSLAx` the
// mint, `pot:TSLAx` the Pot's TSLAx account. The program is too large for one Solana transaction
// with its accounts, so `sauce run` stages it first.
//
//   sauce run pay-stock.sauce.ts --chain <chain> --keypair <keypair> \
//     --account tokenProgram=program:TSLAx --account source=pot:TSLAx --account mint=mint:TSLAx \
//     --account destination=<token account> --account pot=pot --args <payee> <amount> <keep>
//
//   tokenProgram: Account            the token program that owns TSLAx, Token-2022: program:TSLAx
//   source: Account<Writable>        the TSLAx account paying, the Pot's: pot:TSLAx
//   mint: Account                    the TSLAx mint: mint:TSLAx
//   destination: Account<Writable>   the payee's TSLAx token account
//   pot: Account<Signer>             the Pot, which owns `source` and signs for it: pot
//   payee: Address                   who is paid: the owner of `destination`, a base58 public key
//   amount: Uint256                  how much, in TSLAx's base units (8 decimals): 100000000 is
//                                    one token
//   keep: Uint256                    the least the Pot keeps after paying, in the same units
//
// On Solana, one TSLAx, the Pot keeping at least two:
//
//   sauce run pay-stock.sauce.ts --chain solana --keypair <keypair> \
//     --account tokenProgram=program:TSLAx --account source=pot:TSLAx --account mint=mint:TSLAx \
//     --account destination=<token account> --account pot=pot --args <payee> 100000000 200000000
function main(
  tokenProgram: Account,
  source: Account<Writable>,
  mint: Account,
  destination: Account<Writable>,
  pot: Account<Signer>,
  payee: Address,
  amount: Uint256,
  keep: Uint256,
): { received: Uint256; left: Uint256 } {
  require(ownerOf(TSLAx, source) == pot.address, "source is not the Pot's TSLAx account");
  require(ownerOf(TSLAx, destination) == payee, "destination is not the payee's TSLAx account");
  require(balanceOf(TSLAx, source) >= amount + keep, "the Pot would keep less than keep");
  const before = balanceOf(TSLAx, destination);
  transferChecked(TSLAx, tokenProgram, source, mint, destination, pot, amount, 8n);
  return { received: balanceOf(TSLAx, destination) - before, left: balanceOf(TSLAx, source) };
}
