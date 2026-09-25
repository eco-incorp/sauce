export const deposit = `
import { UniProxyABI as IUniProxy } from "./abis";

function main(uniProxyAddress: Address, deposit0: Uint256, deposit1: Uint256, to: Address, pos: Address): Uint256 {
  const proxy = IUniProxy.at(uniProxyAddress);
  return proxy.deposit(deposit0, deposit1, to, pos, [0, 0, 0, 0]);
}
`;

export const withdraw = `
import { HypervisorABI as IHypervisor } from "./abis";

function main(hypervisorAddress: Address, shares: Uint256, to: Address, from: Address): Uint256 {
  const hv = IHypervisor.at(hypervisorAddress);
  hv.withdraw(shares, to, from, [0, 0, 0, 0]);
  return 1;
}
`;
