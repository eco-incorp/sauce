// The handler a Pot answers `queryCallback(bytes32,bytes,bytes)` with: Space and Time's
// CallbackExecutor calling back a fulfilled query, which fulfils the promise the Pot parked under
// the query's id. Compiled for the Pot's chain, where `SpaceAndTime.CallbackExecutor` is that
// chain's executor.
import { queryCallback } from "@sauce/zk";

function main(caller: Address, value: Uint256, data: bytes): void {
  queryCallback(SpaceAndTime.CallbackExecutor, caller, data);
}
