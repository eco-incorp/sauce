export const sendToken = `
import { AxelarGatewayABI as IGateway } from "./abis";

function main(gatewayAddress: Address, destinationChain: string, destinationAddress: string, symbol: string, amount: Uint256): Uint256 {
  const gateway = IGateway.at(gatewayAddress);
  gateway.sendToken(destinationChain, destinationAddress, symbol, amount);
  return 1;
}
`;
