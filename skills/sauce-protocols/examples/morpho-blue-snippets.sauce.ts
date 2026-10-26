// Morpho's snippets, ported: `MorphoBlueSnippets` is Morpho's catalogue of how to use one Morpho
// Blue market, each snippet a function: supply, supply collateral, withdraw it, withdraw an amount,
// half or all of a supply, borrow, repay an amount, half or all of a debt, and the views a position
// needs (the supply and borrow APYs, a user's supply, debt and collateral, the market's totals, the
// health factor). Here the Pot is the user: `step` picks a snippet (0 none), and every cook returns
// what it moved and those views for the Pot.
//
// Ported from morpho-org/morpho-blue-snippets, src/morpho-blue/MorphoBlueSnippets.sol (380 lines, 219 of code):
// https://github.com/morpho-org/morpho-blue-snippets/blob/43568fd8626a2f44dc49e5ac7040ec6dc7ee67c3/src/morpho-blue/MorphoBlueSnippets.sol
//
// What changes in Sauce: the snippets act for their caller, who must authorize the contract on
// Morpho, and pull its tokens; the Pot acts for itself, and `receiver` is where withdrawals and
// borrows go. They take the market's parameters; the program takes its id and reads them from
// Morpho, which is what `marketParams.id()` names. Their views compute in view-only math the
// interest accrued since the market was last touched (MorphoBalancesLib); a program runs as a
// transaction, even under `sauce simulate`, so it accrues the interest (`accrueInterest`) and reads
// the market. They approve the maximum and leave it standing; the program approves what each call
// spends. A user's collateral is read with `position`, not by its storage slot. Morpho's reads,
// the IRM's rate and the oracle's price are in MorphoBlueReads.json beside this file.
//
//   sauce run morpho-blue-snippets.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <step> <id> <amount> <receiver>
//
//   step: Uint256       0 none; 1 supply, 2 supply collateral, 3 withdraw collateral; 4 withdraw
//                       `amount`, 5 half, 6 all, 7 `amount` or all; 8 borrow; 9 repay `amount`,
//                       10 half, 11 all, 12 `amount` or all
//   id: Uint256         the market's id, as Morpho names it (a hash of its parameters)
//   amount: Uint256     how much of the loan or collateral token, in its smallest units:
//                       1000000000 is 1,000 USDC (6 decimals)
//   receiver: Address   who receives what a withdrawal or a borrow pays out
//
// On Ethereum, the USDC market with WETH collateral at an 86% LLTV, read with nothing changed:
//
//   sauce simulate morpho-blue-snippets.sauce.ts --chain ethereum --owner <owner> \
//     --args 0 0x94b823e6bd8ea533b4e33fbc307faea0b307301bc48763acc4d4aa4def7636cd 0 <receiver>
import MorphoReads from "./MorphoBlueReads.json";

const WAD = 10 ** 18;
const VIRTUAL_SHARES = 10 ** 6;
const VIRTUAL_ASSETS = 1;
const ORACLE_PRICE_SCALE = 10 ** 36;
const YEAR = 365 * 24 * 60 * 60;

// What a snippet supplied, withdrew, borrowed or repaid: assets, and shares where it moved shares.
interface Moved {
  assets: Uint256;
  shares: Uint256;
}

interface Snippet {
  // What the step's snippet moved.
  assets: Uint256;
  shares: Uint256;
  supplyApy: Uint256;
  borrowApy: Uint256;
  supplied: Uint256;
  borrowed: Uint256;
  collateral: Uint256;
  totalSupply: Uint256;
  totalBorrow: Uint256;
  healthFactor: Uint256;
}

// Morpho's share math (SharesMathLib): virtual shares and assets keep a market's first deposit
// from setting its price.
function toAssetsDown(shares: Uint256, totalAssets: Uint256, totalShares: Uint256): Uint256 {
  return Math.mulDiv(shares, totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES);
}

function toAssetsUp(shares: Uint256, totalAssets: Uint256, totalShares: Uint256): Uint256 {
  const d = totalShares + VIRTUAL_SHARES;
  return (shares * (totalAssets + VIRTUAL_ASSETS) + (d - 1)) / d;
}

// e^(x·n) - 1, to three terms (MathLib's wTaylorCompounded): a per-second rate compounded.
function wTaylorCompounded(x: Uint256, n: Uint256): Uint256 {
  const firstTerm = x * n;
  const secondTerm = Math.mulDiv(firstTerm, firstTerm, 2 * WAD);
  const thirdTerm = Math.mulDiv(secondTerm, firstTerm, 3 * WAD);
  return firstTerm + secondTerm + thirdTerm;
}

function supply(id: Uint256, amount: Uint256): Moved {
  require(MorphoBlue.Morpho);
  const params = MorphoReads.at(MorphoBlue.Morpho).idToMarketParams(id);
  approve(params.loanToken, MorphoBlue.Morpho, amount);
  const [assets, shares] = MorphoBlue.Morpho.supply(params, amount, 0, pot, hex``);
  return { assets: assets, shares: shares };
}

function supplyCollateral(id: Uint256, amount: Uint256): Moved {
  require(MorphoBlue.Morpho);
  const params = MorphoReads.at(MorphoBlue.Morpho).idToMarketParams(id);
  approve(params.collateralToken, MorphoBlue.Morpho, amount);
  MorphoBlue.Morpho.supplyCollateral(params, amount, pot, hex``);
  return { assets: amount, shares: 0 };
}

function withdrawCollateral(id: Uint256, amount: Uint256, receiver: Address): Moved {
  require(MorphoBlue.Morpho);
  const params = MorphoReads.at(MorphoBlue.Morpho).idToMarketParams(id);
  MorphoBlue.Morpho.withdrawCollateral(params, amount, pot, receiver);
  return { assets: amount, shares: 0 };
}

// `withdrawAmount`, `withdraw50Percent`, `withdrawAll` and `withdrawAmountOrAll`: an amount of
// assets, or a number of shares, never both.
function withdraw(id: Uint256, step: Uint256, amount: Uint256, receiver: Address): Moved {
  require(MorphoBlue.Morpho);
  const morpho = MorphoReads.at(MorphoBlue.Morpho);
  const params = morpho.idToMarketParams(id);
  morpho.accrueInterest(params);
  const supplyShares = morpho.position(id, pot).supplyShares;
  let assets = amount;
  let shares = 0;
  if (step == 5) {
    assets = 0;
    shares = supplyShares / 2;
  }
  if (step == 6) {
    assets = 0;
    shares = supplyShares;
  }
  if (step == 7) {
    const market = morpho.market(id);
    const assetsMax = toAssetsDown(
      supplyShares,
      market.totalSupplyAssets,
      market.totalSupplyShares,
    );
    if (amount >= assetsMax) {
      assets = 0;
      shares = supplyShares;
    }
  }
  const [withdrawn, burned] = MorphoBlue.Morpho.withdraw(params, assets, shares, pot, receiver);
  return { assets: withdrawn, shares: burned };
}

function borrow(id: Uint256, amount: Uint256, receiver: Address): Moved {
  require(MorphoBlue.Morpho);
  const params = MorphoReads.at(MorphoBlue.Morpho).idToMarketParams(id);
  const [assets, shares] = MorphoBlue.Morpho.borrow(params, amount, 0, pot, receiver);
  return { assets: assets, shares: shares };
}

// `repayAmount`, `repay50Percent`, `repayAll` and `repayAmountOrAll`: by shares, the assets they
// cost are worked out as Morpho works them out, rounded up, and approved exactly.
function repay(id: Uint256, step: Uint256, amount: Uint256): Moved {
  require(MorphoBlue.Morpho);
  const morpho = MorphoReads.at(MorphoBlue.Morpho);
  const params = morpho.idToMarketParams(id);
  morpho.accrueInterest(params);
  const market = morpho.market(id);
  const borrowShares = morpho.position(id, pot).borrowShares;
  let assets = amount;
  let shares = 0;
  if (step == 10) {
    shares = borrowShares / 2;
  }
  if (step == 11) {
    shares = borrowShares;
  }
  if (step == 12) {
    if (amount >= toAssetsUp(borrowShares, market.totalBorrowAssets, market.totalBorrowShares)) {
      shares = borrowShares;
    }
  }
  if (shares > 0) {
    assets = toAssetsUp(shares, market.totalBorrowAssets, market.totalBorrowShares);
  }
  approve(params.loanToken, MorphoBlue.Morpho, assets);
  const [repaid, burned] = MorphoBlue.Morpho.repay(
    params,
    shares > 0 ? 0 : assets,
    shares,
    pot,
    hex``,
  );
  return { assets: repaid, shares: burned };
}

function main(step: Uint256, id: Uint256, amount: Uint256, receiver: Address): Snippet {
  require(MorphoBlue.Morpho);
  require(step <= 12, "step is 0 to 12");
  let moved: Moved = { assets: 0, shares: 0 };
  if (step == 1) {
    moved = supply(id, amount);
  }
  if (step == 2) {
    moved = supplyCollateral(id, amount);
  }
  if (step == 3) {
    moved = withdrawCollateral(id, amount, receiver);
  }
  if (step >= 4 && step <= 7) {
    moved = withdraw(id, step, amount, receiver);
  }
  if (step == 8) {
    moved = borrow(id, amount, receiver);
  }
  if (step >= 9) {
    moved = repay(id, step, amount);
  }

  // The views, on the market with its interest accrued to now.
  const morpho = MorphoReads.at(MorphoBlue.Morpho);
  const params = morpho.idToMarketParams(id);
  morpho.accrueInterest(params);
  const market = morpho.market(id);
  const position = morpho.position(id, pot);
  let borrowApy = 0;
  let supplyApy = 0;
  if (params.irm != 0) {
    borrowApy = wTaylorCompounded(MorphoReads.at(params.irm).borrowRateView(params, market), YEAR);
    const utilization =
      market.totalBorrowAssets == 0
        ? 0
        : (market.totalBorrowAssets * WAD + market.totalSupplyAssets - 1) /
          market.totalSupplyAssets;
    supplyApy = Math.mulDiv(Math.mulDiv(borrowApy, WAD - market.fee, WAD), utilization, WAD);
  }
  const borrowed = toAssetsUp(
    position.borrowShares,
    market.totalBorrowAssets,
    market.totalBorrowShares,
  );
  const collateralPrice = MorphoReads.at(params.oracle).price();
  const maxBorrow = Math.mulDiv(
    Math.mulDiv(position.collateral, collateralPrice, ORACLE_PRICE_SCALE),
    params.lltv,
    WAD,
  );
  return {
    assets: moved.assets,
    shares: moved.shares,
    supplyApy,
    borrowApy,
    supplied: toAssetsDown(
      position.supplyShares,
      market.totalSupplyAssets,
      market.totalSupplyShares,
    ),
    borrowed,
    collateral: position.collateral,
    totalSupply: market.totalSupplyAssets,
    totalBorrow: market.totalBorrowAssets,
    healthFactor: borrowed == 0 ? ~0 : (maxBorrow * WAD) / borrowed,
  };
}
