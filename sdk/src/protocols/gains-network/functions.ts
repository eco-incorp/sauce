export const closeTradeMarket = `
import { DiamondABI as IDiamond } from "./abis";

function main(diamondAddress: Address, index: Uint256, expectedPrice: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.closeTradeMarket(index, expectedPrice);
  return 1;
}
`;

export const updateStopLoss = `
import { DiamondABI as IDiamond } from "./abis";

function main(diamondAddress: Address, index: Uint256, newSl: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateSl(index, newSl);
  return 1;
}
`;

export const updateTakeProfit = `
import { DiamondABI as IDiamond } from "./abis";

function main(diamondAddress: Address, index: Uint256, newTp: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateTp(index, newTp);
  return 1;
}
`;
