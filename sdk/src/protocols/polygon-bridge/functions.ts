export const depositETH = `
import { PolygonRootChainManagerABI as IRootChainManager } from "./abis";

function main(rootChainManagerAddress: Address, recipient: Address): Uint256 {
  const manager = IRootChainManager.at(rootChainManagerAddress);
  manager.depositEtherFor(recipient);
  return 1;
}
`;

export const depositERC20 = `
import { PolygonRootChainManagerABI as IRootChainManager } from "./abis";

function main(rootChainManagerAddress: Address, recipient: Address, rootToken: Address, depositData: bytes): Uint256 {
  const manager = IRootChainManager.at(rootChainManagerAddress);
  manager.depositFor(recipient, rootToken, depositData);
  return 1;
}
`;
