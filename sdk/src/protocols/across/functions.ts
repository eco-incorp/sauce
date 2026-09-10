export const bridge = `
import { AcrossSpokePoolABI as ISpokePool } from "./abis";

function main(spokePoolAddress: Address, token: Address, amount: Uint256, destinationChainId: Uint256, recipient: Address): Uint256 {
  const spokePool = ISpokePool.at(spokePoolAddress);
  spokePool.deposit(recipient, token, amount, destinationChainId, 0, 0, "", 0);
  return 1;
}
`;
