export const transfer = `
import { CbETHABI as ICbETH } from "./abis";

function main(cbethAddress: Address, to: Address, amount: Uint256): Uint256 {
  const cbeth = ICbETH.at(cbethAddress);
  cbeth.transfer(to, amount);
  return 1;
}
`;

export const approve = `
import { CbETHABI as ICbETH } from "./abis";

function main(cbethAddress: Address, spender: Address, amount: Uint256): Uint256 {
  const cbeth = ICbETH.at(cbethAddress);
  cbeth.approve(spender, amount);
  return 1;
}
`;
