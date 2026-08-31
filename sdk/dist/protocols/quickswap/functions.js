export const swapV2 = `
import { QuickSwapV2RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, path: Address[], amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, 99999999999);
}
`;
export const swapV3 = `
import { QuickSwapV3SwapRouterABI as ISwapRouter } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = ISwapRouter.at(routerAddress);
  return router.exactInputSingle({tokenIn: tokenIn, tokenOut: tokenOut, recipient: recipient, deadline: 99999999999, amountIn: amountIn, amountOutMinimum: amountOutMin, limitSqrtPrice: 0});
}
`;
export const addLiquidity = `
import { QuickSwapV2RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenA: Address, tokenB: Address, amountADesired: Uint256, amountBDesired: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256, liquidity: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, recipient, 99999999999);
}
`;
export const removeLiquidity = `
import { QuickSwapV2RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenA: Address, tokenB: Address, liquidity: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, recipient, 99999999999);
}
`;
//# sourceMappingURL=functions.js.map