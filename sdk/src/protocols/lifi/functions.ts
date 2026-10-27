export const bridge = `
import { LiFiDiamondABI as ILiFiDiamond } from "./abis";

function main(diamondAddress: Address, transactionId: Uint256, sendingAsset: Address, receivingAsset: Address, receiver: Address, amount: Uint256, outputAmount: Uint256, destinationChainId: Uint256, quoteTimestamp: Uint256, fillDeadline: Uint256): Uint256 {
  const lifi = ILiFiDiamond.at(diamondAddress);
  lifi.startBridgeTokensViaAcrossV4(
    {transactionId: transactionId, bridge: "acrossV4", integrator: "sauce", referrer: 0x0000000000000000000000000000000000000000, sendingAssetId: sendingAsset, receiver: receiver, minAmount: amount, destinationChainId: destinationChainId, hasSourceSwaps: false, hasDestinationCall: false},
    {receiverAddress: receiver, refundAddress: ctx.self(), sendingAssetId: sendingAsset, receivingAssetId: receivingAsset, outputAmount: outputAmount, outputAmountMultiplier: 0, exclusiveRelayer: 0, quoteTimestamp: quoteTimestamp, fillDeadline: fillDeadline, exclusivityParameter: 0, message: ""}
  );
  return 1;
}
`;
