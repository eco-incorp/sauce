// The Pot's `executeAcross(bytes program, bytes32 salt, uint256 deadline, bytes32[] executions,
// uint256 index, bytes signature)`, run as a cook, for anyone: runs this chain's `program` from one
// signature of the Pot's owner over an execution per chain, `executions` the hash of each in the
// order signed and this chain's at `index`.
import { executeAcross } from "@sauce/signed";

function main(caller: Address, value: Uint256, data: bytes): bytes {
  const [program, salt, deadline, executions, index, signature] = abi.decode(
    data.slice(4, data.length),
    ["bytes", "Uint256", "Uint256", "Uint256[]", "Uint256", "bytes"],
  );
  return executeAcross(program, salt, deadline, executions, index, signature);
}
