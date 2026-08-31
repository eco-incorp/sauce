export const swap = `
import { AerodromeRouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, stable: bool, factory: Address, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, [{from: tokenIn, to: tokenOut, stable: stable, factory: factory}], recipient, 99999999999);
}
`;
export const addLiquidity = `
import { AerodromeRouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenA: Address, tokenB: Address, stable: bool, amountADesired: Uint256, amountBDesired: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256, liquidity: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.addLiquidity(tokenA, tokenB, stable, amountADesired, amountBDesired, amountAMin, amountBMin, recipient, 99999999999);
}
`;
export const removeLiquidity = `
import { AerodromeRouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenA: Address, tokenB: Address, stable: bool, liquidity: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.removeLiquidity(tokenA, tokenB, stable, liquidity, amountAMin, amountBMin, recipient, 99999999999);
}
`;
//# sourceMappingURL=functions.js.map