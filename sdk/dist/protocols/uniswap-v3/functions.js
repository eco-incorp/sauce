export const swap = `
import { UniswapV3SwapRouterABI as ISwapRouter } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, fee: Uint256, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = ISwapRouter.at(routerAddress);
  return router.exactInputSingle({tokenIn: tokenIn, tokenOut: tokenOut, fee: fee, recipient: recipient, deadline: 99999999999, amountIn: amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0});
}
`;
export const addLiquidity = `
import { UniswapV3NonfungiblePositionManagerABI as INonfungiblePositionManager } from "./abis";

function main(nfpmAddress: Address, token0: Address, token1: Address, fee: Uint256, tickLower: Uint256, tickUpper: Uint256, amount0Desired: Uint256, amount1Desired: Uint256, amount0Min: Uint256, amount1Min: Uint256, recipient: Address): { tokenId: Uint256, liquidity: Uint256, amount0: Uint256, amount1: Uint256 } {
  const nfpm = INonfungiblePositionManager.at(nfpmAddress);
  return nfpm.mint({token0: token0, token1: token1, fee: fee, tickLower: tickLower, tickUpper: tickUpper, amount0Desired: amount0Desired, amount1Desired: amount1Desired, amount0Min: amount0Min, amount1Min: amount1Min, recipient: recipient, deadline: 99999999999});
}
`;
export const removeLiquidity = `
import { UniswapV3NonfungiblePositionManagerABI as INonfungiblePositionManager } from "./abis";

function main(nfpmAddress: Address, tokenId: Uint256, liquidity: Uint256, amount0Min: Uint256, amount1Min: Uint256): { amount0: Uint256, amount1: Uint256 } {
  const nfpm = INonfungiblePositionManager.at(nfpmAddress);
  return nfpm.decreaseLiquidity({tokenId: tokenId, liquidity: liquidity, amount0Min: amount0Min, amount1Min: amount1Min, deadline: 99999999999});
}
`;
//# sourceMappingURL=functions.js.map