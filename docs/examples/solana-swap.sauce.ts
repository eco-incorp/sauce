// Solana: buy WSOL with up to `amountIn` of the Pot's USDC at Orca's SOL/USDC whirlpool of tick
// spacing 4, never paying more than `priceLimit` for any unit, and send what arrived to `to`. The
// pool is found by its key, as an EVM program finds a Uniswap pool by its fee, and compiling adds
// every account the swap takes to main — the pool's nine, read from the pool when the cook is
// built, and the Pot's own — so the command is given none. A pool already past `priceLimit` is
// skipped (`swap` returns 0, and nothing moves); below `minOut` the whole transaction reverts.
//
//   sauce run solana-swap.sauce.ts --chain <chain> --keypair <keypair> \
//     --args <to> <amountIn> <priceLimit> <minOut>
//
//   to: Address           who gets the WSOL bought: a wallet's key
//   amountIn: Uint256     the most USDC to pay, in its smallest units (6 decimals): 100000000 is 100
//   priceLimit: Uint256   the most one WSOL may cost, fee included: USDC base units per WSOL base
//                         unit, times 10^18 (sauce pools prints each pool's own as priceLimit)
//   minOut: Uint256       the least WSOL to receive, in its smallest units (9 decimals)
//
// On Solana, 100 USDC at up to 200 USDC per SOL, for at least 0.4 SOL:
//
//   sauce run solana-swap.sauce.ts --chain solana --keypair <keypair> \
//     --args <recipient> 100000000 200000000000000000 400000000
function main(to: Address, amountIn: Uint256, priceLimit: Uint256, minOut: Uint256): Uint256 {
  const got = Orca.Whirlpool.swap(
    Orca.Whirlpool.pool(USDC, WSOL, 4),
    USDC,
    WSOL,
    amountIn,
    priceLimit,
    minOut,
  );
  if (got > 0) WSOL.transfer(to, got);
  return got;
}
