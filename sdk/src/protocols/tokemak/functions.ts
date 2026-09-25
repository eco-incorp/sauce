export const deposit = `
import { AutopoolABI as IAutopool } from "./abis";

function main(autopoolAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const autopool = IAutopool.at(autopoolAddress);
  return autopool.deposit(assets, receiver);
}
`;

export const withdraw = `
import { AutopoolABI as IAutopool } from "./abis";

function main(autopoolAddress: Address, assets: Uint256, receiver: Address, owner: Address): Uint256 {
  const autopool = IAutopool.at(autopoolAddress);
  return autopool.withdraw(assets, receiver, owner);
}
`;

export const redeem = `
import { AutopoolABI as IAutopool } from "./abis";

function main(autopoolAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const autopool = IAutopool.at(autopoolAddress);
  return autopool.redeem(shares, receiver, owner);
}
`;
