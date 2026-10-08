// Answers Metalayer's `handle(uint32 origin, bytes32 sender, bytes message, ReadOperation[] reads,
// bytes[] results)`, from this chain's MetalayerRouter: runs the message when this same Pot sent it.
import { Receive } from "@sauce/remote";

function main(caller: Address, value: Uint256, data: bytes): void {
  Receive.metalayer(Metalayer.Router, caller, data);
}
