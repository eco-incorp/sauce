export const deposit = `
import { AlchemistABI as IAlchemist } from "./abis";

function main(alchemistAddress: Address, yieldToken: Address, amount: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.deposit(yieldToken, amount, recipient);
}
`;

export const withdraw = `
import { AlchemistABI as IAlchemist } from "./abis";

function main(alchemistAddress: Address, yieldToken: Address, shares: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.withdraw(yieldToken, shares, recipient);
}
`;

export const mint = `
import { AlchemistABI as IAlchemist } from "./abis";

function main(alchemistAddress: Address, amount: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  alchemist.mint(amount, recipient);
  return 1;
}
`;

export const burn = `
import { AlchemistABI as IAlchemist } from "./abis";

function main(alchemistAddress: Address, amount: Uint256, recipient: Address): Uint256 {
  const alchemist = IAlchemist.at(alchemistAddress);
  return alchemist.burn(amount, recipient);
}
`;
