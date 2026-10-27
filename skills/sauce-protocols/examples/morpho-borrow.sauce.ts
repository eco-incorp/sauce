// Borrows from a Morpho Blue market and reads the position back: supplies `collateral` of the
// Pot's collateral token to the market `id` for the Pot, borrows `amount` of its loan token to
// `to`, and returns the position's collateral, its debt (its borrow shares in the loan token, rounded
// up as Morpho rounds a debt), the most it may owe at the market's liquidation LTV, priced by the
// market's own oracle, and its health factor: that most over the debt, 1e18 being 1. Below 1 the
// position can be liquidated. The market's tokens, oracle, interest rate model and LLTV are read
// from Morpho by `id`. Morpho's reads, which the registry's Morpho ABI does not declare, and the
// oracle's price are in MorphoMarket.json beside this file, as Morpho Blue's IMorpho and IOracle
// interfaces declare them.
//
//   sauce run morpho-borrow.sauce.ts --chain <chain> --keystore <keystore> \
//     --args <id> <collateral> <amount> <to>
//
//   id: Uint256          the market's id, a 32-byte hash, as Morpho lists it
//   collateral: Uint256  the Pot's collateral token to supply, in its smallest units:
//                        1000000000000000000 is 1 WETH (18 decimals); 0 supplies nothing
//   amount: Uint256      the loan token to borrow, in its smallest units:
//                        1000000000 is 1,000 USDC (6 decimals)
//   to: Address          who receives the loan: the user's wallet, or the Pot (`pot`) to keep it
//
// On Ethereum, 1,000 USDC borrowed against 1 WETH in the market lending USDC against WETH at an
// 86% LLTV:
//
//   sauce run morpho-borrow.sauce.ts --chain ethereum --keystore <keystore> \
//     --args 0x94b823e6bd8ea533b4e33fbc307faea0b307301bc48763acc4d4aa4def7636cd \
//     1000000000000000000 1000000000 <to>
import MorphoMarket from "./MorphoMarket.json";

const WAD = 1000000000000000000;
const ORACLE_PRICE_SCALE = 10 ** 36;
// Morpho's virtual shares and assets, which it adds to a market's totals in every conversion.
const VIRTUAL_SHARES = 1000000;
const VIRTUAL_ASSETS = 1;

function main(
  id: Uint256,
  collateral: Uint256,
  amount: Uint256,
  to: Address,
): { collateral: Uint256; borrowed: Uint256; maxBorrow: Uint256; healthFactor: Uint256 } {
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

  // 1. The collateral, for the Pot, then the loan to `to`, in the Pot's name.
  if (collateral > 0) {
    Token(market.collateralToken).approve(MorphoBlue.Morpho, collateral);
    MorphoBlue.Morpho.supplyCollateral(market, collateral, pot, hex``);
  }
  MorphoBlue.Morpho.borrow(market, amount, 0, pot, to);

  // 2. The position as Morpho holds it, and its health as Morpho judges it.
  const position = morpho.position(id, pot);
  const totals = morpho.market(id);
  const shares = totals.totalBorrowShares + VIRTUAL_SHARES;
  const borrowed =
    (position.borrowShares * (totals.totalBorrowAssets + VIRTUAL_ASSETS) + shares - 1) / shares;
  const price = MorphoMarket.at(market.oracle).price();
  const maxBorrow = Math.mulDiv(
    Math.mulDiv(position.collateral, price, ORACLE_PRICE_SCALE),
    market.lltv,
    WAD,
  );
  const healthFactor = borrowed == 0 ? ~0 : Math.mulDiv(maxBorrow, WAD, borrowed);

  return { collateral: position.collateral, borrowed, maxBorrow, healthFactor };
}
