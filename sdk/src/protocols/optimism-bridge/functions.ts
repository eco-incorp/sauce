export const depositETH = `
import { OptimismL1StandardBridgeABI as IL1StandardBridge } from "./abis";

function main(bridgeAddress: Address): Uint256 {
  const bridge = IL1StandardBridge.at(bridgeAddress);
  bridge.depositETH(200000, hex\`\`);
  return 1;
}
`;

export const depositERC20 = `
import { OptimismL1StandardBridgeABI as IL1StandardBridge } from "./abis";

function main(bridgeAddress: Address, l1Token: Address, l2Token: Address, amount: Uint256): Uint256 {
  const bridge = IL1StandardBridge.at(bridgeAddress);
  bridge.depositERC20(l1Token, l2Token, amount, 200000, hex\`\`);
  return 1;
}
`;
