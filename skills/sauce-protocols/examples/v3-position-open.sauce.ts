// Puts the Pot's tokens into a full-range Uniswap V3 position that the Pot owns. With `tokenId` 0 it
// mints a new position on `pool`, from the lowest tick to the highest the pool's tick spacing
// allows; with a position's id it adds to that position, which must be on `pool`. The pool's
// tokens, fee and tick spacing are read from the pool. The position manager takes the two tokens in
// the pool's price ratio, so one amount is used in full and the other in part: what it does not
// take stays in the Pot, and the allowances are withdrawn. The NFT stays in the Pot;
// v3-position-manage.sauce.ts takes fees and liquidity out and hands it over. A position's own
// reads come from UniswapV3Positions.json beside this file. Returns the position, the liquidity
// added and what it took of the pool's token0 and token1 (token0 is the lower address).
//
//   sauce run v3-position-open.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <tokenId> <pool> <amount0> <amount1> <min0> <min1>
//
//   tokenId: Uint256  0 to mint a new position, or the id of the Pot's position to add to
//   pool: Address     the Uniswap V3 pool (`sauce pools` lists a pair's pools)
//   amount0: Uint256  the most of the pool's token0 to put in, in its smallest units:
//                     1000000000000000000000 is 1,000 DAI (18 decimals)
//   amount1: Uint256  the most of its token1, in its smallest units: 1000000000 is 1,000 USDC
//                     (6 decimals)
//   min0: Uint256     the least of token0 the position must take, in its smallest units: the
//                     guard against a pool price moved before the cook
//   min1: Uint256     the least of token1, the same way
//
// On Ethereum, a new full-range position on the DAI/USDC 0.3% pool from up to 1,000 of each (DAI
// is token0), at least 900 of each taken:
//
//   sauce run v3-position-open.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 0 <pool> 1000000000000000000000 1000000000 900000000000000000000 900000000
import UniswapV3Positions from "./UniswapV3Positions.json";

function main(
  tokenId: Uint256,
  pool: Address,
  amount0: Uint256,
  amount1: Uint256,
  min0: Uint256,
  min1: Uint256,
): { tokenId: Uint256; liquidity: Uint256; spent0: Uint256; spent1: Uint256 } {
  const token0 = UniswapV3.Pool.at(pool).token0();
  const token1 = UniswapV3.Pool.at(pool).token1();
  const fee = UniswapV3.Pool.at(pool).fee();
  require(Token(token0).balanceOf(pot) >= amount0, "amount0 is not in the Pot");
  require(Token(token1).balanceOf(pot) >= amount1, "amount1 is not in the Pot");

  const manager = UniswapV3.NonfungiblePositionManager;
  Token(token0).approve(manager, amount0);
  Token(token1).approve(manager, amount1);
  let id = tokenId;
  let liquidity: Uint256 = 0;
  let spent0: Uint256 = 0;
  let spent1: Uint256 = 0;
  if (tokenId == 0) {
    // The widest range the pool takes: its outermost ticks that are multiples of its spacing.
    const spacing = UniswapV3.Pool.at(pool).tickSpacing();
    const top: Int256 = (887272 / spacing) * spacing;
    const minted = manager.mint({
      token0,
      token1,
      fee,
      tickLower: -top,
      tickUpper: top,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: min0,
      amount1Min: min1,
      recipient: pot,
      deadline: ctx.timestamp(),
    });
    id = minted.tokenId;
    liquidity = minted.liquidity;
    spent0 = minted.amount0;
    spent1 = minted.amount1;
  } else {
    const position = UniswapV3Positions.at(manager).positions(tokenId);
    require(position.token0 == token0 &&
      position.token1 == token1 &&
      position.fee == fee, "the position is on another pool");
    const added = manager.increaseLiquidity({
      tokenId,
      amount0Desired: amount0,
      amount1Desired: amount1,
      amount0Min: min0,
      amount1Min: min1,
      deadline: ctx.timestamp(),
    });
    liquidity = added.liquidity;
    spent0 = added.amount0;
    spent1 = added.amount1;
  }
  Token(token0).approve(manager, 0);
  Token(token1).approve(manager, 0);

  return { tokenId: id, liquidity, spent0, spent1 };
}
