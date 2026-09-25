export const approve = `
import { Permit2ABI as IPermit2 } from "./abis";

function main(permit2Address: Address, token: Address, spender: Address, amount: Uint256, expiration: Uint256): Uint256 {
  const permit2 = IPermit2.at(permit2Address);
  permit2.approve(token, spender, amount, expiration);
  return 1;
}
`;

export const transferFrom = `
import { Permit2ABI as IPermit2 } from "./abis";

function main(permit2Address: Address, from: Address, to: Address, amount: Uint256, token: Address): Uint256 {
  const permit2 = IPermit2.at(permit2Address);
  permit2.transferFrom(from, to, amount, token);
  return 1;
}
`;
