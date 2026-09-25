export const submitAndDeposit = `
import { FrxETHMinterABI as IFrxETHMinter } from "./abis";

function main(minterAddress: Address, recipient: Address): Uint256 {
  const minter = IFrxETHMinter.at(minterAddress);
  return minter.submitAndDeposit(recipient);
}
`;

export const deposit = `
import { SfrxETHABI as ISfrxETH } from "./abis";

function main(sfrxethAddress: Address, assets: Uint256, receiver: Address): Uint256 {
  const sfrxeth = ISfrxETH.at(sfrxethAddress);
  return sfrxeth.deposit(assets, receiver);
}
`;

export const redeem = `
import { SfrxETHABI as ISfrxETH } from "./abis";

function main(sfrxethAddress: Address, shares: Uint256, receiver: Address, owner: Address): Uint256 {
  const sfrxeth = ISfrxETH.at(sfrxethAddress);
  return sfrxeth.redeem(shares, receiver, owner);
}
`;
