export const supply = `
import { CErc20ABI as ICErc20 } from "./abis";

function main(cTokenAddress: Address, amount: Uint256): Uint256 {
  const cToken = ICErc20.at(cTokenAddress);
  return cToken.mint(amount);
}
`;

export const withdraw = `
import { CErc20ABI as ICErc20 } from "./abis";

function main(cTokenAddress: Address, amount: Uint256): Uint256 {
  const cToken = ICErc20.at(cTokenAddress);
  return cToken.redeemUnderlying(amount);
}
`;

export const borrow = `
import { CErc20ABI as ICErc20 } from "./abis";

function main(cTokenAddress: Address, amount: Uint256): Uint256 {
  const cToken = ICErc20.at(cTokenAddress);
  return cToken.borrow(amount);
}
`;

export const repay = `
import { CErc20ABI as ICErc20 } from "./abis";

function main(cTokenAddress: Address, amount: Uint256): Uint256 {
  const cToken = ICErc20.at(cTokenAddress);
  return cToken.repayBorrow(amount);
}
`;
