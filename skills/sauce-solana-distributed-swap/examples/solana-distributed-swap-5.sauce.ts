// A limit buy over Solana's price-limited pools: up to `budget` of one token for another, never
// more than `maxPrice` for any unit, fees included. Five pools, the most one cook takes, each at
// any venue that `sauce pools --chain solana` lists (with --slots 5), given by its address. The
// program is solana-distributed-swap.sauce.ts with a fifth slot: one more pool argument and one
// more swap.
//
//   sauce run solana-distributed-swap-5.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <pay> <buy> <pool0> <pool1> <pool2> <pool3> <pool4> \
//     <budget> <maxPrice> <minTokens> <maxAvgPrice> <recipient> <refund>
//
//   pay: Address          the token paid, its mint or symbol (USDC); the budget must be in the Pot
//   buy: Address          the token bought, the same way (WSOL)
//   pool0: Address        the first pool, as sauce pools --pay gives the pools (poolArgs, in slot
//                         order); an empty slot is the System program,
//                         11111111111111111111111111111111
//   pool1: Address        the second pool, the same way
//   pool2: Address        the third pool, the same way
//   pool3: Address        the fourth pool, the same way
//   pool4: Address        the fifth pool, the same way
//   budget: Uint256       the most payToken to spend, in its base units: 1000000000 is 1,000 USDC
//   maxPrice: Uint256     the most one buyToken may cost, fees included: the price in whole tokens
//                         times 10^(18 + payDecimals − buyDecimals)
//   minTokens: Uint256    the least buyToken to receive, in its base units; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in maxPrice's units; 0 turns it off
//   recipient: Address    receives what is bought; the Pot's own address keeps it in the Pot
//   refund: Address       receives what is left of the budget; the Pot's own address keeps it there
//
//   SOL for all of 1,000 USDC or nothing, at most 120 USDC each, simulated with no key:
//   sauce simulate solana-distributed-swap-5.sauce.ts --chain solana --owner <owner> \
//     --assume-balance USDC:1000 --args USDC WSOL <pool0> <pool1> <pool2> <pool3> <pool4> \
//     1000000000 120000000000000000 8333333334 0 <recipient> <refund>

// Each `Solana.swap` is `@sauce/router`'s swap at the pool's venue, read from the pool's owner: it
// returns 0 having moved nothing for an empty slot, a spent budget, an empty, paused or past-limit
// pool and one whose fee is not one rate, else offers the pool the amount it is given up to its own
// fee-adjusted limit, and returns what arrived in the Pot.
function main(
  pay: Address,
  buy: Address,
  pool0: Address,
  pool1: Address,
  pool2: Address,
  pool3: Address,
  pool4: Address,
  budget: Uint256,
  maxPrice: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
  recipient: Address,
  refund: Address,
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  require(maxPrice > 0, "maxPrice is 0");
  const held = Token(pay).balanceOf(ctx.self());
  require(held >= budget, "budget is not in the Pot");
  const kept = held - budget; // the Pot's other payToken, never spent
  const before = Token(buy).balanceOf(ctx.self());

  // Each slot in turn, offered all of the budget still unspent; swap decides and swaps.
  Solana.swap(pool0, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);
  Solana.swap(pool1, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);
  Solana.swap(pool2, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);
  Solana.swap(pool3, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);
  Solana.swap(pool4, pay, buy, Token(pay).balanceOf(ctx.self()) - kept, maxPrice, 0);

  // Settle: what was bought goes to the recipient, what is left of the budget to refund, each only
  // when it is not the Pot itself.
  const unspent = Token(pay).balanceOf(ctx.self()) - kept;
  const spent = budget - unspent;
  const bought = Token(buy).balanceOf(ctx.self()) - before;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  if (bought > 0 && recipient != Solana.self.address) {
    Token(buy).transfer(recipient, bought);
  }
  if (unspent > 0 && refund != Solana.self.address) {
    Token(pay).transfer(refund, unspent);
  }
  return { spent, bought, unspent };
}
