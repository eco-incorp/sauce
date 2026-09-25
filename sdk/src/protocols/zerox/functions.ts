export const transformERC20 = `
import { ExchangeProxyABI as IExchangeProxy } from "./abis";

function main(exchangeProxyAddress: Address, inputToken: Address, outputToken: Address, inputTokenAmount: Uint256, minOutputTokenAmount: Uint256): Uint256 {
  const proxy = IExchangeProxy.at(exchangeProxyAddress);
  return proxy.transformERC20(inputToken, outputToken, inputTokenAmount, minOutputTokenAmount, []);
}
`;
