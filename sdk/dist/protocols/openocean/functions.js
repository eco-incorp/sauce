export const swap = `
import { OpenOceanExchangeV2ABI as IOpenOceanExchange } from "./abis";

function main(exchangeAddress: Address, caller: Address, srcToken: Address, dstToken: Address, srcReceiver: Address, dstReceiver: Address, amount: Uint256, minReturnAmount: Uint256, guaranteedAmount: Uint256, referrer: Address, calls: bytes): Uint256 {
  const exchange = IOpenOceanExchange.at(exchangeAddress);
  return exchange.swap(caller, {srcToken: srcToken, dstToken: dstToken, srcReceiver: srcReceiver, dstReceiver: dstReceiver, amount: amount, minReturnAmount: minReturnAmount, guaranteedAmount: guaranteedAmount, flags: 0, referrer: referrer, permit: 0x00}, calls);
}
`;
//# sourceMappingURL=functions.js.map