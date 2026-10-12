export const getFee = `
import { EntropyABI as IEntropy } from "./abis";

function main(entropyAddress: Address, gasLimit: Uint256): Uint256 {
  const entropy = IEntropy.at(entropyAddress);
  return entropy.getFeeV2(entropy.getDefaultProvider(), gasLimit);
}
`;
