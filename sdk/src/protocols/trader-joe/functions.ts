export const swap = `
import { LBRouterABI as ILBRouter } from "./abis";

function main(routerAddress: Address, path: { pairBinSteps: Uint256[], versions: Uint256[], tokenPath: Address[] }, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = ILBRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, 99999999999);
}
`;
