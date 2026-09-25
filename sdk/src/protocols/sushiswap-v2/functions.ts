export const swap = `
import { SushiSwapV2RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, path: Address[], amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, 99999999999);
}
`;

export const addLiquidity = `
import { SushiSwapV2RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenA: Address, tokenB: Address, amountADesired: Uint256, amountBDesired: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256, liquidity: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, recipient, 99999999999);
}
`;

export const removeLiquidity = `
import { SushiSwapV2RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenA: Address, tokenB: Address, liquidity: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, recipient, 99999999999);
}
`;
