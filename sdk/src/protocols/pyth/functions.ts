export const getPrice = `
import { PythOracleABI as IPythOracle } from "./abis";

function main(oracleAddress: Address, priceId: Uint256): { price: Int256, conf: Uint256, expo: Int256, publishTime: Uint256 } {
  const oracle = IPythOracle.at(oracleAddress);
  return oracle.getPrice(priceId);
}
`;
