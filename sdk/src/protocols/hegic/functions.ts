export const exerciseOption = `
import { HegicABI as IHegic } from "./abis";

function main(treasuryAddress: Address, optionId: Uint256, account: Address): Uint256 {
  const treasury = IHegic.at(treasuryAddress);
  treasury.payOff(optionId, account);
  return 1;
}
`;
