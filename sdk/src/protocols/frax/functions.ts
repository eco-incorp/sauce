export const transfer = `
import { transfer } from "@sauce/token";

function main(fraxAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(fraxAddress, to, amount);
  return 1;
}
`;

export const approve = `
import { approve } from "@sauce/token";

function main(fraxAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(fraxAddress, spender, amount);
  return 1;
}
`;
