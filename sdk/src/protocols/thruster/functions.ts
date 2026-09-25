export const swap = `
import { ThrusterV3SwapRouterABI as ISwapRouter } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, fee: Uint256, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = ISwapRouter.at(routerAddress);
  return router.exactInputSingle({tokenIn: tokenIn, tokenOut: tokenOut, fee: fee, recipient: recipient, deadline: 99999999999, amountIn: amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0});
}
`;
