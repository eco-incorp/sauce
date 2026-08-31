export const bridge = `
import { CelerBridgeABI as IBridge } from "./abis";

function main(bridgeAddress: Address, receiver: Address, token: Address, amount: Uint256, dstChainId: Uint256, maxSlippage: Uint256): Uint256 {
  const bridge = IBridge.at(bridgeAddress);
  bridge.send(receiver, token, amount, dstChainId, 0, maxSlippage);
  return 1;
}
`;
//# sourceMappingURL=functions.js.map