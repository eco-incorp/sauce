// Pays a recipient in cash and in stock on Solana: `cash` of USDC and `shares` of TSLAx (Backed's
// tokenized Tesla), from the Pot, and returns the TSLAx that arrived. It is written as on an EVM
// chain, a transfer on each token's symbol. On Solana a balance is a token account's, so compiling
// adds the accounts each call moves through to main: the two token programs, the Pot, its accounts
// and the recipient's, each derived when the cook is built, so the command is given none. Each
// mint's own token program moves it: USDC is an SPL Token mint, TSLAx a Token-2022 mint, moved by
// the checked write with its decimals. After each transfer the program checks the account it paid
// belongs to `recipient`.
//
// It is past one Solana transaction, so `sauce run` stages it before the cook, and
// `sauce simulate` runs it staged, in a local copy of its accounts; `sauce tx` refuses it,
// naming how far over it is.
//
//   sauce run payout-solana.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <recipient> <cash> <shares>
//
//   recipient: Address   who is paid: a wallet's base58 key. Its USDC and TSLAx accounts are
//                        created before the cook where it has none (the owner paying the rent).
//   cash: Uint256        how much USDC, in its smallest units (6 decimals): 1000000 is 1 USDC
//   shares: Uint256      how much TSLAx, in its smallest units (8 decimals): 50000000 is half a
//                        TSLAx
//
// On Solana, 1 USDC and half a TSLAx:
//
//   sauce run payout-solana.sauce.ts --chain solana --keypair <keypair> \
//     --args <recipient> 1000000 50000000
function main(recipient: Address, cash: Uint256, shares: Uint256): Uint256 {
  require(self.USDC >= cash, "not enough USDC");
  USDC.transfer(recipient, cash);
  // A Token-2022 mint may withhold a transfer fee: measure what arrived rather than assume it.
  const before = recipient.TSLAx;
  TSLAx.transfer(recipient, shares);
  return recipient.TSLAx - before;
}
