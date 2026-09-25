export const deposit = `
import { SiloABI as ISilo } from "./abis";

function main(siloAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const silo = ISilo.at(siloAddress);
  silo.deposit(asset, amount, false);
  return 1;
}
`;

export const withdraw = `
import { SiloABI as ISilo } from "./abis";

function main(siloAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const silo = ISilo.at(siloAddress);
  return silo.withdraw(asset, amount, false);
}
`;

export const borrow = `
import { SiloABI as ISilo } from "./abis";

function main(siloAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const silo = ISilo.at(siloAddress);
  silo.borrow(asset, amount);
  return 1;
}
`;

export const repay = `
import { SiloABI as ISilo } from "./abis";

function main(siloAddress: Address, asset: Address, amount: Uint256): Uint256 {
  const silo = ISilo.at(siloAddress);
  silo.repay(asset, amount);
  return 1;
}
`;
