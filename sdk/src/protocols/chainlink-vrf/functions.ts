export const requestPriceNative = `
import { VRFV2PlusWrapperABI as IVRFV2PlusWrapper } from "./abis";

function main(wrapperAddress: Address, callbackGasLimit: Uint256, numWords: Uint256): Uint256 {
  return IVRFV2PlusWrapper.at(wrapperAddress).calculateRequestPriceNative(callbackGasLimit, numWords);
}
`;

export const minimumRequestConfirmations = `
import { VRFCoordinatorV2_5ABI as IVRFCoordinatorV2_5 } from "./abis";

function main(coordinatorAddress: Address): Uint256 {
  return IVRFCoordinatorV2_5.at(coordinatorAddress).s_config().minimumRequestConfirmations;
}
`;
