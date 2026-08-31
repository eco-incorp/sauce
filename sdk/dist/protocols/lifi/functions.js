export const bridge = `
import { LiFiDiamondABI as ILiFiDiamond } from "./abis";

function main(diamondAddress: Address, transactionId: Uint256, sendingAsset: Address, receiver: Address, amount: Uint256, destinationChainId: Uint256): Uint256 {
  const lifi = ILiFiDiamond.at(diamondAddress);
  lifi.startBridgeTokensViaBridge({transactionId: transactionId, bridge: "across", integrator: "sauce", referrer: 0x0000000000000000000000000000000000000000, sendingAssetId: sendingAsset, receiver: receiver, minAmount: amount, destinationChainId: destinationChainId, hasSourceSwaps: false, hasDestinationCall: false});
  return 1;
}
`;
//# sourceMappingURL=functions.js.map