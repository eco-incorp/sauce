export const supply = `
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.mint(amount);
}
`;

export const withdraw = `
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.redeemUnderlying(amount);
}
`;

export const borrow = `
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.borrow(amount);
}
`;

export const repay = `
import { VTokenABI as IVToken } from "./abis";

function main(vTokenAddress: Address, amount: Uint256): Uint256 {
  const vToken = IVToken.at(vTokenAddress);
  return vToken.repayBorrow(amount);
}
`;
