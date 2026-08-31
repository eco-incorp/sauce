export const preSignOrder = `
import { GPv2SettlementABI as IGPv2Settlement } from "./abis";

function main(settlementAddress: Address, orderUid: bytes): Uint256 {
  const settlement = IGPv2Settlement.at(settlementAddress);
  settlement.setPreSignature(orderUid, true);
  return 1;
}
`;
export const invalidateOrder = `
import { GPv2SettlementABI as IGPv2Settlement } from "./abis";

function main(settlementAddress: Address, orderUid: bytes): Uint256 {
  const settlement = IGPv2Settlement.at(settlementAddress);
  settlement.invalidateOrder(orderUid);
  return 1;
}
`;
//# sourceMappingURL=functions.js.map