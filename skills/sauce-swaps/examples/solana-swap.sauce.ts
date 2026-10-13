// Buys WSOL with up to `amountIn` of the Pot's USDC at one Orca whirlpool, never paying more than
// `maxPrice` for any unit, and forwards what arrived to `to`. The pool is main's argument: compiling
// adds its nine accounts to main, read from the pool on the cluster when the cook is built, with the
// Pot's own, so the command is given none. A pool already past `maxPrice` is skipped (`trySwap`
// returns 0, and nothing moves); below `minOut` the cook reverts.
//
//   sauce run solana-swap.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <pool> <to> <amountIn> <maxPrice> <minOut>
//
//   pool: Address       an Orca whirlpool trading USDC and WSOL (sauce pools --chain solana USDC WSOL)
//   to: Address         who gets the WSOL bought: a wallet's base58 key
//   amountIn: Uint256   the most USDC to pay, in its smallest units (6 decimals): 100000000 is 100
//   maxPrice: Uint256   the most one unit of WSOL may cost, fee included: USDC base units per WSOL
//                       base unit, times 1e18 (sauce pools prints each pool's, as maxPrice)
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
