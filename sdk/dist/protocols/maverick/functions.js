export const swap = `
import { MaverickV2RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, pool: Address, tokenAIn: bool, amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256 {
  const router = IRouter.at(routerAddress);
  return router.exactInputSingle(recipient, pool, tokenAIn, amountIn, amountOutMin);
}
`;
//# sourceMappingURL=functions.js.map