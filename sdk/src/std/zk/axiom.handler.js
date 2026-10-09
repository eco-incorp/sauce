// The handler a Pot answers `axiomV2Callback(uint64,address,bytes32,uint256,bytes32[],bytes)` with:
// AxiomV2Query's callback for a fulfilled query, which runs the query's continuation when the query
// is this Pot's. Compiled for the Pot's chain, where `AxiomV2.Query` is that chain's AxiomV2Query.
import { axiomV2Callback } from "@sauce/zk";

function main(caller: Address, value: Uint256, data: bytes): void {
  axiomV2Callback(AxiomV2.Query, caller, data);
}
