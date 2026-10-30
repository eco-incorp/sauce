/** Independent CREATE3 prediction for current factory tests. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
  type Hex,
} from "viem";

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/artifacts");
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, `${name}.json`), "utf8")) as T;

/** Derive under Kitchen's fixed helper, independent of Pot creation/runtime bytecode. */
export function potFromReleasedBytecode(owner: Hex, salt: Hex = `0x${"00".repeat(32)}`): Hex {
  const candidatePath = process.env.SAUCE_LOCAL_CANDIDATE;
  const candidate = candidatePath
    ? JSON.parse(readFileSync(resolve(candidatePath), "utf8"))
    : undefined;
  const kitchen = candidate
    ? getAddress(candidate.kitchen)
    : read<{ kitchen: Hex }>("V12EngineGate").kitchen;
  const helper = getCreate2Address({
    bytecodeHash: "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f",
    from: kitchen,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [getAddress(owner), salt]),
    ),
  });

  return getContractAddress({ from: helper, nonce: 1n });
}
