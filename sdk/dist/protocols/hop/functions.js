export const bridgeFromL1 = `
import { HopL1BridgeABI as IL1Bridge } from "./abis";

function main(bridgeAddress: Address, chainId: Uint256, recipient: Address, amount: Uint256, amountOutMin: Uint256): Uint256 {
  const bridge = IL1Bridge.at(bridgeAddress);
  bridge.sendToL2(chainId, recipient, amount, amountOutMin, 99999999999, 0x0000000000000000000000000000000000000000, 0);
  return 1;
}
`;
//# sourceMappingURL=functions.js.map