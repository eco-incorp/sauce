// Answers Hyperlane's `handle(uint32 origin, bytes32 sender, bytes message)`, from this chain's
// Mailbox: runs the message when this same Pot sent it.
import { Receive } from "@sauce/remote";

function main(caller: Address, value: Uint256, data: bytes): void {
  Receive.hyperlane(Hyperlane.Mailbox, caller, data);
}
