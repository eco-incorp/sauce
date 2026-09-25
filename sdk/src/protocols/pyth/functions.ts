export const getPrice = `
import { PythOracleABI as IPythOracle } from "./abis";

function main(oracleAddress: Address, priceId: Uint256): { price: Uint256, conf: Uint256, expo: Uint256, publishTime: Uint256 } {
  const oracle = IPythOracle.at(oracleAddress);
  return oracle.getPrice(priceId);
}
`;
