export const transfer = `
import { transfer } from "@sauce/token";

function main(boldAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(boldAddress, to, amount);
  return 1;
}
`;

export const approve = `
import { approve } from "@sauce/token";

function main(boldAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(boldAddress, spender, amount);
  return 1;
}
`;
