export const transfer = `
import { transfer } from "@sauce/token";

function main(crvusdAddress: Address, to: Address, amount: Uint256): Uint256 {
  transfer(crvusdAddress, to, amount);
  return 1;
}
`;

export const approve = `
import { approve } from "@sauce/token";

function main(crvusdAddress: Address, spender: Address, amount: Uint256): Uint256 {
  approve(crvusdAddress, spender, amount);
  return 1;
}
`;
