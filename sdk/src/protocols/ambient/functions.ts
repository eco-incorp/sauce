export const swap = `
import { CrocSwapDexABI as ICrocSwapDex } from "./abis";

function main(dexAddress: Address, base: Address, quote: Address, poolIdx: Uint256, isBuy: bool, inBaseQty: bool, qty: Uint256, minOut: Uint256): { baseFlow: Uint256, quoteFlow: Uint256 } {
  const dex = ICrocSwapDex.at(dexAddress);
  return dex.swap(base, quote, poolIdx, isBuy, inBaseQty, qty, 0, 0, minOut, 0);
}
`;
