export const swap = `
import { BalancerV2VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, poolId: Uint256, assetIn: Address, assetOut: Address, amount: Uint256, limit: Uint256, sender: Address, recipient: Address): Uint256 {
  const vault = IVault.at(vaultAddress);
  return vault.swap({poolId: poolId, kind: 0, assetIn: assetIn, assetOut: assetOut, amount: amount, userData: hex\`\`}, {sender: sender, fromInternalBalance: false, recipient: recipient, toInternalBalance: false}, limit, 99999999999);
}
`;

export const addLiquidity = `
import { BalancerV2VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, poolId: Uint256, sender: Address, recipient: Address, userData: bytes): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.joinPool(poolId, sender, recipient, {assets: [], maxAmountsIn: [], userData: userData, fromInternalBalance: false});
  return 1;
}
`;

export const removeLiquidity = `
import { BalancerV2VaultABI as IVault } from "./abis";

function main(vaultAddress: Address, poolId: Uint256, sender: Address, recipient: Address, userData: bytes): Uint256 {
  const vault = IVault.at(vaultAddress);
  vault.exitPool(poolId, sender, recipient, {assets: [], minAmountsOut: [], userData: userData, toInternalBalance: false});
  return 1;
}
`;
