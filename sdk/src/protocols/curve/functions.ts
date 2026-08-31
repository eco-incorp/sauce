export const swap = `
import { CurveStableSwapABI as IStableSwap } from "./abis";

function main(poolAddress: Address, i: Uint256, j: Uint256, amountIn: Uint256, minAmountOut: Uint256): Uint256 {
  const pool = IStableSwap.at(poolAddress);
  return pool.exchange(i, j, amountIn, minAmountOut);
}
`;

export const addLiquidity = `
import { CurveStableSwapABI as IStableSwap } from "./abis";

function main(poolAddress: Address, amounts: Uint256[], minMintAmount: Uint256): Uint256 {
  const pool = IStableSwap.at(poolAddress);
  return pool.add_liquidity(amounts, minMintAmount);
}
`;

export const removeLiquidity = `
import { CurveStableSwapABI as IStableSwap } from "./abis";

function main(poolAddress: Address, amount: Uint256, minAmounts: Uint256[]): Uint256[] {
  const pool = IStableSwap.at(poolAddress);
  return pool.remove_liquidity(amount, minAmounts);
}
`;
