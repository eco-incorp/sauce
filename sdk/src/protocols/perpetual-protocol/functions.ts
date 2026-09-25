export const deposit = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, token: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.deposit(token, amount);
  return 1;
}
`;

export const withdraw = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, token: Address, amount: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.withdraw(token, amount);
  return 1;
}
`;
