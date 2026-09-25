export const supply = `
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.mint(amount);
}
`;

export const withdraw = `
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.redeemUnderlying(amount);
}
`;

export const borrow = `
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.borrow(amount);
}
`;

export const repay = `
import { MTokenABI as IMToken } from "./abis";

function main(mTokenAddress: Address, amount: Uint256): Uint256 {
  const mToken = IMToken.at(mTokenAddress);
  return mToken.repayBorrow(amount);
}
`;
