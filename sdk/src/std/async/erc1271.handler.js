// The Pot's ERC-1271 `isValidSignature(bytes32 hash, bytes signature) returns (bytes4)`, a view (a
// static run with no fee): valid for a hash a program running as the Pot approved
// (`Erc1271.approve`), or for its owner's signature over the hash bound to the Pot (`PotMessage`),
// and 0xffffffff otherwise. One handler for every package that needs the Pot to sign: each declares
// it, `"program": "@sauce/async/erc1271.handler.js"`, and installing several installs it once.
import { isValidSignature } from "@sauce/async";

function main(caller: Address, value: Uint256, data: bytes): Uint256 {
  const [hash, signature] = abi.decode(data.slice(4, data.length), ["Uint256", "bytes"]);
  return isValidSignature(hash, signature);
}
