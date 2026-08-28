export const setResolver = `
import { ENSRegistryABI as IENSRegistry } from "./abis";

function main(registryAddress: Address, node: Uint256, resolver: Address): Uint256 {
  const registry = IENSRegistry.at(registryAddress);
  registry.setResolver(node, resolver);
  return 1;
}
`;

export const setOwner = `
import { ENSRegistryABI as IENSRegistry } from "./abis";

function main(registryAddress: Address, node: Uint256, owner: Address): Uint256 {
  const registry = IENSRegistry.at(registryAddress);
  registry.setOwner(node, owner);
  return 1;
}
`;
