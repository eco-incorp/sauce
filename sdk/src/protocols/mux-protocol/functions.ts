export const addLiquidity = `
import { OrderBookABI as IOrderBook } from "./abis";

function main(orderBookAddress: Address, assetId: Uint256, rawAmount: Uint256): Uint256 {
  const orderBook = IOrderBook.at(orderBookAddress);
  orderBook.placeLiquidityOrder(assetId, rawAmount, true);
  return 1;
}
`;

export const removeLiquidity = `
import { OrderBookABI as IOrderBook } from "./abis";

function main(orderBookAddress: Address, assetId: Uint256, mlpAmount: Uint256): Uint256 {
  const orderBook = IOrderBook.at(orderBookAddress);
  orderBook.placeLiquidityOrder(assetId, mlpAmount, false);
  return 1;
}
`;
