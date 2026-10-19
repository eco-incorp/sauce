export const deposit = `
import { FluidLendingABI as IFToken } from "./abis";

function main(fTokenAddress: Address, amount: Uint256, to: Address): Uint256 {
  const fToken = IFToken.at(fTokenAddress);
  return fToken.deposit(amount, to);
}
`;

export const withdraw = `
import { FluidLendingABI as IFToken } from "./abis";

function main(fTokenAddress: Address, amount: Uint256, to: Address, owner: Address): Uint256 {
  const fToken = IFToken.at(fTokenAddress);
  return fToken.withdraw(amount, to, owner);
}
`;

export const borrow = `
import { FluidVaultABI as IFluidVault } from "./abis";

function main(vaultAddress: Address, nftId: Uint256, amount: Uint256, to: Address): Uint256 {
  const vault = IFluidVault.at(vaultAddress);
  vault.operate(nftId, 0, amount, to);
  return 1;
}
`;

export const repay = `
import { FluidVaultABI as IFluidVault } from "./abis";

function main(vaultAddress: Address, nftId: Uint256, negativeDebtDelta: Int256, to: Address): Uint256 {
  const vault = IFluidVault.at(vaultAddress);
  vault.operate(nftId, 0, negativeDebtDelta, to);
  return 1;
}
`;
