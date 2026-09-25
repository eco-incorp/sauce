export const transfer = `
import { FraxERC20ABI as IFRAX } from "./abis";

function main(fraxAddress: Address, to: Address, amount: Uint256): Uint256 {
  const frax = IFRAX.at(fraxAddress);
  return frax.transfer(to, amount);
}
`;

export const approve = `
import { FraxERC20ABI as IFRAX } from "./abis";

function main(fraxAddress: Address, spender: Address, amount: Uint256): Uint256 {
  const frax = IFRAX.at(fraxAddress);
  return frax.approve(spender, amount);
}
`;
