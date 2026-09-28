export const bridge = `
import { SquidRouterABI as ISquidRouter } from "./abis";

function main(routerAddress: Address, amount: Uint256, bridgedTokenSymbol: string, destinationChain: string, destinationAddress: string, gasRefundRecipient: Address): Uint256 {
  const router = ISquidRouter.at(routerAddress);
  router.bridgeCall(bridgedTokenSymbol, amount, destinationChain, destinationAddress, "", gasRefundRecipient, false);
  return 1;
}
`;
