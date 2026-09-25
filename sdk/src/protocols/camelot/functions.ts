export const swapV2 = `
import { CamelotV2RouterABI as ICamelotRouter } from "./abis";

function main(routerAddress: Address, path: Address[], amountIn: Uint256, amountOutMin: Uint256, recipient: Address, referrer: Address): Uint256 {
  const router = ICamelotRouter.at(routerAddress);
  router.swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn, amountOutMin, path, recipient, referrer, 99999999999);
  return 1;
}
`;

export const swapV3 = `
import { CamelotV3SwapRouterABI as ICamelotV3Router } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = ICamelotV3Router.at(routerAddress);
  return router.exactInputSingle({tokenIn: tokenIn, tokenOut: tokenOut, recipient: recipient, deadline: 99999999999, amountIn: amountIn, amountOutMinimum: amountOutMin, limitSqrtPrice: 0});
}
`;

export const addLiquidity = `
import { CamelotV2RouterABI as ICamelotRouter } from "./abis";

function main(routerAddress: Address, tokenA: Address, tokenB: Address, amountADesired: Uint256, amountBDesired: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256, liquidity: Uint256 } {
  const router = ICamelotRouter.at(routerAddress);
  return router.addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, recipient, 99999999999);
}
`;

export const removeLiquidity = `
import { CamelotV2RouterABI as ICamelotRouter } from "./abis";

function main(routerAddress: Address, tokenA: Address, tokenB: Address, liquidity: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256 } {
  const router = ICamelotRouter.at(routerAddress);
  return router.removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, recipient, 99999999999);
}
`;
