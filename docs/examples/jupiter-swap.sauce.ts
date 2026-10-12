// Jupiter's own swap example, as one Sauce program.
//
// Ported from: Jupiter's Swap API quickstart, developers.jup.ag/docs/swap-api (its pages Get Quote,
// Build Swap Transaction and Send Swap Transaction). It sells 0.1 SOL for USDC from a wallet, in
// three steps:
//
//   1. GET /swap/v1/quote   inputMint SOL, outputMint USDC, amount 100000000, slippageBps 50
//   2. POST /swap/v1/swap   the quote and the wallet's key: a whole transaction, serialized, with
//                           its compute budget and priority fee
//   3. sign and send        the wallet signs that transaction and sends it
//
// Here the same swap is one program the Pot runs through the Kitchen. `jupiterSwap` asks Jupiter for
// the quote and for the swap's instruction (POST /swap/v1/swap-instructions) while the program
// compiles, built for the Pot as the swap's authority; the instruction's accounts ride after the
// program's, with the lookup tables the route names. Jupiter's floor is `minOut`, an input rather
// than 50 basis points off the quote, written into the instruction as the program runs, and what
// reached the Pot's USDC account is measured, returned and left there. The Pot swaps SPL tokens, so
// the SOL is wrapped: the Pot's WSOL account holds the 100000000 lamports, 0.1 SOL. The cook creates
// the Pot's USDC account when it has none.
//
//   sauce run jupiter-swap.sauce.ts --chain <chain> --keypair <keypair.json> --args <minOut>
//
//   minOut: Uint256   the least USDC to accept, in its smallest units (6 decimals): 15000000 is
//                     15 USDC; below it the whole transaction reverts
//
// On Solana, at least 15 USDC for the Pot's 0.1 SOL:
//
//   sauce run jupiter-swap.sauce.ts --chain solana --keypair <keypair.json> --args 15000000
function main(minOut: Uint256): Uint256 {
  return jupiterSwap(WSOL, USDC, 100000000, minOut);
}
