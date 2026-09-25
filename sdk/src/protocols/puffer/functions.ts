export const deposit = `
import { PufferVaultABI as IPufferVault } from "./abis";

function main(pufferVaultAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const vault = IPufferVault.at(pufferVaultAddress);
  return vault.deposit(assets, receiver);
}
`;

export const redeem = `
import { PufferVaultABI as IPufferVault } from "./abis";

function main(pufferVaultAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const vault = IPufferVault.at(pufferVaultAddress);
  return vault.redeem(shares, receiver, owner);
}
`;
