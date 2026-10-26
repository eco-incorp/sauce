// Compound's own example, ported: `MyContract` of the Compound III developer FAQ supplies to a
// Comet market, withdraws from it (a borrow, once the base token runs out), repays a whole borrow
// and claims COMP, and reads what a developer asks of the market: the supply and borrow APRs, the
// reward APRs, what an account can still borrow, an asset's collateral factors and price, the
// rewards owed and the market's TVL. Here every cook does its `step` (0 does nothing) and returns
// those reads for the Pot, so `sauce simulate` with step 0 is the read-only call.
//
// Ported from compound-developers/compound-3-developer-faq, contracts/MyContract.sol (337 lines, 225 of code):
// https://github.com/compound-developers/compound-3-developer-faq/blob/d43332f99208bbc454929fe5cdef2aecbbccf979/contracts/MyContract.sol
//
// What changes in Sauce: the contract was deployed for one Comet and its views read that Comet;
// `comet` is a `main` input, and the Pot is the account. Its `presentValue` cast a negative
// principal to unsigned before scaling it, which reads a borrower's debt as a vast supply: here the
// principal's sign is taken first, as Comet's own does, and the debt kept apart from the collateral
// until the end, where one is taken from the other as an `Int256`. It divided each amount at its
// price by the price's scale, 1e8, which leaves WETH in 18 decimals beside USDC in 6: each is
// divided by its own token's scale here (`baseScale`, an asset's `scale`), so they sum in USD with
// 8 decimals. Its `getAllAssetInfos` logged every asset's settings for a developer to read; a
// simulation returns what a program reads instead, so it is left out. The Comet and CometRewards
// functions are in Comet.json beside this file, since the registry's ABI declares only the Comet's
// supply and withdraw paths and balances.
//
//   sauce run compound-v3-my-contract.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <step> <comet> <asset> <amount> <rewards> <rewardFeed>
//
//   step: Uint256         0 nothing, 1 supply `amount` of `asset`, 2 withdraw `amount` of `asset`
//                         (of the base token, a borrow past what is supplied), 3 repay the whole
//                         borrow, 4 claim the Pot's rewards
//   comet: Address        the Comet market, `CompoundV3.CUSDCv3` on Ethereum
//   asset: Address        the token supplied or withdrawn, and whose factors and price are read
//   amount: Uint256       how much, in the token's smallest units: 1000000000 is 1,000 USDC
//   rewards: Address      the market's CometRewards contract, which owes and pays COMP: the one
//                         Compound's documentation lists for the chain
//   rewardFeed: Address   the reward token's price feed, as the Comet prices it: on the USDC
//                         market, the `priceFeed` of COMP's `getAssetInfoByAddress`
//
// On Ethereum, the USDC market read with nothing changed:
//
//   sauce simulate compound-v3-my-contract.sauce.ts --chain ethereum --owner <owner> \
//     --args 0 0xc3d688B66703497DAA19211EEdff47f25384cdc3 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
//     0 <rewards> <rewardFeed>
import Comet from "./Comet.json";

const DAYS_PER_YEAR = 365;
const SECONDS_PER_DAY = 60 * 60 * 24;
const SECONDS_PER_YEAR = SECONDS_PER_DAY * DAYS_PER_YEAR;
const MAX_UINT = ~0;

interface Market {
  // What the step supplied, withdrew, repaid or claimed: 0 for step 0.
  moved: Uint256;
  supplyApr: Uint256;
  borrowApr: Uint256;
  rewardAprForSupplyBase: Uint256;
  rewardAprForBorrowBase: Uint256;
  // What the Pot can still borrow, in USD with 8 decimals: negative past its limit.
  borrowable: Int256;
  borrowCollateralFactor: Uint256;
  liquidateCollateralFactor: Uint256;
  price: Uint256;
  rewardsOwed: Uint256;
  tvl: Uint256;
}

function supply(comet: Address, asset: Address, amount: Uint256): Uint256 {
  approve(asset, comet, amount);
  Comet.at(comet).supply(asset, amount);
  return amount;
}

function withdraw(comet: Address, asset: Address, amount: Uint256): Uint256 {
  Comet.at(comet).withdraw(asset, amount);
  return amount;
}

function repayFullBorrow(comet: Address): Uint256 {
  const baseAsset = Comet.at(comet).baseToken();
  const before = Token(baseAsset).balanceOf(pot);
  // Supplying the maximum repays exactly the borrow: the allowance for the rest goes back to zero.
  approve(baseAsset, comet, MAX_UINT);
  Comet.at(comet).supply(baseAsset, MAX_UINT);
  approve(baseAsset, comet, 0);
  return before - Token(baseAsset).balanceOf(pot);
}

function claimCometRewards(comet: Address, rewards: Address): Uint256 {
  const owed = Comet.at(rewards).getRewardOwed(comet, pot);
  Comet.at(rewards).claim(comet, pot, true);
  return owed.owed;
}

function getSupplyApr(comet: Address): Uint256 {
  const utilization = Comet.at(comet).getUtilization();
  return Comet.at(comet).getSupplyRate(utilization) * SECONDS_PER_YEAR * 100;
}

function getBorrowApr(comet: Address): Uint256 {
  const utilization = Comet.at(comet).getUtilization();
  return Comet.at(comet).getBorrowRate(utilization) * SECONDS_PER_YEAR * 100;
}

// The reward a base supplier (`borrow` false) or borrower earns a year, per dollar, scaled by 1e18.
function getRewardApr(comet: Address, rewardTokenPriceFeed: Address, borrow: bool): Uint256 {
  const market = Comet.at(comet);
  const rewardTokenPriceInUsd = market.getPrice(rewardTokenPriceFeed);
  const usdcPriceInUsd = market.getPrice(market.baseTokenPriceFeed());
  const total = borrow ? market.totalBorrow() : market.totalSupply();
  const speed = borrow ? market.baseTrackingBorrowSpeed() : market.baseTrackingSupplySpeed();
  const rewardPerDay = speed * SECONDS_PER_DAY * (market.baseIndexScale() / market.baseScale());
  return ((rewardTokenPriceInUsd * rewardPerDay) / (total * usdcPriceInUsd)) * DAYS_PER_YEAR;
}

function getBorrowableAmount(comet: Address, account: Address): Int256 {
  const market = Comet.at(comet);
  const user = market.userBasic(account);
  const totals = market.totalsBasic();
  const scale = market.baseIndexScale();
  const baseScale = market.baseScale();
  const basePrice = market.getPrice(market.baseTokenPriceFeed());
  // The base principal (an `Int256`) at the present index: a supply grows by the supply index, a
  // borrow by the borrow index. The two are kept apart, unsigned, until the end.
  let supplied = 0;
  let borrowed = 0;
  if (user.principal >= 0) {
    supplied = (Uint256(user.principal) * totals.baseSupplyIndex) / scale;
  } else {
    borrowed = (Uint256(-user.principal) * totals.baseBorrowIndex) / scale;
  }
  // Every amount in USD with 8 decimals, as the Comet prices it: an amount of a token at its price
  // (8 decimals) over that token's own scale.
  let liquidity = (supplied * basePrice) / baseScale;
  for (let i = 0; i < market.numAssets(); i += 1) {
    if (((user.assetsIn >> i) & 1) == 1) {
      const asset = market.getAssetInfo(i);
      const balance = market.userCollateral(account, asset.asset).balance;
      const amount = (balance * market.getPrice(asset.priceFeed)) / asset.scale;
      liquidity += (amount * asset.borrowCollateralFactor) / 10 ** 18;
    }
  }
  const debt = (borrowed * basePrice) / baseScale;
  return Int256(liquidity) - Int256(debt);
}

function getTvl(comet: Address): Uint256 {
  const market = Comet.at(comet);
  const baseScale = 10 ** Comet.at(comet).decimals();
  const basePrice = market.getPrice(market.baseTokenPriceFeed());
  let tvlUsd = (market.totalSupply() * basePrice) / baseScale;
  for (let i = 0; i < market.numAssets(); i += 1) {
    const asset = market.getAssetInfo(i);
    const totals = market.totalsCollateral(asset.asset);
    const scale = 10 ** Comet.at(asset.asset).decimals();
    tvlUsd += (totals.totalSupplyAsset * market.getPrice(asset.priceFeed)) / scale;
  }
  return tvlUsd;
}

function main(
  step: Uint256,
  comet: Address,
  asset: Address,
  amount: Uint256,
  rewards: Address,
  rewardFeed: Address,
): Market {
  require(step <= 4, "step is 0 to 4");
  let moved = 0;
  if (step == 1) {
    moved = supply(comet, asset, amount);
  }
  if (step == 2) {
    moved = withdraw(comet, asset, amount);
  }
  if (step == 3) {
    moved = repayFullBorrow(comet);
  }
  if (step == 4) {
    moved = claimCometRewards(comet, rewards);
  }
  // The base token is no collateral: it has no factors, and the market prices it by its own feed.
  let borrowCollateralFactor = 0;
  let liquidateCollateralFactor = 0;
  let feed = Comet.at(comet).baseTokenPriceFeed();
  if (asset != Comet.at(comet).baseToken()) {
    const info = Comet.at(comet).getAssetInfoByAddress(asset);
    borrowCollateralFactor = info.borrowCollateralFactor;
    liquidateCollateralFactor = info.liquidateCollateralFactor;
    feed = info.priceFeed;
  }
  return {
    moved,
    supplyApr: getSupplyApr(comet),
    borrowApr: getBorrowApr(comet),
    rewardAprForSupplyBase: getRewardApr(comet, rewardFeed, false),
    rewardAprForBorrowBase: getRewardApr(comet, rewardFeed, true),
    borrowable: getBorrowableAmount(comet, pot),
    borrowCollateralFactor,
    liquidateCollateralFactor,
    price: Comet.at(comet).getPrice(feed),
    rewardsOwed: Comet.at(rewards).getRewardOwed(comet, pot).owed,
    tvl: getTvl(comet),
  };
}
