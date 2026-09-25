export const depositIntoStrategy = `
import { StrategyManagerABI as IStrategyManager } from "./abis";

function main(strategyManagerAddress: Address, strategy: Address, token: Address, amount: Uint256): Uint256 {
  const sm = IStrategyManager.at(strategyManagerAddress);
  return sm.depositIntoStrategy(strategy, token, amount);
}
`;
