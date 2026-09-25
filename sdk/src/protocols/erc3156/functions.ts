export const flashFee = `
import { FlashLenderABI as IFlashLender } from "./abis";

function main(lenderAddress: Address, token: Address, amount: Uint256): Uint256 {
  const lender = IFlashLender.at(lenderAddress);
  return lender.flashFee(token, amount);
}
`;

export const maxFlashLoan = `
import { FlashLenderABI as IFlashLender } from "./abis";

function main(lenderAddress: Address, token: Address): Uint256 {
  const lender = IFlashLender.at(lenderAddress);
  return lender.maxFlashLoan(token);
}
`;
