export const bridge = `
import { SocketGatewayABI as ISocketGateway } from "./abis";

function main(gatewayAddress: Address, routeId: Uint256, bridgeData: bytes): Uint256 {
  const gateway = ISocketGateway.at(gatewayAddress);
  gateway.bridge(routeId, bridgeData);
  return 1;
}
`;
