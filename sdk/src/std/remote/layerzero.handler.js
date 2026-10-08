// Answers LayerZero's `lzReceive((uint32 srcEid, bytes32 sender, uint64 nonce) origin, bytes32 guid,
// bytes message, address executor, bytes extraData)`, from this chain's EndpointV2: runs the message
// when this same Pot sent it.
import { Receive } from "@sauce/remote";

function main(caller: Address, value: Uint256, data: bytes): void {
  Receive.layerzero(Layerzero.EndpointV2, caller, data);
}
