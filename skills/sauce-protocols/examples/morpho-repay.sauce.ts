// Closes the Pot's position in a Morpho Blue market: repays all of its debt by its borrow shares,
// so no dust of debt is left behind, from the Pot's loan token, and withdraws all of its collateral
// to `to`. Interest is accrued first, so the debt repaid is the debt now; the loan token is approved
// for exactly that. Refuses a debt above `maxRepay`. Morpho's reads, which the registry's Morpho ABI
// does not declare, are in MorphoMarket.json beside this file, as Morpho Blue's IMorpho interface
// declares them. Returns the loan token repaid, the shares that repaid, and the collateral
// withdrawn.
//
//   sauce run morpho-repay.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <id> <maxRepay> <to>
//
//   id: Uint256        the market's id, a 32-byte hash, as Morpho lists it
//   maxRepay: Uint256  the most loan token to repay, in its smallest units:
//                      1010000000 is 1,010 USDC (6 decimals)
//   to: Address        who receives the collateral: the user's wallet, or the Pot (`pot`) to keep it
//
// On Ethereum, at most 1,010 USDC repaid in the market lending USDC against WETH at an 86% LLTV:
//
//   sauce run morpho-repay.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 0x94b823e6bd8ea533b4e33fbc307faea0b307301bc48763acc4d4aa4def7636cd 1010000000 <to>
import MorphoMarket from "./MorphoMarket.json";

// Morpho's virtual shares and assets, which it adds to a market's totals in every conversion.
const VIRTUAL_SHARES = 1000000;
const VIRTUAL_ASSETS = 1;

function main(
  id: Uint256,
  maxRepay: Uint256,
  to: Address,
): { repaid: Uint256; sharesRepaid: Uint256; withdrawn: Uint256 } {
  const morpho = MorphoMarket.at(MorphoBlue.Morpho);
  const params = morpho.idToMarketParams(id);
  require(params.loanToken != 0, "no Morpho Blue market has that id");
  const market = {
    loanToken: params.loanToken,
    collateralToken: params.collateralToken,
    oracle: params.oracle,
    irm: params.irm,
    lltv: params.lltv,
  };

  // 1. The debt now: interest accrued, then the Pot's shares in the loan token, rounded up as
  //    Morpho rounds what a repayment of shares costs.
  morpho.accrueInterest(market);
  const position = morpho.position(id, pot);
  let repaid = 0;
  let sharesRepaid = 0;
  if (position.borrowShares > 0) {
    const totals = morpho.market(id);
    const shares = totals.totalBorrowShares + VIRTUAL_SHARES;
    const owed =
      (position.borrowShares * (totals.totalBorrowAssets + VIRTUAL_ASSETS) + shares - 1) / shares;
    require(owed <= maxRepay, "the debt is above maxRepay");
    Token(market.loanToken).approve(MorphoBlue.Morpho, owed);
    // 2. Repaid by shares, every one of them: `assets` is 0 when `shares` is given.
    const result = MorphoBlue.Morpho.repay(market, 0, position.borrowShares, pot, hex``);
    repaid = result.assetsRepaid;
    sharesRepaid = result.sharesRepaid;
  }

  // 3. All of the collateral, now that nothing is owed against it.
  if (position.collateral > 0) {
    MorphoBlue.Morpho.withdrawCollateral(market, position.collateral, pot, to);
  }

  return { repaid, sharesRepaid, withdrawn: position.collateral };
}
