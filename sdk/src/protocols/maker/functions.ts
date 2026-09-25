export const depositToSDAI = `
import { SavingsDaiABI as ISavingsDai } from "./abis";

function main(sDAIAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const sDAI = ISavingsDai.at(sDAIAddress);
  return sDAI.deposit(amount, receiver);
}
`;

export const withdrawFromSDAI = `
import { SavingsDaiABI as ISavingsDai } from "./abis";

function main(sDAIAddress: Address, amount: Uint256, receiver: Address, owner: Address): Uint256 {
  const sDAI = ISavingsDai.at(sDAIAddress);
  return sDAI.withdraw(amount, receiver, owner);
}
`;

export const redeemFromSDAI = `
import { SavingsDaiABI as ISavingsDai } from "./abis";

function main(sDAIAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const sDAI = ISavingsDai.at(sDAIAddress);
  return sDAI.redeem(shares, receiver, owner);
}
`;
