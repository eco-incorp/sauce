export const swap = `
import { DODOV2ProxyABI as IDODOProxy } from "./abis";

function main(proxyAddress: Address, fromToken: Address, toToken: Address, fromAmount: Uint256, minReturn: Uint256, dodoPairs: Address[], direction: Uint256): Uint256 {
  const proxy = IDODOProxy.at(proxyAddress);
  return proxy.dodoSwapV2TokenToToken(fromToken, toToken, fromAmount, minReturn, dodoPairs, direction, false, 99999999999);
}
`;
