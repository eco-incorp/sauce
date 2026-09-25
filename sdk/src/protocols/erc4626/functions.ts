export const deposit = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.deposit(assets, receiver);
}
`;

export const mint = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, shares: Uint256, receiver: Address): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.mint(shares, receiver);
}
`;

export const withdraw = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, assets: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.withdraw(assets, receiver, owner);
}
`;

export const redeem = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.redeem(shares, receiver, owner);
}
`;

export const previewDeposit = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, assets: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.previewDeposit(assets);
}
`;

export const previewWithdraw = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, assets: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.previewWithdraw(assets);
}
`;

export const convertToShares = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, assets: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.convertToShares(assets);
}
`;

export const convertToAssets = `
import { VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, shares: Uint256): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.convertToAssets(shares);
}
`;
