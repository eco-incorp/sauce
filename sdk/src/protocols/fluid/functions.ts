export const deposit = `
import { FluidLendingABI as IFluidLending } from "./abis";

function main(liquidityAddress: Address, token: Address, amount: Uint256, to: Address): Uint256 {
  const lending = IFluidLending.at(liquidityAddress);
  return lending.deposit(token, amount, to);
}
`;

export const withdraw = `
import { FluidLendingABI as IFluidLending } from "./abis";

function main(liquidityAddress: Address, token: Address, amount: Uint256, to: Address): Uint256 {
  const lending = IFluidLending.at(liquidityAddress);
  return lending.withdraw(token, amount, to);
}
`;

export const borrow = `
import { FluidLendingABI as IFluidLending } from "./abis";

function main(liquidityAddress: Address, token: Address, amount: Uint256, to: Address): Uint256 {
  const lending = IFluidLending.at(liquidityAddress);
  return lending.borrow(token, amount, to);
}
`;

export const repay = `
import { FluidLendingABI as IFluidLending } from "./abis";

function main(liquidityAddress: Address, token: Address, amount: Uint256, onBehalfOf: Address): Uint256 {
  const lending = IFluidLending.at(liquidityAddress);
  return lending.repay(token, amount, onBehalfOf);
}
`;
