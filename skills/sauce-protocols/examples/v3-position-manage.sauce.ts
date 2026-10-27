// Takes from a Uniswap V3 position the Pot owns: removes `share` of its liquidity (none with 0),
// pays everything the position is owed, the fees it earned and what the removal freed, to
// `recipient`, and then, unless `newOwner` is the zero address, transfers the position's NFT to
// `newOwner`. The position's reads and the NFT transfer come from UniswapV3Positions.json beside
// this file; v3-position-open.sauce.ts opens the position. Returns the liquidity removed and what
// `recipient` was paid of the pool's token0 and token1 (token0 is the lower address).
//
//   sauce run v3-position-manage.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <tokenId> <share> <min0> <min1> <recipient> <newOwner>
//
//   tokenId: Uint256   the Pot's position
//   share: Uint256     how much of its liquidity to remove, in hundredths of a percent: 5000 is
//                      half, 10000 all, 0 only collects the fees
//   min0: Uint256      the least of token0 the removal must free, in its smallest units: the guard
//                      against a pool price moved before the cook
//   min1: Uint256      the least of token1, the same way
//   recipient: Address who is paid the fees and the freed tokens
//   newOwner: Address  who receives the NFT afterwards, or the zero address for the Pot to keep it
//
// On Ethereum, half of position 1000000 removed, at least 400 DAI and 400 USDC freed, everything
// paid to the recipient, and the Pot keeping the position:
//
//   sauce run v3-position-manage.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 1000000 5000 400000000000000000000 400000000 <recipient> \
//     0x0000000000000000000000000000000000000000
import UniswapV3Positions from "./UniswapV3Positions.json";

function main(
  tokenId: Uint256,
  share: Uint256,
  min0: Uint256,
  min1: Uint256,
  recipient: Address,
  newOwner: Address,
): { removed: Uint256; paid0: Uint256; paid1: Uint256 } {
  require(share <= 10000, "share is at most 10000, all of it");
  require(recipient != 0, "recipient is the zero address");
  const manager = UniswapV3.NonfungiblePositionManager;
  const position = UniswapV3Positions.at(manager).positions(tokenId);

  // Removing liquidity credits the tokens it frees to the position; `collect` pays them out.
  const removed = (position.liquidity * share) / 10000;
  if (removed > 0) {
    manager.decreaseLiquidity({
      tokenId,
      liquidity: removed,
      amount0Min: min0,
      amount1Min: min1,
      deadline: ctx.timestamp(),
    });
  }
  // The most a position can be owed of each token: collect all of it.
  const all = 2 ** 128 - 1;
  const paid = manager.collect({ tokenId, recipient, amount0Max: all, amount1Max: all });

  if (newOwner != 0) {
    UniswapV3Positions.at(manager).safeTransferFrom(pot, newOwner, tokenId);
  }
  return { removed, paid0: paid.amount0, paid1: paid.amount1 };
}
