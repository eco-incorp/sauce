export const exercise = `
import { DiamondABI as IDiamond } from "./abis";

function main(diamondAddress: Address, holder: Address, longTokenId: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  return diamond.exercise(holder, longTokenId);
}
`;

export const settle = `
import { DiamondABI as IDiamond } from "./abis";

function main(diamondAddress: Address, holder: Address, shortTokenId: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  return diamond.settle(holder, shortTokenId);
}
`;
