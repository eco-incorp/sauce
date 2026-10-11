// Guards the Pot's Aave V3 position, to run on a schedule: when its health factor is below
// `trigger`, repays USDC debt from the Pot's USDC until the health factor is back at `target`, or
// as near as the Pot's USDC and its USDC debt allow. At or above `trigger` it does nothing. The
// repayment is priced by Aave's own oracle, read through AaveV3Reads.json beside this file, the
// reads the registry's Aave V3 ABI does not declare. Returns the health factor before and after,
// and the USDC repaid.
// The position is the Pot's (supplied for the Pot), so the repayment is on the Pot's behalf.
//
//   sauce run aave-health.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <trigger> <target>
//
//   trigger: Uint256  act below this health factor, as Aave states it (times 1e18):
//                     1300000000000000000 is 1.3
//   target: Uint256   the health factor to restore, no lower than `trigger`:
//                     1500000000000000000 is 1.5
//
// On Base, act below 1.3 and restore 1.5:
//
//   sauce run aave-health.sauce.ts --chain base --keystore <keystore> \
//     --args 1300000000000000000 1500000000000000000
import AaveV3Reads from "./AaveV3Reads.json";

function main(
  trigger: Uint256,
  target: Uint256,
): { before: Uint256; after: Uint256; repaid: Uint256 } {
  require(AaveV3.Pool);
  require(AaveV3.PoolAddressesProvider);
  require(trigger > 1000000000000000000 && target >= trigger, "need 1 < trigger <= target");
  const self = ctx.self();
  const account = AaveV3.Pool.getUserAccountData(self);
  const before = account.healthFactor;
  if (account.totalDebtBase == 0 || before >= trigger) {
    return { before, after: before, repaid: 0 };
  }

  // health factor = collateral × liquidation threshold ÷ debt, in Aave's base currency (USD, 8
  // decimals) with the threshold in hundredths of a percent. The debt that gives `target`:
  const debtAtTarget = Math.mulDiv(
    account.totalCollateralBase * account.currentLiquidationThreshold,
    1000000000000000000,
    target * 10000,
  );
  // The Pot's USDC debt, in USDC base units, and its worth at Aave's price for USDC. Debt in other
  // tokens stays; the USDC debt to keep is what is left of debtAtTarget beside it.
  const debtToken = AaveV3Reads.at(AaveV3.Pool).getReserveVariableDebtToken(USDC);
  const owed = Token(debtToken).balanceOf(self);
  const oracle = AaveV3Reads.at(AaveV3.PoolAddressesProvider).getPriceOracle();
  const usdcPrice = AaveV3Reads.at(oracle).getAssetPrice(USDC); // base currency per USDC
  const owedValue = Math.mulDiv(owed, usdcPrice, 1000000);
  const other = account.totalDebtBase > owedValue ? account.totalDebtBase - owedValue : 0;
  const keep = debtAtTarget > other ? Math.mulDiv(debtAtTarget - other, 1000000, usdcPrice) : 0;
  // One unit more than the difference, for Aave's rounding of the debt it burns; no more than the
  // Pot owes, nor more than it holds.
  let repay = owed > keep ? owed - keep + 1 : 0;
  if (repay > owed) {
    repay = owed;
  }
  const held = USDC.balanceOf(self);
  if (repay > held) {
    repay = held;
  }
  require(repay > 0, "no USDC debt, or no USDC to repay it with");
  USDC.approve(AaveV3.Pool, repay);
  const repaid = AaveV3.Pool.repay(USDC, repay, 2, self);
  return { before, after: AaveV3.Pool.getUserAccountData(self).healthFactor, repaid };
}
