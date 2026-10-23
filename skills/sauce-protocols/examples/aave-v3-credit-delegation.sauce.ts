// Aave's credit delegation example, ported to Aave V3: `MyV2CreditDelegation` supplies collateral to
// Aave, lets one borrower borrow against it, repays that borrower's debt and takes the collateral
// back. Here the Pot is the delegator: the collateral is the Pot's, the debt the borrower runs up is
// the Pot's, and only its owner cooks it. `step` picks the function, and each returns the amount it
// moved or allowed.
//
// Ported from aave/code-examples-protocol, V2/Credit Delegation/MyV2CreditDelegation.sol (83 lines, 33 of code):
// https://github.com/aave/code-examples-protocol/blob/c343d266d04f210e1de9a7f008fdbc8ad63e5c22/V2/Credit%20Delegation/MyV2CreditDelegation.sol
//
// What changes in Sauce: Aave's own example targets its second version, and this the third, whose
// Pool is the registry's `AaveV3.Pool`: `deposit` is `supply`, and the debt is variable, since the
// third version takes no new stable-rate debt. The contract pulled tokens from its caller when asked
// to (`isPull`); the Pot's tokens are already the Pot's. It found the debt and aTokens through
// Aave's data provider, a Kovan address; the Pool names them itself, in AaveV3Delegation.json beside
// this file with the debt token's `approveDelegation`, which the registry's ABI leaves out. And it
// withdrew to the contract's deployer; `account` is who receives the collateral.
//
//   sauce run aave-v3-credit-delegation.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <step> <asset> <amount> <account>
//
//   step: Uint256      0 supply `amount` of `asset` as collateral, 1 let `account` borrow up to
//                      `amount` of `asset` against it, 2 repay up to `amount` of the debt in `asset`,
//                      3 withdraw all the `asset` collateral to `account`
//   asset: Address     the token supplied, delegated, repaid or withdrawn
//   amount: Uint256    how much, in the token's smallest units: 1000000000 is 1,000 USDC (6 decimals)
//   account: Address   the borrower (step 1), or who receives the collateral (step 3)
//
// On Ethereum, a borrower allowed up to 1,000 USDC against the Pot's collateral:
//
//   sauce run aave-v3-credit-delegation.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 1 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 1000000000 <borrower>
import AaveV3Delegation from "./AaveV3Delegation.json";

// The variable rate, as Aave's `interestRateMode` names it.
const VARIABLE = 2;

function depositCollateral(asset: Address, amount: Uint256): Uint256 {
  require(AaveV3.Pool);
  approve(asset, AaveV3.Pool, amount);
  AaveV3.Pool.supply(asset, amount, ctx.self(), 0);
  return amount;
}

function approveBorrower(borrower: Address, amount: Uint256, asset: Address): Uint256 {
  require(AaveV3.Pool);
  const debtToken = AaveV3Delegation.at(AaveV3.Pool).getReserveVariableDebtToken(asset);
  AaveV3Delegation.at(debtToken).approveDelegation(borrower, amount);
  return amount;
}

function repayBorrower(amount: Uint256, asset: Address): Uint256 {
  require(AaveV3.Pool);
  approve(asset, AaveV3.Pool, amount);
  const repaid = AaveV3.Pool.repay(asset, amount, VARIABLE, ctx.self());
  // A repayment above the debt pays the debt: the allowance for the rest does not stand.
  if (repaid < amount) {
    approve(asset, AaveV3.Pool, 0);
  }
  return repaid;
}

function withdrawCollateral(asset: Address, to: Address): Uint256 {
  require(AaveV3.Pool);
  const aToken = AaveV3Delegation.at(AaveV3.Pool).getReserveAToken(asset);
  const assetBalance = Token(aToken).balanceOf(ctx.self());
  return AaveV3.Pool.withdraw(asset, assetBalance, to);
}

function main(step: Uint256, asset: Address, amount: Uint256, account: Address): Uint256 {
  if (step == 0) {
    return depositCollateral(asset, amount);
  }
  if (step == 1) {
    return approveBorrower(account, amount, asset);
  }
  if (step == 2) {
    return repayBorrower(amount, asset);
  }
  require(step == 3, "step is 0 to 3");
  return withdrawCollateral(asset, account);
}
