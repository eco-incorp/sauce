// SOL for USDC over Solana's pools, as a limit order: up to `budget` USDC, never more than
// `priceLimit` for any SOL, fees included, and at least `minTokens` SOL or nothing. The pools are
// found by key, as an EVM program finds a Uniswap pool by its fee: Orca's whirlpools of the pair at
// tick spacing 4 and 1, then Raydium's CLMM pools at fee 0.04% and 0.02%. The keys are chosen for
// SOL/USDC, its four deepest pools on mainnet, the deepest of each venue first; a key with no pool
// is skipped. Each pool is offered what is left of the budget and trades until its price, fee
// paid, reaches priceLimit. Compiling adds each pool's accounts to main, read from the pool when the
// cook is built, so the command is given no account.
//
//   sauce run solana-distributed-swap.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <budget> <priceLimit> <minTokens> <maxAvgPrice> <recipient>
//
//   budget: Uint256       the most USDC to spend, in its base units: 1000000000 is 1,000 USDC; it
//                         must be in the Pot's USDC account
//   priceLimit: Uint256   the most one SOL may cost, fees included: USDC base units per lamport,
//                         times 10^18; 120 USDC a SOL is 120000000000000000
//   minTokens: Uint256    the least SOL to buy, in lamports; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in priceLimit's units; 0 turns it off
//   recipient: Address    receives the SOL bought, as wrapped SOL, and the USDC left unspent
//
//   All of 1,000 USDC or nothing, at most 120 USDC a SOL, simulated with no key:
//   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
//     --assume-balance USDC:1000 --args 1000000000 120000000000000000 8333333334 0 <recipient>

// Each pool is found by its key: `Orca.Whirlpool.pool(USDC, WSOL, 4)` is the pool Orca's program
// keeps for the pair at tick spacing 4, and a loop over keys finds one pool for each. Each swap is
// `@sauce/router`'s at that venue: it returns 0 having moved nothing for a key with no pool, a spent
// budget, an empty or past-limit pool and one whose fee is not one rate, else offers the pool the
// amount it is given up to its own fee-adjusted limit, and returns what arrived in the Pot.
function main(
  budget: Uint256,
  priceLimit: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  require(self.USDC >= budget, "budget is not in the Pot");
  const kept = self.USDC - budget; // the Pot's other USDC, never spent

  // Each pool in turn, offered what is left of the budget.
  let bought = 0;
  for (const spacing of [4, 1]) {
    bought += Orca.Whirlpool.swap(
      Orca.Whirlpool.pool(USDC, WSOL, spacing),
      USDC,
      WSOL,
      self.USDC - kept,
      priceLimit,
      0,
    );
  }
  for (const fee of [400, 200]) {
    bought += Raydium.CLMM.swap(
      Raydium.CLMM.pool(USDC, WSOL, fee),
      USDC,
      WSOL,
      self.USDC - kept,
      priceLimit,
      0,
    );
  }

  const unspent = self.USDC - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  // The SOL bought and what is left of the budget both go to the recipient.
  if (bought > 0) WSOL.transfer(recipient, bought);
  if (unspent > 0) USDC.transfer(recipient, unspent);
  return { spent, bought, unspent };
}
