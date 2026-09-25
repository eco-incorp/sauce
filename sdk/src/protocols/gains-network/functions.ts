export const closeTradeMarket = `
import { DiamondABI as IDiamond } from "./abis";

function main(diamondAddress: Address, pairIndex: Uint256, index: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.closeTradeMarket(pairIndex, index);
  return 1;
}
`;

export const updateStopLoss = `
import { DiamondABI as IDiamond } from "./abis";

function main(diamondAddress: Address, pairIndex: Uint256, index: Uint256, newSl: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateSl(pairIndex, index, newSl);
  return 1;
}
`;

export const updateTakeProfit = `
import { DiamondABI as IDiamond } from "./abis";

function main(diamondAddress: Address, pairIndex: Uint256, index: Uint256, newTp: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateTp(pairIndex, index, newTp);
  return 1;
}
`;
