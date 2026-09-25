export const withdrawFromStream = `
import { LockupLinearABI as ILockupLinear } from "./abis";

function main(lockupLinearAddress: Address, streamId: Uint256, to: Address, amount: Uint256): Uint256 {
  const lockup = ILockupLinear.at(lockupLinearAddress);
  lockup.withdraw(streamId, to, amount);
  return 1;
}
`;

export const cancelStream = `
import { LockupLinearABI as ILockupLinear } from "./abis";

function main(lockupLinearAddress: Address, streamId: Uint256): Uint256 {
  const lockup = ILockupLinear.at(lockupLinearAddress);
  lockup.cancel(streamId);
  return 1;
}
`;
