export const getPool = `
import { SlipstreamCLFactoryABI as ICLFactory } from "./abis";

function main(factoryAddress: Address, tokenA: Address, tokenB: Address, tickSpacing: Int256): Address {
  const factory = ICLFactory.at(factoryAddress);
  return factory.getPool(tokenA, tokenB, tickSpacing);
}
`;
