export const swap = `
import { KyberSwapElasticRouterABI as IElasticRouter } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, fee: Uint256, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = IElasticRouter.at(routerAddress);
  return router.swapExactInputSingle({tokenIn: tokenIn, tokenOut: tokenOut, fee: fee, recipient: recipient, deadline: 99999999999, amountIn: amountIn, minAmountOut: amountOutMin, limitSqrtP: 0});
}
`;
