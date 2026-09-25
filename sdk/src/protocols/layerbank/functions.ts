export const supply = `
import { LTokenABI as ILToken } from "./abis";

function main(lTokenAddress: Address, amount: Uint256): Uint256 {
  const lToken = ILToken.at(lTokenAddress);
  return lToken.mint(amount);
}
`;

export const withdraw = `
import { LTokenABI as ILToken } from "./abis";

function main(lTokenAddress: Address, amount: Uint256): Uint256 {
  const lToken = ILToken.at(lTokenAddress);
  return lToken.redeemUnderlying(amount);
}
`;

export const borrow = `
import { LTokenABI as ILToken } from "./abis";

function main(lTokenAddress: Address, amount: Uint256): Uint256 {
  const lToken = ILToken.at(lTokenAddress);
  return lToken.borrow(amount);
}
`;

export const repay = `
import { LTokenABI as ILToken } from "./abis";

function main(lTokenAddress: Address, amount: Uint256): Uint256 {
  const lToken = ILToken.at(lTokenAddress);
  return lToken.repayBorrow(amount);
}
`;
