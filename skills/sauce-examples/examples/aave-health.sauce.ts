// Guards the Pot's Aave V3 position, to run on a schedule: when its health factor is below
// `trigger`, repays USDC debt from the Pot's USDC until the health factor is back at `target`, or
// as near as the Pot's USDC and its USDC debt allow. At or above `trigger` it does nothing. The
// repayment is priced by Aave's own oracle, read through AaveV3Reads.json beside this file, the
// reads the registry's Aave V3 ABI does not declare. Returns the health factor before and after,
// and the USDC repaid.
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
  require(trigger > 1000000000000000000n && target >= trigger, "need 1 < trigger <= target");
  const self = ctx.self();
  const account = AaveV3.Pool.getUserAccountData(self);
  const before = account.healthFactor;
  if (account.totalDebtBase == 0n || before >= trigger) {
    return { before, after: before, repaid: 0n };
  }

  // health factor = collateral × liquidation threshold ÷ debt, in Aave's base currency (USD, 8
  // decimals) with the threshold in hundredths of a percent. The debt that gives `target`:
  const debtAtTarget = Math.mulDiv(
    account.totalCollateralBase * account.currentLiquidationThreshold,
    1000000000000000000n,
    target * 10000n,
  );
  const excess = account.totalDebtBase - debtAtTarget;
  // In USDC base units at Aave's price for USDC, rounded up so the target is reached.
  const oracle = AaveV3Reads.at(AaveV3.PoolAddressesProvider).getPriceOracle();
  let repay = Math.mulDiv(excess, 1000000n, AaveV3Reads.at(oracle).getAssetPrice(USDC)) + 1n;

  // No more than the Pot owes in USDC, nor more than it holds.
  const debtToken = AaveV3Reads.at(AaveV3.Pool).getReserveVariableDebtToken(USDC);
  const owed = Token(debtToken).balanceOf(self);
  const held = USDC.balanceOf(self);
  if (repay > owed) {
    repay = owed;
  }
  if (repay > held) {
    repay = held;
  }
  require(repay > 0n, "no USDC debt, or no USDC to repay it with");
  USDC.approve(AaveV3.Pool, repay);
  const repaid = AaveV3.Pool.repay(USDC, repay, 2n, self);
  return { before, after: AaveV3.Pool.getUserAccountData(self).healthFactor, repaid };
}
