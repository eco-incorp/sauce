// Uniswap's liquidity examples, ported: the `LiquidityExamples` contract of Uniswap's V3 guides
// keeps a DAI/USDC position's NFT for its owner and mints it, collects its fees, takes half its
// liquidity out, adds to it and hands the NFT back. Here the Pot is that contract: the position is
// minted to the Pot, and only its owner cooks it. `step` picks the function, and each returns the
// position's `tokenId`, the liquidity it added or removed, and the DAI and USDC that moved.
//
// Ported from Uniswap/docs, content/examples/smart-contracts/LiquidityExamples.sol (243 lines, 157 of code):
// https://github.com/Uniswap/docs/blob/338d70983ac49911aecac02dd57b0a969c1ca61e/content/examples/smart-contracts/LiquidityExamples.sol
//
// What changes in Sauce: the contract recorded each deposit's owner, because anyone could call it;
// a Pot is cooked by its owner alone, so there is no record and no owner check, and `owner` is
// where the tokens and the NFT go. It pulled the tokens from its caller and refunded what the
// position did not take; the Pot's tokens stay in the Pot. Its full range was TickMath's, which no
// 0.3% pool accepts (a tick must be a multiple of the tier's spacing, 60): here it is that range
// rounded in. Its `decreaseLiquidityInHalf` sent the owner tokens the position had only credited,
// not paid: here it collects them first. Position reads and the NFT's transfer are in
// UniswapV3Positions.json beside this file, which the registry's ABI for the position manager
// leaves out. DAI is not one of the `sauce` command's token symbols on Ethereum: `--fund` and
// `--assume-balance` take it by its address, which `sauce globals --chain ethereum --protocol
// Maker` prints as `Dai`.
//
//   sauce run uniswap-v3-liquidity-examples.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <step> <tokenId> <amount0> <amount1> <owner>
//
//   step: Uint256      0 mint a position, 1 collect all its fees, 2 take half its liquidity out,
//                      3 add to it, 4 hand its NFT to `owner`
//   tokenId: Uint256   the position (0 to mint one)
//   amount0: Uint256   the DAI to mint or add with, in its smallest units (18 decimals):
//                      1000000000000000000000 is 1,000 DAI
//   amount1: Uint256   the USDC to mint or add with, in its smallest units (6 decimals):
//                      1000000000 is 1,000 USDC
//   owner: Address     who receives the fees, the liquidity taken out and the NFT
//
// On Ethereum, a full-range position minted with up to 1,000 DAI and 1,000 USDC:
//
//   sauce run uniswap-v3-liquidity-examples.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 0 0 1000000000000000000000 1000000000 <owner>
import UniswapV3Positions from "./UniswapV3Positions.json";

const POOL_FEE = 3000;
// TickMath's MIN_TICK and MAX_TICK, rounded in to the 0.3% tier's tick spacing of 60.
const MIN_TICK = -887220;
const MAX_TICK = 887220;
const MAX_UINT128 = 2 ** 128 - 1;

interface Moved {
  tokenId: Uint256;
  liquidity: Uint256;
  amount0: Uint256;
  amount1: Uint256;
}

function mintNewPosition(amount0ToMint: Uint256, amount1ToMint: Uint256): Moved {
  require(UniswapV3.NonfungiblePositionManager && Maker.Dai);
  approve(Maker.Dai, UniswapV3.NonfungiblePositionManager, amount0ToMint);
  USDC.approve(UniswapV3.NonfungiblePositionManager, amount1ToMint);
  const [tokenId, liquidity, amount0, amount1] = UniswapV3.NonfungiblePositionManager.mint({
    token0: Maker.Dai,
    token1: USDC,
    fee: POOL_FEE,
    tickLower: MIN_TICK,
    tickUpper: MAX_TICK,
    amount0Desired: amount0ToMint,
    amount1Desired: amount1ToMint,
    amount0Min: 0,
    amount1Min: 0,
    recipient: ctx.self(),
    deadline: ctx.timestamp(),
  });
  // What the position did not take stays in the Pot; the allowance for it does not stand.
  if (amount0 < amount0ToMint) {
    approve(Maker.Dai, UniswapV3.NonfungiblePositionManager, 0);
  }
  if (amount1 < amount1ToMint) {
    USDC.approve(UniswapV3.NonfungiblePositionManager, 0);
  }
  return { tokenId, liquidity, amount0, amount1 };
}

function collectAllFees(tokenId: Uint256, owner: Address): Moved {
  require(UniswapV3.NonfungiblePositionManager);
  const [amount0, amount1] = UniswapV3.NonfungiblePositionManager.collect({
    tokenId,
    recipient: owner,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  });
  return { tokenId, liquidity: 0, amount0, amount1 };
}

function decreaseLiquidityInHalf(tokenId: Uint256, owner: Address): Moved {
  require(UniswapV3.NonfungiblePositionManager);
  const position = UniswapV3Positions.at(UniswapV3.NonfungiblePositionManager).positions(tokenId);
  const halfLiquidity = position.liquidity / 2;
  const [amount0, amount1] = UniswapV3.NonfungiblePositionManager.decreaseLiquidity({
    tokenId,
    liquidity: halfLiquidity,
    amount0Min: 0,
    amount1Min: 0,
    deadline: ctx.timestamp(),
  });
  // Taking liquidity out credits the position; collecting pays the credit to `owner`.
  UniswapV3.NonfungiblePositionManager.collect({
    tokenId,
    recipient: owner,
    amount0Max: amount0,
    amount1Max: amount1,
  });
  return { tokenId, liquidity: halfLiquidity, amount0, amount1 };
}

function increaseLiquidityCurrentRange(
  tokenId: Uint256,
  amountAdd0: Uint256,
  amountAdd1: Uint256,
): Moved {
  require(UniswapV3.NonfungiblePositionManager);
  const position = UniswapV3Positions.at(UniswapV3.NonfungiblePositionManager).positions(tokenId);
  approve(position.token0, UniswapV3.NonfungiblePositionManager, amountAdd0);
  approve(position.token1, UniswapV3.NonfungiblePositionManager, amountAdd1);
  const [liquidity, amount0, amount1] = UniswapV3.NonfungiblePositionManager.increaseLiquidity({
    tokenId,
    amount0Desired: amountAdd0,
    amount1Desired: amountAdd1,
    amount0Min: 0,
    amount1Min: 0,
    deadline: ctx.timestamp(),
  });
  if (amount0 < amountAdd0) {
    approve(position.token0, UniswapV3.NonfungiblePositionManager, 0);
  }
  if (amount1 < amountAdd1) {
    approve(position.token1, UniswapV3.NonfungiblePositionManager, 0);
  }
  return { tokenId, liquidity, amount0, amount1 };
}

function retrieveNFT(tokenId: Uint256, owner: Address): Moved {
  require(UniswapV3.NonfungiblePositionManager);
  UniswapV3Positions.at(UniswapV3.NonfungiblePositionManager).safeTransferFrom(
    ctx.self(),
    owner,
    tokenId,
  );
  return { tokenId, liquidity: 0, amount0: 0, amount1: 0 };
}

function main(
  step: Uint256,
  tokenId: Uint256,
  amount0: Uint256,
  amount1: Uint256,
  owner: Address,
): Moved {
  if (step == 0) {
    return mintNewPosition(amount0, amount1);
  }
  if (step == 1) {
    return collectAllFees(tokenId, owner);
  }
  if (step == 2) {
    return decreaseLiquidityInHalf(tokenId, owner);
  }
  if (step == 3) {
    return increaseLiquidityCurrentRange(tokenId, amount0, amount1);
  }
  require(step == 4, "step is 0 to 4");
  return retrieveNFT(tokenId, owner);
}
