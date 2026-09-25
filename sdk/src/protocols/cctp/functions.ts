export const depositForBurn = `
import { TokenMessengerABI as ITokenMessenger } from "./abis";

function main(
  tokenMessenger: Address,
  amount: Uint256,
  destinationDomain: Uint256,
  mintRecipient: Uint256,
  burnToken: Address,
  destinationCaller: Uint256,
  maxFee: Uint256,
  minFinalityThreshold: Uint256,
): Uint256 {
  const messenger = ITokenMessenger.at(tokenMessenger);
  messenger.depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold);
  return 1;
}
`;
