export const bridge = `
import { EverclearSpokeABI as IEverclearSpoke } from "./abis";

function main(spokeAddress: Address, destinations: Uint256[], recipient: Address, inputAsset: Address, outputAsset: Address, amount: Uint256): Uint256 {
  const spoke = IEverclearSpoke.at(spokeAddress);
  return spoke.newIntent(destinations, recipient, inputAsset, outputAsset, amount, 300, 86400, 0x00);
}
`;
