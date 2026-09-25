export const getThreshold = `
import { SafeABI as ISafe } from "./abis";

function main(safeAddress: Address): Uint256 {
  const safe = ISafe.at(safeAddress);
  return safe.getThreshold();
}
`;
