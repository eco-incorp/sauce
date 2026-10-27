// Opens a line of credit on Aave V3 for someone else: supplies `collateral` of the Pot's WETH to
// Aave V3 for the Pot, then lets `borrower` borrow up to `credit` of USDC against it, by delegating
// borrowing power on USDC's variable-debt token. The borrower then borrows with the Pot as
// `onBehalfOf`, from their own wallet or Pot: `AaveV3.Pool.borrow(USDC, amount, 2, 0, <pot>)`. The
// USDC goes to the borrower and the debt to the Pot, which carries it and its liquidation risk until
// aave-repay-delegated.sauce.ts repays it. The reserve's token lookups and the debt token's
// delegation calls, which the registry's Aave V3 ABI does not declare, are in AaveV3Delegation.json
// beside this file, as Aave V3's Pool and VariableDebtToken interfaces declare them. Returns the
// debt token, the borrower's allowance as the debt token records it, and the Pot's WETH collateral
// on Aave, its aWETH, in wei.
//
//   sauce run aave-delegate-credit.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <borrower> <collateral> <credit>
//
//   borrower: Address    who may borrow USDC on the Pot's collateral
//   collateral: Uint256  the Pot's WETH to supply first, in wei (18 decimals):
//                        10000000000000000000 is 10 WETH; 0 supplies nothing
//   credit: Uint256      the USDC the borrower may borrow, in its smallest units (6 decimals):
//                        1000000000 is 1,000 USDC; it replaces any earlier delegation
//
// On Ethereum, 10 WETH supplied and 1,000 USDC of credit:
//
//   sauce run aave-delegate-credit.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <borrower> 10000000000000000000 1000000000
import AaveV3Delegation from "./AaveV3Delegation.json";

function main(
  borrower: Address,
  collateral: Uint256,
  credit: Uint256,
): { debtToken: Address; allowance: Uint256; collateral: Uint256 } {
  require(borrower != 0 && borrower != pot, "the borrower is another account");

  // 1. The collateral, supplied for the Pot: the position is the Pot's, and so is any debt the
  //    borrower takes against it.
  if (collateral > 0) {
    WETH.approve(AaveV3.Pool, collateral);
    AaveV3.Pool.supply(WETH, collateral, pot, 0);
  }

  // 2. The credit: the borrower may open USDC variable-rate debt in the Pot's name, up to `credit`.
  const debtToken = AaveV3Delegation.at(AaveV3.Pool).getReserveVariableDebtToken(USDC);
  AaveV3Delegation.at(debtToken).approveDelegation(borrower, credit);
  const allowance = AaveV3Delegation.at(debtToken).borrowAllowance(pot, borrower);
  require(allowance == credit, "the delegation was not recorded");

  // 3. The Pot's collateral on Aave: its aWETH, which grows with interest.
  const aToken = AaveV3Delegation.at(AaveV3.Pool).getReserveAToken(WETH);
  return { debtToken, allowance, collateral: Token(aToken).balanceOf(pot) };
}
