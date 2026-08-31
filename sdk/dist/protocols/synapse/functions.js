export const bridge = `
import { SynapseBridgeABI as ISynapseBridge } from "./abis";

function main(bridgeAddress: Address, recipient: Address, chainId: Uint256, token: Address, amount: Uint256): Uint256 {
  const bridge = ISynapseBridge.at(bridgeAddress);
  bridge.deposit(recipient, chainId, token, amount);
  return 1;
}
`;
//# sourceMappingURL=functions.js.map