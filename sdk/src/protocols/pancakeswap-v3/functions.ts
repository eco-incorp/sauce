export const swap = `
import { PancakeSwapV3SmartRouterABI as ISmartRouter } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, fee: Uint256, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = ISmartRouter.at(routerAddress);
  return router.exactInputSingle({tokenIn: tokenIn, tokenOut: tokenOut, fee: fee, recipient: recipient, amountIn: amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0});
}
`;
