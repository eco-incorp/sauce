// The handler a Pot answers `handleProof(bytes32,bytes,bytes)` with: Boundless's market calling back
// a fulfilled request, which fulfils the promise the image id and the journal name. Compiled for the
// Pot's chain, where `Boundless.Market` is that chain's market.
import { handleProof } from "@sauce/zk";

function main(caller: Address, value: Uint256, data: bytes): void {
  handleProof(Boundless.Market, caller, data);
}
