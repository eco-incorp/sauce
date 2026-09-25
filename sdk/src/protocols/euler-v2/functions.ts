export const deposit = `
import { EVaultABI as IEVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const vault = IEVault.at(vaultAddress);
  return vault.deposit(amount, receiver);
}
`;

export const withdraw = `
import { EVaultABI as IEVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IEVault.at(vaultAddress);
  return vault.withdraw(amount, receiver, owner);
}
`;

export const borrow = `
import { EVaultABI as IEVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const vault = IEVault.at(vaultAddress);
  return vault.borrow(amount, receiver);
}
`;

export const repay = `
import { EVaultABI as IEVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const vault = IEVault.at(vaultAddress);
  return vault.repay(amount, receiver);
}
`;
