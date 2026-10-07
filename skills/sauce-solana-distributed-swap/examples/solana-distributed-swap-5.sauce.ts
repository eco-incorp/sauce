// A limit buy over Solana's price-limited pools: up to `budget` of one token for another, never
// more than `maxPrice` for any unit, fees included. Five pool slots, the most one cook takes, each a
// pool at any venue that `sauce pools --chain solana` lists, which gives each slot's nine accounts
// too (with --slots 5). The program is solana-distributed-swap.sauce.ts with a fifth slot.
//
//   sauce run solana-distributed-swap-5.sauce.ts --chain <chain> --keypair <keypair> \
//     --accounts <accounts.json> --args <budget> <maxPrice> <minTokens> <maxAvgPrice>
//
// The accounts, by name, in one JSON object (or each as --account NAME=<value>):
//   authority     pot: the Pot, which signs for its accounts (owner, cooked with --via engine)
//   source        pot:<payToken>: the authority's account the budget is in
//   output        pot:<buyToken>: the authority's account what is bought arrives in
//   recipient     the account what is bought goes on to (output itself, to keep it there)
//   refund        the account what is left of the budget goes to (source itself, to keep it)
//   payMint       mint:<payToken>; buyMint, mint:<buyToken>
//   tokenProgram  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA, and token2022,
//                 TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb, and memo,
//                 MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
//   program<k> pool<k> config<k> vaultA<k> vaultB<k> extra<k> ticks<k>0 ticks<k>1 ticks<k>2
//                 slot k, 0 to 4: a pool's slot paying payToken, as sauce pools gives it; a slot
//                 with no pool is the System program, 11111111111111111111111111111111, in all nine
//
//   budget: Uint256       the most payToken to spend, in its base units: 1000000000 is 1,000 USDC
//   maxPrice: Uint256     the most one buyToken may cost, fees included: the price in whole tokens
//                         times 10^(18 + payDecimals − buyDecimals)
//   minTokens: Uint256    the least buyToken to receive, in its base units; less reverts the cook
//   maxAvgPrice: Uint256  the most the average may cost, in maxPrice's units; 0 turns it off
//
//   SOL for all of 1,000 USDC or nothing, at most 120 USDC each, rehearsed with no key:
//   sauce simulate solana-distributed-swap-5.sauce.ts --chain solana --owner <owner> \
//     --accounts <accounts.json> --assume-balance USDC:1000 \
//     --args 1000000000 120000000000000000 8333333334 0

// The swaps are `@sauce/router`'s: `trySwap` reads a pool's venue from its owner, skips a missing,
// empty, paused or past-limit pool and one whose fee is not one rate, else offers it the amount it
// is given up to the pool's own fee-adjusted limit, and returns what arrived.
import { trySwap } from "@sauce/router";

function main(
  authority: Account<Signer>,
  source: Account<Writable>,
  output: Account<Writable>,
  recipient: Account<Writable>,
  refund: Account<Writable>,
  payMint: Account,
  buyMint: Account,
  tokenProgram: Account,
  token2022: Account,
  memo: Account,
  program0: Account,
  pool0: Account<Writable>,
  config0: Account,
  vaultA0: Account<Writable>,
  vaultB0: Account<Writable>,
  extra0: Account<Writable>,
  ticks00: Account<Writable>,
  ticks01: Account<Writable>,
  ticks02: Account<Writable>,
  program1: Account,
  pool1: Account<Writable>,
  config1: Account,
  vaultA1: Account<Writable>,
  vaultB1: Account<Writable>,
  extra1: Account<Writable>,
  ticks10: Account<Writable>,
  ticks11: Account<Writable>,
  ticks12: Account<Writable>,
  program2: Account,
  pool2: Account<Writable>,
  config2: Account,
  vaultA2: Account<Writable>,
  vaultB2: Account<Writable>,
  extra2: Account<Writable>,
  ticks20: Account<Writable>,
  ticks21: Account<Writable>,
  ticks22: Account<Writable>,
  program3: Account,
  pool3: Account<Writable>,
  config3: Account,
  vaultA3: Account<Writable>,
  vaultB3: Account<Writable>,
  extra3: Account<Writable>,
  ticks30: Account<Writable>,
  ticks31: Account<Writable>,
  ticks32: Account<Writable>,
  program4: Account,
  pool4: Account<Writable>,
  config4: Account,
  vaultA4: Account<Writable>,
  vaultB4: Account<Writable>,
  extra4: Account<Writable>,
  ticks40: Account<Writable>,
  ticks41: Account<Writable>,
  ticks42: Account<Writable>,
  budget: Uint256,
  maxPrice: Uint256,
  minTokens: Uint256,
  maxAvgPrice: Uint256,
): { spent: Uint256; bought: Uint256; unspent: Uint256 } {
  const pay = payMint.address;
  const buy = buyMint.address;
  require(maxPrice > 0, "maxPrice is 0");
  require(ownerOf(pay, source) == authority.address, "source is not the authority's");
  require(ownerOf(buy, output) == authority.address, "output is not the authority's");
  require(balanceOf(pay, source) >= budget, "budget is not in source");
  const kept = balanceOf(pay, source) - budget; // the account's other payToken, never spent
  const before = balanceOf(buy, output);

  // Each slot in turn, offered all of the budget still unspent; trySwap decides and swaps.
  const trader = [authority, source, payMint, buyMint, tokenProgram, token2022, memo];
  trySwap(
    [program0, pool0, config0, vaultA0, vaultB0, extra0, ticks00, ticks01, ticks02],
    trader,
    balanceOf(pay, source) - kept,
    maxPrice,
    0,
    output,
  );
  trySwap(
    [program1, pool1, config1, vaultA1, vaultB1, extra1, ticks10, ticks11, ticks12],
    trader,
    balanceOf(pay, source) - kept,
    maxPrice,
    0,
    output,
  );
  trySwap(
    [program2, pool2, config2, vaultA2, vaultB2, extra2, ticks20, ticks21, ticks22],
    trader,
    balanceOf(pay, source) - kept,
    maxPrice,
    0,
    output,
  );
  trySwap(
    [program3, pool3, config3, vaultA3, vaultB3, extra3, ticks30, ticks31, ticks32],
    trader,
    balanceOf(pay, source) - kept,
    maxPrice,
    0,
    output,
  );
  trySwap(
    [program4, pool4, config4, vaultA4, vaultB4, extra4, ticks40, ticks41, ticks42],
    trader,
    balanceOf(pay, source) - kept,
    maxPrice,
    0,
    output,
  );

  // Settle: what was bought goes to the recipient, what is left of the budget back.
  const unspent = balanceOf(pay, source) - kept;
  const spent = budget - unspent;
  const bought = balanceOf(buy, output) - before;
  require(bought >= minTokens, "bought below minTokens");
  require(maxAvgPrice == 0 || spent * 10 ** 18 <= maxAvgPrice * bought, "average too high");
  if (bought > 0 && recipient.address != output.address) {
    const program = buyMint.owner == token2022.address ? token2022 : tokenProgram;
    transferChecked(buy, program, output, buyMint, recipient, authority, bought, decimals(buyMint));
  }
  if (unspent > 0 && refund.address != source.address) {
    const program = payMint.owner == token2022.address ? token2022 : tokenProgram;
    transferChecked(pay, program, source, payMint, refund, authority, unspent, decimals(payMint));
  }
  return { spent, bought, unspent };
}
