// The Pot's EIP-1271 `isValidSignature(bytes32 hash, bytes signature) returns (bytes4)`, read-only:
// the magic value when the Pot's owner signed `hash` for this Pot (a `PotMessage` under its EIP-712
// domain), and 0xffffffff otherwise. Registered as a view: a contract that checks a signature asks
// it with a static call, which a cook would make it pay for.
import { isValidSignature } from "@sauce/signed";

function main(caller: Address, value: Uint256, data: bytes): Uint256 {
  const [hash, signature] = abi.decode(data.slice(4, data.length), ["Uint256", "bytes"]);
  return isValidSignature(hash, signature);
}
