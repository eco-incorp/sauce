export const transfer = `
import { transfer } from "@sauce/token";

function main(cbethAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(cbethAddress, to, amount);
  return 1;
}
`;

export const approve = `
import { approve } from "@sauce/token";

function main(cbethAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(cbethAddress, spender, amount);
  return 1;
}
`;
