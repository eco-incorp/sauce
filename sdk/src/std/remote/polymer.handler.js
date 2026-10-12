// Answers `deliver(bytes proof)`, from anyone: a Polymer proof of the `RemoteMessage` log this same
// Pot emitted on another chain for this one, checked by this chain's CrossL2ProverV2. Each log runs
// once.
import { Receive } from "@sauce/remote";

function main(caller: Address, value: Uint256, data: bytes): void {
  Receive.polymer(Polymer.CrossL2ProverV2, data);
}
