export const getRoutes = `
import { FlashAggregatorABI as IFlashAggregator } from "./abis";

function main(aggregatorAddress: Address): Uint256 {
  const aggregator = IFlashAggregator.at(aggregatorAddress);
  aggregator.getRoutes();
  return 1;
}
`;
