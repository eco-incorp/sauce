export const deposit = `
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";

function main(vaultAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.deposit(assets, receiver);
}
`;

export const withdraw = `
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";

function main(vaultAddress: Address, assets: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.withdraw(assets, receiver, owner);
}
`;

export const redeem = `
import { YearnV3VaultABI as IYearnV3Vault } from "./abis";

function main(vaultAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IYearnV3Vault.at(vaultAddress);
  return vault.redeem(shares, receiver, owner);
}
`;
