export const deposit = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.deposit(amount);
  return 1;
}
`;

export const withdraw = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, shares: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.withdraw(shares);
  return 1;
}
`;

export const getPricePerFullShare = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.getPricePerFullShare();
}
`;
