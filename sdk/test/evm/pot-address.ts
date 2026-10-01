/**
 * A Pot's address derived from the released Pot's OWN creation code, for tests that pin one.
 *
 * NOT a `.test.ts`. `v12PredictPot` reads the init-code hash `addresses.json` records; this hashes
 * the `V12Pot.json` creation code the kitchen release ships instead, so a pin derived here checks
 * the SDK's derivation against an independent source rather than restating it. Nothing is
 * hand-typed: a release whose Pot bytecode moves moves every derived Pot, and these follow.
 *
 * The Pot's initcode is its creation code alone since kitchen-evm put the Router in Pot storage;
 * up to 1.0.0 it was the creation code followed by the Router — read off the Pot's constructor, the
 * way v12's own deploy tooling reads it (`release-artifacts.mjs#initCode`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  concat,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  keccak256,
  type Abi,
  type Hex,
} from "viem";

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/artifacts");
const read = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, `${name}.json`), "utf8")) as T;

/** The released Pot's initcode, as the Kitchen deploys it. */
export function releasedPotInitCode(): Hex {
  const pot = read<{ abi: Abi; bytecode: Hex }>("V12Pot");
  const constructor = pot.abi.find((entry) => entry.type === "constructor") as
    { inputs: readonly unknown[] } | undefined;
  if ((constructor?.inputs.length ?? 0) === 0) return pot.bytecode;
  const router = read<{ evm: { contracts: { router: { address: Hex } } } }>("V12Deployments").evm
    .contracts.router.address;

  return concat([pot.bytecode, encodeAbiParameters([{ type: "address" }], [router])]);
}

/** `CREATE2(kitchen, keccak256(abi.encode(owner, salt)), keccak256(released Pot initcode))`. */
export function potFromReleasedBytecode(owner: Hex, salt: Hex = `0x${"00".repeat(32)}`): Hex {
  const kitchen = read<{ kitchen: Hex }>("V12EngineGate").kitchen;

  return getCreate2Address({
    bytecodeHash: keccak256(releasedPotInitCode()),
    from: kitchen,
    salt: keccak256(
      encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [getAddress(owner), salt]),
    ),
  });
}
