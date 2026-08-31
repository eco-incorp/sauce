export const bridge = `
import { SquidRouterABI as ISquidRouter } from "./abis";

function main(routerAddress: Address, token: Address, amount: Uint256, bridgedTokenSymbol: string, destinationChain: string, destinationAddress: string): Uint256 {
  const router = ISquidRouter.at(routerAddress);
  router.callBridge(token, amount, bridgedTokenSymbol, destinationChain, destinationAddress, 0x00);
  return 1;
}
`;
//# sourceMappingURL=functions.js.map