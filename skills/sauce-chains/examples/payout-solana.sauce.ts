// Pays a recipient in cash and in stock on Solana: `cash` of USDC and `shares` of TSLAx (Backed's
// tokenized Tesla), from the Pot's own accounts, and returns the TSLAx that arrived. On an EVM chain
// the same payout is `USDC.transfer(recipient, cash)` and a second transfer on the stock's symbol.
// On Solana a balance lives in a token account, so every account the program touches is an
// `Account` parameter, attached by name with `--account`, and a symbol is the mint's 32-byte key.
// Each mint's own token program moves it: USDC is an SPL Token mint, moved with `transfer`; TSLAx is
// a Token-2022 mint, moved with `transferChecked`, which takes the mint's account and its decimals.
//
// It is past one Solana transaction, so `sauce run` stages it before the cook, and
// `sauce simulate` rehearses it staged, in a local copy of its accounts; `sauce tx` refuses it,
// naming how far over it is.
//
//   sauce run payout-solana.sauce.ts --chain <chain> --keypair <keypair> \
//     --account pot=pot --account usdcProgram=program:USDC --account potUsdc=pot:USDC \
//     --account toUsdc=<the recipient's USDC account> --account tslaxProgram=program:TSLAx \
//     --account tslaxMint=mint:TSLAx --account potTslax=pot:TSLAx \
//     --account toTslax=<the recipient's TSLAx account> --args <cash> <shares>
//
//   pot: Account<Signer>         the Pot, which owns both paying accounts and signs for them: pot
//   usdcProgram: Account         the token program that owns USDC, SPL Token: program:USDC
//   potUsdc: Account<Writable>   the Pot's USDC account: pot:USDC
//   toUsdc: Account<Writable>    the recipient's USDC account
//   tslaxProgram: Account        the token program that owns TSLAx, Token-2022: program:TSLAx
//   tslaxMint: Account           the TSLAx mint: mint:TSLAx
//   potTslax: Account<Writable>  the Pot's TSLAx account: pot:TSLAx
//   toTslax: Account<Writable>   the recipient's TSLAx account
//   cash: Uint256                how much USDC, in its smallest units (6 decimals): 1000000 is 1 USDC
//   shares: Uint256              how much TSLAx, in its smallest units (8 decimals): 50000000 is
//                                half a TSLAx
//
// On Solana, 1 USDC and half a TSLAx:
//
//   sauce run payout-solana.sauce.ts --chain solana --keypair <keypair> \
//     --account pot=pot --account usdcProgram=program:USDC --account potUsdc=pot:USDC \
//     --account toUsdc=<the recipient's USDC account> --account tslaxProgram=program:TSLAx \
//     --account tslaxMint=mint:TSLAx --account potTslax=pot:TSLAx \
//     --account toTslax=<the recipient's TSLAx account> --args 1000000 50000000
function main(
  pot: Account<Signer>,
  usdcProgram: Account,
  potUsdc: Account<Writable>,
  toUsdc: Account<Writable>,
  tslaxProgram: Account,
  tslaxMint: Account,
  potTslax: Account<Writable>,
  toTslax: Account<Writable>,
  cash: Uint256,
  shares: Uint256,
): Uint256 {
  // The Pot's USDC is its token account's, read with the mint first.
  require(balanceOf(USDC, potUsdc) >= cash, "not enough USDC");
  transfer(USDC, usdcProgram, potUsdc, toUsdc, pot, cash);
  // A Token-2022 mint may withhold a transfer fee: measure what arrived rather than assume it.
  const before = balanceOf(TSLAx, toTslax);
  transferChecked(TSLAx, tslaxProgram, potTslax, tslaxMint, toTslax, pot, shares, 8);
  return balanceOf(TSLAx, toTslax) - before;
}
