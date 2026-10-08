/**
 * Portal calls as SauceScript templates.
 *
 * These are the low-level form. They are here because a registered protocol describes what its
 * contract can be asked to do.
 */
export const rewardStatus = `
import { PortalABI as IPortal } from "./abis";

function main(portal: Address, intentHash: Uint256): Uint256 {
  return IPortal.at(portal).getRewardStatus(intentHash);
}
`;

export const fundIntent = `
import { PortalABI as IPortal } from "./abis";

function main(
  portal: Address,
  destination: Uint256,
  routeHash: Uint256,
  deadline: Uint256,
  creator: Address,
  prover: Address,
  token: Address,
  amount: Uint256,
): Uint256 {
  IPortal.at(portal).fund(
    destination,
    routeHash,
    {
      deadline: deadline,
      creator: creator,
      prover: prover,
      nativeAmount: 0n,
      tokens: [{ token: token, amount: amount }],
    },
    false,
  );
  return 1;
}
`;
