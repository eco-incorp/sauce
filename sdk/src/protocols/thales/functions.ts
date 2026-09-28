export const exerciseMarket = `
import { PositionalMarketABI as IPositionalMarket } from "./abis";

function main(market: Address): Uint256 {
  const positionalMarket = IPositionalMarket.at(market);
  positionalMarket.exerciseOptions();
  return 1;
}
`;

export const buyFromAMM = `
import { ThalesAMMABI as IThalesAMM } from "./abis";

function main(thalesAMMAddress: Address, market: Address, position: Uint256, amount: Uint256, expectedPayout: Uint256, slippage: Uint256): Uint256 {
  const amm = IThalesAMM.at(thalesAMMAddress);
  return amm.buyFromAMM(market, position, amount, expectedPayout, slippage);
}
`;
