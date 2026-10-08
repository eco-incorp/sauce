// Answers LayerZero's `nextNonce(uint32 srcEid, bytes32 sender)`, read-only: zero, so the executor
// may deliver this Pot's messages in any order.
function main(caller: Address, value: Uint256, data: bytes): Uint256 {
  return 0;
}
