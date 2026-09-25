export const depositCollateral = `
import { EndpointABI as IEndpoint } from "./abis";

function main(endpointAddress: Address, productId: Uint256, amount: Uint256): Uint256 {
  const endpoint = IEndpoint.at(endpointAddress);
  endpoint.depositCollateral(0x000000000000000000000000, productId, amount);
  return 1;
}
`;
