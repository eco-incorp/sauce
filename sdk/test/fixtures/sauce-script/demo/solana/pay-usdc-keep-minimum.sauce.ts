// Pays `amount` USDC from the Pot to `recipient`, and fails unless the Pot still holds at least
// `minimum` USDC afterwards. Both are in USDC's smallest unit (6 decimals: 1000000 is 1 USDC).
//
// A Solana program declares every account it touches, so the recipient is an account too: the
// recipient's wallet, read-only, beside the USDC token account it is paid into. The program checks
// that token account belongs to the recipient, and that the account it pays from belongs to the Pot,
// so the minimum is measured on the Pot's own USDC. Any failed check reverts the whole cook,
// the transfer included. The recipient's USDC token account must already exist.
//
// The program is kept small enough for its cook to fit in one transaction, which `sauce simulate`
// needs (it cannot stage a larger one): short messages, and no check repeated.
//
//   sauce simulate pay-usdc-keep-minimum.sauce.ts --chain solana --owner <pubkey> \
//     --config sauce.config.json \
//     --account tokenProgram=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA \
//     --account potUsdc=<the Pot's USDC token account> \
//     --account recipientUsdc=<the recipient's USDC token account> \
//     --account recipient=<the recipient's wallet> --account pot=pot \
//     --args <amount> <minimum>

// The USDC mint on Solana mainnet (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v, the SDK's
// USDC_MINT), as a 32-byte key. `--define MINT=0x…` replaces it, for devnet's USDC.
const MINT = 0xc6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61n;

// Where an SPL token account keeps its owner (a 32-byte key) and its amount (a u64).
const TOKEN_ACCOUNT_OWNER = 32n;
const TOKEN_ACCOUNT_AMOUNT = 64n;

function main(
  tokenProgram: Account,
  potUsdc: Account<Writable>,
  recipientUsdc: Account<Writable>,
  recipient: Account,
  pot: Account<Signer>,
  amount: Uint256,
  minimum: Uint256
) {
  // balanceOf requires recipientUsdc to be an SPL Token account of MINT, and transfer requires the
  // same of potUsdc. Once checked, an account's owner and amount can be read from its bytes.
  const recipientBefore = balanceOf(MINT, recipientUsdc);
  const recipientUsdcOwner = svm.sload(recipientUsdc, TOKEN_ACCOUNT_OWNER, 32n).toBe();
  require(recipientUsdcOwner == recipient.address, "recipientUsdc is not the recipient's");

  transfer(MINT, tokenProgram, potUsdc, recipientUsdc, pot, amount);

  const potUsdcOwner = svm.sload(potUsdc, TOKEN_ACCOUNT_OWNER, 32n).toBe();
  require(potUsdcOwner == pot.address, "potUsdc is not the Pot's");
  const received = svm.sload(recipientUsdc, TOKEN_ACCOUNT_AMOUNT, 8n).toLe() - recipientBefore;
  require(received == amount, "recipient got a different amount");
  const kept = svm.sload(potUsdc, TOKEN_ACCOUNT_AMOUNT, 8n).toLe();
  require(kept >= minimum, "Pot would keep under the minimum");
}
