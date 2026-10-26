export const depositETH = `
import { BaseL1StandardBridgeABI as IL1StandardBridge } from "./abis";

function main(bridgeAddress: Address, recipient: Address): Uint256 {
  const bridge = IL1StandardBridge.at(bridgeAddress);
  bridge.depositETHTo(recipient, 200000, hex\`\`);
  return 1;
}
`;

export const depositERC20 = `
import { BaseL1StandardBridgeABI as IL1StandardBridge } from "./abis";

function main(bridgeAddress: Address, l1Token: Address, l2Token: Address, recipient: Address, amount: Uint256): Uint256 {
  const bridge = IL1StandardBridge.at(bridgeAddress);
  bridge.depositERC20To(l1Token, l2Token, recipient, amount, 200000, hex\`\`);
  return 1;
}
`;
