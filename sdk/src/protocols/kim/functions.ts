export const swap = `
import { KimRouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = IRouter.at(routerAddress);
  router.swapExactTokensForTokensSupportingFeeOnTransferTokens(amountIn, amountOutMin, [tokenIn, tokenOut], recipient, 0x0000000000000000000000000000000000000000, 99999999999);
  return 1;
}
`;
