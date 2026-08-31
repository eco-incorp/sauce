export const depositETH = `
import { ScrollL1GatewayRouterABI as IL1GatewayRouter } from "./abis";

function main(gatewayRouterAddress: Address, amount: Uint256, gasLimit: Uint256): Uint256 {
  const router = IL1GatewayRouter.at(gatewayRouterAddress);
  router.depositETH(amount, gasLimit);
  return 1;
}
`;
export const depositERC20 = `
import { ScrollL1GatewayRouterABI as IL1GatewayRouter } from "./abis";

function main(gatewayRouterAddress: Address, token: Address, amount: Uint256, gasLimit: Uint256): Uint256 {
  const router = IL1GatewayRouter.at(gatewayRouterAddress);
  router.depositERC20(token, amount, gasLimit);
  return 1;
}
`;
//# sourceMappingURL=functions.js.map