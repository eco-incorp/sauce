export const stakeSwETH = `
import { SwETHABI as ISwETH } from "./abis";

function main(swethAddress: Address): Uint256 {
  const sweth = ISwETH.at(swethAddress);
  sweth.deposit();
  return 1;
}
`;

export const stakeRswETH = `
import { RswETHABI as IRswETH } from "./abis";

function main(rswethAddress: Address): Uint256 {
  const rsweth = IRswETH.at(rswethAddress);
  rsweth.deposit();
  return 1;
}
`;
