export const swap = `
import { SyncSwapRouterABI as IRouter } from "./abis";

function main(routerAddress: Address, pool: Address, tokenIn: Address, amountIn: Uint256, amountOutMin: Uint256, swapData: bytes): { token: Address, amount: Uint256 } {
  const router = IRouter.at(routerAddress);
  const zeroAddr = 0x0000000000000000000000000000000000000000;
  return router.swap([{steps: [{pool: pool, data: swapData, callback: zeroAddr, callbackData: 0x00}], tokenIn: tokenIn, amountIn: amountIn}], amountOutMin, 99999999999);
}
`;
//# sourceMappingURL=functions.js.map