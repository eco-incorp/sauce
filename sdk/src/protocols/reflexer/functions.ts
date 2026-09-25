export const exitRai = `
import { CoinJoinABI as ICoinJoin } from "./abis";

function main(coinJoinAddress: Address, account: Address, amount: Uint256): Uint256 {
  const coinJoin = ICoinJoin.at(coinJoinAddress);
  coinJoin.exit(account, amount);
  return 1;
}
`;

export const joinRai = `
import { CoinJoinABI as ICoinJoin } from "./abis";

function main(coinJoinAddress: Address, account: Address, amount: Uint256): Uint256 {
  const coinJoin = ICoinJoin.at(coinJoinAddress);
  coinJoin.join(account, amount);
  return 1;
}
`;
