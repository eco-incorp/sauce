// The handler for `onReport(bytes metadata, bytes report)` (0x805f2132), the call Chainlink's
// KeystoneForwarder makes on a Pot to deliver a CRE workflow's report: compiled for the chain the
// Pot is on, so `Chainlink.KeystoneForwarder` is that chain's forwarder, and run by the Pot's Router
// as a cook. `@sauce/oracle`'s `onReport` checks the caller, finds the request the report answers
// and runs its continuation.
import { onReport } from "@sauce/oracle";

function main(caller: Address, value: Uint256, data: bytes): void {
  onReport(Chainlink.KeystoneForwarder, caller, data);
}
