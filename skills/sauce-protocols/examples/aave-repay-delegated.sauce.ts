// Closes a line of credit opened with aave-delegate-credit.sauce.ts: revokes what is left of
// `borrower`'s delegation, repays all of the Pot's USDC variable-rate debt on Aave V3 (what the
// borrower borrowed in the Pot's name, with its interest) from the Pot's USDC, and withdraws all of
// the Pot's WETH collateral to `to`. The borrower settles with the Pot first, by sending it USDC;
// the Pot pays whatever is missing. Refuses a debt above `maxRepay`. The debt token's lookup and
// its delegation call are in AaveV3Delegation.json beside this file. Returns the USDC repaid and
// the WETH withdrawn.
//
//   sauce run aave-repay-delegated.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <borrower> <maxRepay> <to>
//
//   borrower: Address  whose delegation to revoke
//   maxRepay: Uint256  the most USDC to repay, in its smallest units (6 decimals):
//                      1010000000 is 1,010 USDC
//   to: Address        who receives the WETH: the user's wallet, or the Pot (`pot`) to keep it
//
// On Ethereum, at most 1,010 USDC repaid:
//
//   sauce run aave-repay-delegated.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <borrower> 1010000000 <to>
import AaveV3Delegation from "./AaveV3Delegation.json";

function main(
  borrower: Address,
  maxRepay: Uint256,
  to: Address,
): { repaid: Uint256; withdrawn: Uint256 } {
  const debtToken = AaveV3Delegation.at(AaveV3.Pool).getReserveVariableDebtToken(USDC);

  // 1. No more borrowing in the Pot's name.
  AaveV3Delegation.at(debtToken).approveDelegation(borrower, 0);

  // 2. The whole USDC debt, as the debt token counts it now, interest included: repaid and approved
  //    exactly, so no allowance is left behind.
  const owed = Token(debtToken).balanceOf(pot);
  require(owed <= maxRepay, "the debt is above maxRepay");
  let repaid = 0;
  if (owed > 0) {
    require(pot.USDC >= owed, "the Pot holds less USDC than it owes");
    USDC.approve(AaveV3.Pool, owed);
    repaid = AaveV3.Pool.repay(USDC, owed, 2, pot);
  }

  // 3. All of the WETH collateral, now that nothing is owed against it.
  const withdrawn = AaveV3.Pool.withdraw(WETH, ~0, to);
  return { repaid, withdrawn };
}
