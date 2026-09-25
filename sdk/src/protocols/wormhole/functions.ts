export const bridgeTokens = `
import { WormholeTokenBridgeABI as ITokenBridge } from "./abis";

function main(tokenBridgeAddress: Address, token: Address, amount: Uint256, recipientChain: Uint256, recipient: Uint256): Uint256 {
  const bridge = ITokenBridge.at(tokenBridgeAddress);
  return bridge.transferTokens(token, amount, recipientChain, recipient, 0, 0);
}
`;
