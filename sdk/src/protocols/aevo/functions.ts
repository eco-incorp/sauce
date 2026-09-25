export const depositERC20 = `
import { DepositContractABI as IDeposit } from "./abis";

function main(depositAddress: Address, token: Address, amount: Uint256): Uint256 {
  const deposit = IDeposit.at(depositAddress);
  deposit.depositERC20(token, amount);
  return 1;
}
`;
