export const swap = `
import { SynthraV3SwapRouter02ABI as ISwapRouter02 } from "./abis";

function main(routerAddress: Address, tokenIn: Address, tokenOut: Address, fee: Uint256, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = ISwapRouter02.at(routerAddress);
  return router.exactInputSingle({tokenIn: tokenIn, tokenOut: tokenOut, fee: fee, recipient: recipient, amountIn: amountIn, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0});
}
`;
