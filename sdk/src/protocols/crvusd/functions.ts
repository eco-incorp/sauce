export const transfer = `
import { CrvUSDERC20ABI as ICrvUSD } from "./abis";

function main(crvusdAddress: Address, to: Address, amount: Uint256): Uint256 {
  const crvusd = ICrvUSD.at(crvusdAddress);
  return crvusd.transfer(to, amount);
}
`;

export const approve = `
import { CrvUSDERC20ABI as ICrvUSD } from "./abis";

function main(crvusdAddress: Address, spender: Address, amount: Uint256): Uint256 {
  const crvusd = ICrvUSD.at(crvusdAddress);
  return crvusd.approve(spender, amount);
}
`;
