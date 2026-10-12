// Answers LayerZero's `allowInitializePath((uint32 srcEid, bytes32 sender, uint64 nonce) origin)`,
// read-only: the EndpointV2 asks it before it verifies the first message on a path, and the path
// opens only from this same Pot.
import { Receive } from "@sauce/remote";

function main(caller: Address, value: Uint256, data: bytes): bool {
  return Receive.allowInitializePath(data);
}
