export const createFlow = `
import { CFAForwarderABI as ICFAForwarder } from "./abis";

function main(forwarderAddress: Address, token: Address, sender: Address, receiver: Address, flowrate: Uint256): Uint256 {
  const forwarder = ICFAForwarder.at(forwarderAddress);
  forwarder.createFlow(token, sender, receiver, flowrate, "");
  return 1;
}
`;

export const deleteFlow = `
import { CFAForwarderABI as ICFAForwarder } from "./abis";

function main(forwarderAddress: Address, token: Address, sender: Address, receiver: Address): Uint256 {
  const forwarder = ICFAForwarder.at(forwarderAddress);
  forwarder.deleteFlow(token, sender, receiver, "");
  return 1;
}
`;

export const updateFlow = `
import { CFAForwarderABI as ICFAForwarder } from "./abis";

function main(forwarderAddress: Address, token: Address, sender: Address, receiver: Address, flowrate: Uint256): Uint256 {
  const forwarder = ICFAForwarder.at(forwarderAddress);
  forwarder.updateFlow(token, sender, receiver, flowrate, "");
  return 1;
}
`;
