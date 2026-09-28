export const supply = `
import { LayerBankCoreABI as ICore } from "./abis";

function main(coreAddress: Address, lTokenAddress: Address, amount: Uint256): Uint256 {
  const core = ICore.at(coreAddress);
  return core.supply(lTokenAddress, amount);
}
`;

export const withdraw = `
import { LayerBankCoreABI as ICore } from "./abis";

function main(coreAddress: Address, lTokenAddress: Address, amount: Uint256): Uint256 {
  const core = ICore.at(coreAddress);
  return core.redeemUnderlying(lTokenAddress, amount);
}
`;

export const borrow = `
import { LayerBankCoreABI as ICore } from "./abis";

function main(coreAddress: Address, lTokenAddress: Address, amount: Uint256): Uint256 {
  const core = ICore.at(coreAddress);
  core.borrow(lTokenAddress, amount);
  return 1;
}
`;

export const repay = `
import { LayerBankCoreABI as ICore } from "./abis";

function main(coreAddress: Address, lTokenAddress: Address, amount: Uint256): Uint256 {
  const core = ICore.at(coreAddress);
  core.repayBorrow(lTokenAddress, amount);
  return 1;
}
`;
