export const supply = `
import { AaveV4SpokeABI as ISpoke } from "./abis";

function main(spokeAddress: Address, reserveId: Uint256, amount: Uint256, onBehalfOf: Address): Uint256 {
  const spoke = ISpoke.at(spokeAddress);
  spoke.supply(reserveId, amount, onBehalfOf);
  return 1;
}
`;

export const withdraw = `
import { AaveV4SpokeABI as ISpoke } from "./abis";

function main(spokeAddress: Address, reserveId: Uint256, amount: Uint256, onBehalfOf: Address): Uint256 {
  const spoke = ISpoke.at(spokeAddress);
  spoke.withdraw(reserveId, amount, onBehalfOf);
  return 1;
}
`;

export const borrow = `
import { AaveV4SpokeABI as ISpoke } from "./abis";

function main(spokeAddress: Address, reserveId: Uint256, amount: Uint256, onBehalfOf: Address): Uint256 {
  const spoke = ISpoke.at(spokeAddress);
  spoke.borrow(reserveId, amount, onBehalfOf);
  return 1;
}
`;

export const repay = `
import { AaveV4SpokeABI as ISpoke } from "./abis";

function main(spokeAddress: Address, reserveId: Uint256, amount: Uint256, onBehalfOf: Address): Uint256 {
  const spoke = ISpoke.at(spokeAddress);
  spoke.repay(reserveId, amount, onBehalfOf);
  return 1;
}
`;
