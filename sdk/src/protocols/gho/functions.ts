export const transfer = `
import { transfer } from "@sauce/token";

function main(ghoAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(ghoAddress, to, amount);
  return 1;
}
`;

export const approve = `
import { approve } from "@sauce/token";

function main(ghoAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(ghoAddress, spender, amount);
  return 1;
}
`;
