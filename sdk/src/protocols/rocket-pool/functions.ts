export const deposit = `
import { RocketDepositPoolABI as IRocketDepositPool } from "./abis";

function main(depositPoolAddress: Address): Uint256 {
  const pool = IRocketDepositPool.at(depositPoolAddress);
  pool.deposit();
  return 1;
}
`;

export const burn = `
import { RETHABI as IRETH } from "./abis";

function main(rethAddress: Address, amount: Uint256): Uint256 {
  const reth = IRETH.at(rethAddress);
  reth.burn(amount);
  return 1;
}
`;
