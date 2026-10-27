// Closes the Pot's borrow on Compound III's USDC market and claims its rewards: repays all of the
// Pot's USDC debt, interest included, from the Pot's USDC, withdraws all of its WETH collateral to
// `to`, and claims the COMP the Pot's borrow earned through Compound's CometRewards contract
// (`rewards`), to `to` as well. Supplying USDC to the market while the Pot owes it repays the debt
// first; supplying `~0` repays exactly what is owed and no more. Refuses a debt above `maxRepay`.
// The market's and CometRewards' calls the registry's Comet ABI does not declare are in
// CometMarket.json beside this file, as Compound III's interfaces declare them. Returns the USDC
// repaid, the WETH withdrawn, and the reward token and the amount of it claimed.
//
//   sauce run compound-repay.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <rewards> <maxRepay> <to>
//
//   rewards: Address   Compound's CometRewards contract on the chain, from Compound's deployments
//   maxRepay: Uint256  the most USDC to repay, in its smallest units (6 decimals):
//                      1010000000 is 1,010 USDC
//   to: Address        who receives the WETH and the rewards: the user's wallet, or the Pot (`pot`)
//
// On Ethereum, at most 1,010 USDC repaid:
//
//   sauce run compound-repay.sauce.ts --chain ethereum --keystore <keystore> \
//     --args <rewards> 1010000000 <to>
import CometMarket from "./CometMarket.json";

function main(
  rewards: Address,
  maxRepay: Uint256,
  to: Address,
): { repaid: Uint256; withdrawn: Uint256; rewardToken: Address; claimed: Uint256 } {
  // 1. The whole debt, approved exactly and repaid by supplying the base asset.
  const repaid = CompoundV3.CUSDCv3.borrowBalanceOf(pot);
  require(repaid <= maxRepay, "the debt is above maxRepay");
  if (repaid > 0) {
    require(pot.USDC >= repaid, "the Pot holds less USDC than it owes");
    USDC.approve(CompoundV3.CUSDCv3, repaid);
    CompoundV3.CUSDCv3.supply(USDC, ~0);
    require(CompoundV3.CUSDCv3.borrowBalanceOf(pot) == 0, "the debt is not repaid");
  }

  // 2. Every WETH collateral, now that nothing is owed against it.
  const withdrawn = CometMarket.at(CompoundV3.CUSDCv3).collateralBalanceOf(pot, WETH);
  if (withdrawn > 0) {
    CompoundV3.CUSDCv3.withdrawTo(to, WETH, withdrawn);
  }

  // 3. The rewards the Pot earned on this market, measured where they arrive.
  const owed = CometMarket.at(rewards).getRewardOwed(CompoundV3.CUSDCv3, pot);
  const before = Token(owed.token).balanceOf(to);
  CometMarket.at(rewards).claimTo(CompoundV3.CUSDCv3, pot, to, true);
  const claimed = Token(owed.token).balanceOf(to) - before;

  return { repaid, withdrawn, rewardToken: owed.token, claimed };
}
