export const transfer = `
import { BoldTokenABI as IBoldToken } from "./abis";

function main(boldAddress: Address, to: Address, amount: Uint256): Uint256 {
  const bold = IBoldToken.at(boldAddress);
  bold.transfer(to, amount);
  return 1;
}
`;

export const approve = `
import { BoldTokenABI as IBoldToken } from "./abis";

function main(boldAddress: Address, spender: Address, amount: Uint256): Uint256 {
  const bold = IBoldToken.at(boldAddress);
  bold.approve(spender, amount);
  return 1;
}
`;
