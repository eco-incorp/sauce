export const stake = `
import { METHABI as IMETH } from "./abis";

function main(methAddress: Address, minMETHAmount: Uint256): Uint256 {
  const meth = IMETH.at(methAddress);
  meth.stake(minMETHAmount);
  return 1;
}
`;
