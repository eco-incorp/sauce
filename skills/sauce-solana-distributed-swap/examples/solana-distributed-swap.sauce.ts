// SpaceX for USDC over Solana's pools, as a limit order: up to `budget` USDC, never more than
// `priceLimit` for any SPCX_US, fees included, and at least `minTokens` SPCX_US or nothing. SPCX_US
// is Backpack's SpaceX share, a Token-2022 mint. The pools are found by key, as an EVM program finds
// a Uniswap pool by its fee: Raydium's CLMM pools of the pair at fee 0.25% and 0.18%, Byreal's at
// 0.1% and PancakeSwap's at 0.08%, the pair's pools on mainnet that trade at a price, the deepest
// first; a key with no pool is skipped. Each pool is offered what is left of the budget and trades
// until its price, fee paid, reaches priceLimit. Compiling adds each pool's accounts to main, read
// from the pool when the cook is built, so the command is given no account.
//
//   sauce run solana-distributed-swap.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <budget> <priceLimit> <minTokens> <maxAvgPrice> <recipient>
//
//   budget: Uint256       the most USDC to spend, in its base units: 1000000000 is 1,000 USDC; it
//                         must be in the Pot's USDC account
//   priceLimit: Uint256   the most one SPCX_US may cost, fees included: USDC base units per SPCX_US
//                         base unit, times 10^18; both have 6 decimals, so 150 USDC a share is
//                         150000000000000000000
//   minTokens: Uint256    the least SPCX_US to buy, in its base units; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in priceLimit's units; 0 turns it off
//   recipient: Address    receives the SPCX_US bought and the USDC left unspent
//
//   All of 1,000 USDC or nothing, at most 150 USDC a share, simulated with no key:
//   sauce simulate solana-distributed-swap.sauce.ts --chain solana --owner <owner> \
//     --assume-balance USDC:1000 --args 1000000000 150000000000000000000 6666667 0 <recipient>

// Each pool is found by its key: `Raydium.CLMM.pool(USDC, SPCX_US, 2500)` is the pool Raydium's
// program keeps for the pair at fee 0.25%, and a loop over keys finds one pool for each. Each swap
// is `@sauce/router`'s at that venue: it returns 0 having moved nothing for a key with no pool, a
// spent budget, an empty or past-limit pool and one whose fee is not one rate, else offers the pool
// the amount it is given up to its own fee-adjusted limit, and returns what arrived in the Pot.
function main(
  budget: Uint256,
  priceLimit: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  require(pot.USDC >= budget, "budget is not in the Pot");
  const kept = pot.USDC - budget; // the Pot's other USDC, never spent

  // Each pool in turn, offered what is left of the budget.
  let bought = 0;
  for (const fee of [2500, 1800]) {
    bought += Raydium.CLMM.swap(
      Raydium.CLMM.pool(USDC, SPCX_US, fee),
      USDC,
      SPCX_US,
      pot.USDC - kept,
      priceLimit,
      0,
    );
  }
  bought += Byreal.CLMM.swap(
    Byreal.CLMM.pool(USDC, SPCX_US, 1000),
    USDC,
    SPCX_US,
    pot.USDC - kept,
    priceLimit,
    0,
  );
  bought += Pancakeswap.CLMM.swap(
    Pancakeswap.CLMM.pool(USDC, SPCX_US, 800),
    USDC,
    SPCX_US,
    pot.USDC - kept,
    priceLimit,
    0,
  );

  const unspent = pot.USDC - kept;
  const spent = budget - unspent;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  // The SPCX_US bought and what is left of the budget both go to the recipient.
  if (bought > 0) SPCX_US.transfer(recipient, bought);
  if (unspent > 0) USDC.transfer(recipient, unspent);
  return { spent, bought, unspent };
}
