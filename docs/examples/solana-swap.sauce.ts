// Solana: buy WSOL with up to `amountIn` of the Pot's USDC at one Orca whirlpool, never paying more
// than `maxPrice` for any unit, and send what arrived to `to`. The pool is main's argument, and
// compiling adds every account the swap takes to main — the pool's nine, read from the pool when the
// cook is built, and the Pot's own — so the command is given none. A pool already past `maxPrice` is
// skipped (`trySwap` returns 0, and nothing moves); below `minOut` the whole transaction reverts.
//
//   sauce run solana-swap.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <pool> <to> <amountIn> <maxPrice> <minOut>
//
//   pool: Address       an Orca whirlpool trading USDC and WSOL (sauce pools --chain solana USDC WSOL)
//   to: Address         who gets the WSOL bought: a wallet's key
//   amountIn: Uint256   the most USDC to pay, in its smallest units (6 decimals): 100000000 is 100
//   maxPrice: Uint256   the most one WSOL may cost, fee included: USDC base units per WSOL base unit,
//                       times 10^18 (sauce pools prints each pool's own as maxPrice)
//   minOut: Uint256     the least WSOL to receive, in its smallest units (9 decimals)
//
// On Solana, 100 USDC at up to 200 USDC per SOL, for at least 0.4 SOL:
//
//   sauce run solana-swap.sauce.ts --chain solana --keypair <keypair> \
//     --args <pool> <recipient> 100000000 200000000000000000 400000000
function main(
  pool: Address,
  to: Address,
  amountIn: Uint256,
  maxPrice: Uint256,
  minOut: Uint256,
): Uint256 {
  const got = OrcaWhirlpool.trySwap(pool, USDC, WSOL, amountIn, maxPrice, minOut);
  if (got > 0) WSOL.transfer(to, got);
  return got;
}
