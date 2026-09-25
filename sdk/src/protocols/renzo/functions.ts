export const depositETH = `
import { RestakeManagerABI as IRestakeManager } from "./abis";

function main(restakeManagerAddress: Address): Uint256 {
  const manager = IRestakeManager.at(restakeManagerAddress);
  manager.depositETH();
  return 1;
}
`;

export const deposit = `
import { RestakeManagerABI as IRestakeManager } from "./abis";

function main(restakeManagerAddress: Address, collateralToken: Address, amount: Uint256): Uint256 {
  const manager = IRestakeManager.at(restakeManagerAddress);
  manager.deposit(collateralToken, amount);
  return 1;
}
`;
