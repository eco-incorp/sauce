export const deposit = `
import { LiquidityPoolABI as ILiquidityPool } from "./abis";

function main(liquidityPoolAddress: Address): Uint256 {
  const pool = ILiquidityPool.at(liquidityPoolAddress);
  return pool.deposit();
}
`;

export const wrap = `
import { WeETHABI as IWeETH } from "./abis";

function main(weethAddress: Address, amount: Uint256): Uint256 {
  const weeth = IWeETH.at(weethAddress);
  return weeth.wrap(amount);
}
`;

export const unwrap = `
import { WeETHABI as IWeETH } from "./abis";

function main(weethAddress: Address, amount: Uint256): Uint256 {
  const weeth = IWeETH.at(weethAddress);
  return weeth.unwrap(amount);
}
`;
