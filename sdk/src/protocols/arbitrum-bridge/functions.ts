export const depositToL2 = `
import { ArbitrumL1GatewayRouterABI as IL1GatewayRouter } from "./abis";

function main(routerAddress: Address, token: Address, recipient: Address, amount: Uint256, maxGas: Uint256, gasPriceBid: Uint256): bytes {
  const router = IL1GatewayRouter.at(routerAddress);
  return router.outboundTransfer(token, recipient, amount, maxGas, gasPriceBid, 0x00);
}
`;
