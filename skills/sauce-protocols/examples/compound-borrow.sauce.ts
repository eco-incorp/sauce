// Borrows USDC from Compound III's USDC market against WETH: supplies `collateral` of the Pot's WETH
// to the market as the Pot's collateral, reads the market and what the Pot may borrow, then borrows
// `amount` by withdrawing USDC past what the Pot has supplied, to `to`. What the Pot may borrow is
// each of its collaterals at the market's price, times that asset's borrow collateral factor, less
// what it already owes, in USDC. Refuses an amount above it; the market itself refuses a borrow
// below its minimum. Returns the market's utilization and its supply and borrow APRs (each scaled
// by 1e18: 50000000000000000 is 5%), what the Pot could borrow before borrowing, and what it owes
// after. The market's reads the registry's Comet ABI does not declare are in CometMarket.json beside
// this file, as Compound III's Comet interface declares them.
//
//   sauce run compound-borrow.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <collateral> <amount> <to>
//
//   collateral: Uint256  the Pot's WETH to supply as collateral, in wei (18 decimals):
//                        1000000000000000000 is 1 WETH; 0 supplies nothing
//   amount: Uint256      the USDC to borrow, in its smallest units (6 decimals):
//                        1000000000 is 1,000 USDC
//   to: Address          who receives the USDC: the user's wallet, or the Pot (`pot`) to keep it
//
// On Ethereum, 1,000 USDC borrowed against 1 WETH:
//
//   sauce run compound-borrow.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 1000000000000000000 1000000000 <to>
import CometMarket from "./CometMarket.json";

const SECONDS_PER_YEAR = 31536000;
const FACTOR_SCALE = 1000000000000000000;

function main(
  collateral: Uint256,
  amount: Uint256,
  to: Address,
): {
  utilization: Uint256;
  supplyApr: Uint256;
  borrowApr: Uint256;
  borrowable: Uint256;
  owed: Uint256;
} {
  // 1. The collateral, credited to the Pot. Collateral earns nothing; it only backs a borrow.
  if (collateral > 0) {
    WETH.approve(CompoundV3.CUSDCv3, collateral);
    CompoundV3.CUSDCv3.supply(WETH, collateral);
  }

  // 2. The market: its utilization, and the per-second rates at it, as yearly rates.
  const market = CometMarket.at(CompoundV3.CUSDCv3);
  const utilization = market.getUtilization();
  const supplyApr = market.getSupplyRate(utilization) * SECONDS_PER_YEAR;
  const borrowApr = market.getBorrowRate(utilization) * SECONDS_PER_YEAR;

  // 3. What the Pot may borrow: its collateral valued at the market's prices (USD, 8 decimals),
  //    each asset at its borrow collateral factor, in USDC, less what it owes already.
  let capacity = 0;
  const assets = market.numAssets();
  for (let i = 0; i < assets; i++) {
    const info = market.getAssetInfo(i);
    const held = market.collateralBalanceOf(pot, info.asset);
    if (held > 0) {
      const value = Math.mulDiv(held, market.getPrice(info.priceFeed), info.scale);
      capacity += Math.mulDiv(value, info.borrowCollateralFactor, FACTOR_SCALE);
    }
  }
  const basePrice = market.getPrice(market.baseTokenPriceFeed());
  const inUsdc = Math.mulDiv(capacity, market.baseScale(), basePrice);
  const before = CompoundV3.CUSDCv3.borrowBalanceOf(pot);
  const borrowable = inUsdc > before ? inUsdc - before : 0;
  require(amount <= borrowable, "amount is above what the Pot may borrow");

  // 4. The borrow: withdrawing more USDC than the Pot supplied borrows the rest.
  CompoundV3.CUSDCv3.withdrawTo(to, USDC, amount);

  return {
    utilization,
    supplyApr,
    borrowApr,
    borrowable,
    owed: CompoundV3.CUSDCv3.borrowBalanceOf(pot),
  };
}
