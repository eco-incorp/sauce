export const borrow = `
import { CauldronABI as ICauldron } from "./abis";

function main(cauldronAddress: Address, to: Address, amount: Uint256): { part: Uint256, share: Uint256 } {
  const cauldron = ICauldron.at(cauldronAddress);
  return cauldron.borrow(to, amount);
}
`;

export const repay = `
import { CauldronABI as ICauldron } from "./abis";

function main(cauldronAddress: Address, to: Address, part: Uint256): Uint256 {
  const cauldron = ICauldron.at(cauldronAddress);
  return cauldron.repay(to, 0, part);
}
`;

export const addCollateral = `
import { CauldronABI as ICauldron } from "./abis";

function main(cauldronAddress: Address, to: Address, share: Uint256): Uint256 {
  const cauldron = ICauldron.at(cauldronAddress);
  cauldron.addCollateral(to, 0, share);
  return 1;
}
`;

export const removeCollateral = `
import { CauldronABI as ICauldron } from "./abis";

function main(cauldronAddress: Address, to: Address, share: Uint256): Uint256 {
  const cauldron = ICauldron.at(cauldronAddress);
  cauldron.removeCollateral(to, share);
  return 1;
}
`;
