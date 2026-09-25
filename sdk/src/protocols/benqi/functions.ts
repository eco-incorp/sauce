export const supply = `
import { QiTokenABI as IQiToken } from "./abis";

function main(qiTokenAddress: Address, amount: Uint256): Uint256 {
  const qiToken = IQiToken.at(qiTokenAddress);
  return qiToken.mint(amount);
}
`;

export const withdraw = `
import { QiTokenABI as IQiToken } from "./abis";

function main(qiTokenAddress: Address, amount: Uint256): Uint256 {
  const qiToken = IQiToken.at(qiTokenAddress);
  return qiToken.redeemUnderlying(amount);
}
`;

export const borrow = `
import { QiTokenABI as IQiToken } from "./abis";

function main(qiTokenAddress: Address, amount: Uint256): Uint256 {
  const qiToken = IQiToken.at(qiTokenAddress);
  return qiToken.borrow(amount);
}
`;

export const repay = `
import { QiTokenABI as IQiToken } from "./abis";

function main(qiTokenAddress: Address, amount: Uint256): Uint256 {
  const qiToken = IQiToken.at(qiTokenAddress);
  return qiToken.repayBorrow(amount);
}
`;
