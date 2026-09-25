export const closeTrove = `
import { BorrowerOperationsABI as IBorrowerOperations } from "./abis";

function main(borrowerOpsAddress: Address): Uint256 {
  const borrowerOps = IBorrowerOperations.at(borrowerOpsAddress);
  borrowerOps.closeTrove();
  return 1;
}
`;

export const repayLUSD = `
import { BorrowerOperationsABI as IBorrowerOperations } from "./abis";

function main(borrowerOpsAddress: Address, amount: Uint256): Uint256 {
  const borrowerOps = IBorrowerOperations.at(borrowerOpsAddress);
  borrowerOps.repayLUSD(amount);
  return 1;
}
`;
