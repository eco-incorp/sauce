export const transfer = `
import { GhoTokenABI as IGhoToken } from "./abis";

function main(ghoAddress: Address, to: Address, amount: Uint256): Uint256 {
  const gho = IGhoToken.at(ghoAddress);
  gho.transfer(to, amount);
  return 1;
}
`;

export const approve = `
import { GhoTokenABI as IGhoToken } from "./abis";

function main(ghoAddress: Address, spender: Address, amount: Uint256): Uint256 {
  const gho = IGhoToken.at(ghoAddress);
  gho.approve(spender, amount);
  return 1;
}
`;
