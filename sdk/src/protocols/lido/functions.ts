export const submit = `
import { LidoABI as ILido } from "./abis";

function main(lidoAddress: Address): Uint256 {
  const lido = ILido.at(lidoAddress);
  return lido.submit(0x0000000000000000000000000000000000000000);
}
`;

export const wrap = `
import { WstETHABI as IWstETH } from "./abis";

function main(wstethAddress: Address, amount: Uint256): Uint256 {
  const wsteth = IWstETH.at(wstethAddress);
  return wsteth.wrap(amount);
}
`;

export const unwrap = `
import { WstETHABI as IWstETH } from "./abis";

function main(wstethAddress: Address, amount: Uint256): Uint256 {
  const wsteth = IWstETH.at(wstethAddress);
  return wsteth.unwrap(amount);
}
`;
