export const stakeUSDe = `
import { StakedUSDeABI as IStakedUSDe } from "./abis";

function main(susdeAddress: Address, amount: Uint256, receiver: Address): Uint256 {
  const susde = IStakedUSDe.at(susdeAddress);
  return susde.deposit(amount, receiver);
}
`;

export const cooldownAssets = `
import { StakedUSDeABI as IStakedUSDe } from "./abis";

function main(susdeAddress: Address, assets: Uint256): Uint256 {
  const susde = IStakedUSDe.at(susdeAddress);
  return susde.cooldownAssets(assets);
}
`;

export const unstake = `
import { StakedUSDeABI as IStakedUSDe } from "./abis";

function main(susdeAddress: Address, receiver: Address): Uint256 {
  const susde = IStakedUSDe.at(susdeAddress);
  susde.unstake(receiver);
  return 1;
}
`;
