export const swap = `
import { UnitFlowV3RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, fee: Uint256, amountIn: Uint256, amountOutMin: Uint256, recipient: Address, deadline: Uint256): Uint256 {
  const router = IRouter.at(routerAddress);
  return router.exactInputSingle({tokenIn: tokenIn, tokenOut: tokenOut, fee: fee, recipient: recipient, deadline: deadline, amountIn: amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0});
}
`;
