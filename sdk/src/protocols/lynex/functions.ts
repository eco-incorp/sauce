export const swap = `
import { LynexRouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, stable: bool, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, [{from: tokenIn, to: tokenOut, stable: stable}], recipient, 99999999999);
}
`;
