export const deposit = `
import { CellarABI as ICellar } from "./abis";

function main(cellarAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const cellar = ICellar.at(cellarAddress);
  return cellar.deposit(assets, receiver);
}
`;

export const withdraw = `
import { CellarABI as ICellar } from "./abis";

function main(cellarAddress: Address, assets: Uint256, receiver: Address, owner: Address): Uint256 {
  const cellar = ICellar.at(cellarAddress);
  return cellar.withdraw(assets, receiver, owner);
}
`;

export const redeem = `
import { CellarABI as ICellar } from "./abis";

function main(cellarAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const cellar = ICellar.at(cellarAddress);
  return cellar.redeem(shares, receiver, owner);
}
`;
