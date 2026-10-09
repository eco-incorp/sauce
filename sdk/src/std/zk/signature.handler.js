// The read-only handler a Pot answers `isValidSignature(bytes32,bytes)` (ERC-1271) with: yes for a
// Boundless request the Pot submitted itself, which is how a prover's lock may spend the Pot's
// balance at the market, and no for anything else. Run static, with no fee.
import { isValidSignature } from "@sauce/zk";

function main(caller: Address, value: Uint256, data: bytes): bytes {
  return isValidSignature(data);
}
