export const deposit = `
import { CoreProxyABI as ICoreProxy } from "./abis";

function main(coreProxyAddress: Address, accountId: Uint256, collateralType: Address, amount: Uint256): Uint256 {
  const core = ICoreProxy.at(coreProxyAddress);
  core.deposit(accountId, collateralType, amount);
  return 1;
}
`;

export const withdraw = `
import { CoreProxyABI as ICoreProxy } from "./abis";

function main(coreProxyAddress: Address, accountId: Uint256, collateralType: Address, amount: Uint256): Uint256 {
  const core = ICoreProxy.at(coreProxyAddress);
  core.withdraw(accountId, collateralType, amount);
  return 1;
}
`;
