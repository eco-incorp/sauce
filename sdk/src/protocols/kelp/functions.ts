export const depositAsset = `
import { LRTDepositPoolABI as ILRTDepositPool } from "./abis";

function main(depositPoolAddress: Address, asset: Address, depositAmount: Uint256, minRSETHAmountExpected: Uint256): Uint256 {
  const pool = ILRTDepositPool.at(depositPoolAddress);
  pool.depositAsset(asset, depositAmount, minRSETHAmountExpected, "");
  return 1;
}
`;
