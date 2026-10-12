// The Pot's `execute(bytes program, bytes32 salt, uint256 deadline, bytes signature)`, run as a
// cook, for anyone: runs `program` as this Pot when the Pot's owner signed it for this Pot, on this
// chain, before `deadline`, under a salt not used yet. The Kitchen's fee is paid from the Pot's
// balance; a refused call reverts, and pays nothing.
import { execute } from "@sauce/signed";

function main(caller: Address, value: Uint256, data: bytes): bytes {
  const [program, salt, deadline, signature] = abi.decode(data.slice(4, data.length), [
    "bytes",
    "Uint256",
    "Uint256",
    "bytes",
  ]);
  return execute(program, salt, deadline, signature);
}
