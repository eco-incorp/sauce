export const deposit = `
import { BeefyVaultABI as IBeefyVault } from "./abis";

function main(vaultAddress: Address, amount: Uint256): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.deposit(amount);
  return 1;
}
`;

export const depositAll = `
import { BeefyVaultABI as IBeefyVault } from "./abis";

function main(vaultAddress: Address): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.depositAll();
  return 1;
}
`;

export const withdraw = `
import { BeefyVaultABI as IBeefyVault } from "./abis";

function main(vaultAddress: Address, shares: Uint256): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.withdraw(shares);
  return 1;
}
`;

export const withdrawAll = `
import { BeefyVaultABI as IBeefyVault } from "./abis";

function main(vaultAddress: Address): Uint256 {
  const vault = IBeefyVault.at(vaultAddress);
  vault.withdrawAll();
  return 1;
}
`;
