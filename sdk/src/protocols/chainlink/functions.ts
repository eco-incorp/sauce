export const getLatestPrice = `
import { AggregatorV3ABI as IAggregatorV3 } from "./abis";

function main(feedAddress: Address): { roundId: Uint256, answer: Uint256, startedAt: Uint256, updatedAt: Uint256, answeredInRound: Uint256 } {
  const feed = IAggregatorV3.at(feedAddress);
  return feed.latestRoundData();
}
`;
