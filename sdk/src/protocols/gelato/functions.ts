export const createTask = `
import { GelatoAutomateABI as IAutomate } from "./abis";

function main(automateAddress: Address, execAddress: Address, execData: bytes, moduleData: { modules: Uint256[], args: bytes[] }, feeToken: Address): Uint256 {
  const automate = IAutomate.at(automateAddress);
  return automate.createTask(execAddress, execData, moduleData, feeToken);
}
`;

export const cancelTask = `
import { GelatoAutomateABI as IAutomate } from "./abis";

function main(automateAddress: Address, taskId: Uint256): Uint256 {
  const automate = IAutomate.at(automateAddress);
  automate.cancelTask(taskId);
  return 1;
}
`;
