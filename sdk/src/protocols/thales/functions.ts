export const exerciseMarket = `
import { ThalesAMMABI as IThalesAMM } from "./abis";

function main(thalesAMMAddress: Address, market: Address): Uint256 {
  const amm = IThalesAMM.at(thalesAMMAddress);
  amm.exerciseMaturedMarket(market);
  return 1;
}
`;

export const buyFromAMM = `
import { ThalesAMMABI as IThalesAMM } from "./abis";

function main(thalesAMMAddress: Address, market: Address, position: Uint256, amount: Uint256, expectedPayout: Uint256, slippage: Uint256): Uint256 {
  const amm = IThalesAMM.at(thalesAMMAddress);
  amm.buyFromAMM(market, position, amount, expectedPayout, slippage);
  return 1;
}
`;
