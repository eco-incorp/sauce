export const bridge = `
import { AcrossSpokePoolABI as ISpokePool } from "./abis";

function main(spokePoolAddress: Address, token: Address, outputToken: Address, amount: Uint256, outputAmount: Uint256, destinationChainId: Uint256, recipient: Address, quoteTimestamp: Uint256, fillDeadline: Uint256): Uint256 {
  const spokePool = ISpokePool.at(spokePoolAddress);
  spokePool.depositV3(ctx.self(), recipient, token, outputToken, amount, outputAmount, destinationChainId, 0x0000000000000000000000000000000000000000, quoteTimestamp, fillDeadline, 0, "");
  return 1;
}
`;
