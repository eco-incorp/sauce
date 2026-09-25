export const exerciseOption = `
import { HegicABI as IHegic } from "./abis";

function main(hegicAddress: Address, optionId: Uint256): Uint256 {
  const hegic = IHegic.at(hegicAddress);
  hegic.exercise(optionId);
  return 1;
}
`;
