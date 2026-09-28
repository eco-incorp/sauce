export const bridge = `
import { EverclearSpokeABI as IEverclearSpoke } from "./abis";

function main(spokeAddress: Address, destinations: Uint256[], recipient: Address, inputAsset: Address, outputAsset: Address, amount: Uint256, amountOutMin: Uint256): Uint256 {
  const spoke = IEverclearSpoke.at(spokeAddress);
  const created = spoke.newIntent(destinations, recipient, inputAsset, outputAsset, amount, amountOutMin, 86400, "");
  return created.intentId;
}
`;
