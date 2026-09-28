export const depositERC20 = `
import { DepositContractABI as IDeposit } from "./abis";

function main(depositAddress: Address, token: Address, l2Token: Address, amount: Uint256, minGasLimit: Uint256): Uint256 {
  const deposit = IDeposit.at(depositAddress);
  deposit.depositERC20(token, l2Token, amount, minGasLimit, "");
  return 1;
}
`;
