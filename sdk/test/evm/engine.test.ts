/**
 * DRIFT GUARD for the EVM wire contract (evm/engine viem export).
 *
 * The bug this exists to prevent: the SDK vendors the V12Pot / V12Kitchen ABIs as JSON
 * (src/artifacts/*.json) but hand-writes the viem `parseAbi` mirror in src/evm/engine.ts. If a
 * repin regenerates the JSON with a changed signature (a renamed function, a widened arg, the
 * salt-only deployPot foot-gun) the hand-written mirror would silently drift and consumers would
 * encode calldata against a selector the deployed contract no longer answers to.
 *
 * For every declared function this recomputes viem `toFunctionSelector` from BOTH sides — the
 * exported parseAbi entry and the corresponding entry read fresh from src/artifacts/*.json — and
 * asserts they agree. A JSON change that isn't mirrored in engine.ts fails here, forcing the two
 * to be updated together. It additionally pins the load-bearing shapes: deployPot(address,bytes32)
 * inputs, and that encodeCook / encodeDeployPot emit the matching 4-byte selector.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAbiItem, toFunctionSelector, type Abi, type AbiFunction } from "viem";
import { v12Pot, v12PotAbi, v12Kitchen, v12KitchenAbi } from "../../src/evm/engine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = resolve(HERE, "../../src/artifacts");

/** Read the vendored artifact JSON and return its `abi` array (the compiler/forge output shape). */
const loadArtifactAbi = (name: string): Abi =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, `${name}.json`), "utf8")).abi as Abi;

/** Every function whose signature the exported viem ABI is contracted to mirror, per artifact. */
const CONTRACTS: { artifact: string; exportedAbi: Abi; fns: string[] }[] = [
  { artifact: "V12Pot", exportedAbi: v12PotAbi, fns: ["cook", "owner", "router", "v12Runtime"] },
  {
    artifact: "V12Kitchen",
    exportedAbi: v12KitchenAbi,
    fns: ["deployPot", "predictPot", "router", "v12Runtime"],
  },
];

/** 4-byte selector prefix of encoded calldata (`0x` + 8 hex chars). */
const selectorOf = (calldata: string): string => calldata.slice(0, 10);

describe("evm/engine ABI drift guard", () => {
  for (const { artifact, exportedAbi, fns } of CONTRACTS) {
    describe(`${artifact}`, () => {
      const jsonAbi = loadArtifactAbi(artifact);

      for (const name of fns) {
        it(`${name}: exported selector matches the vendored ${artifact}.json entry`, () => {
          const exported = getAbiItem({ abi: exportedAbi, name }) as AbiFunction | undefined;
          const fromJson = getAbiItem({ abi: jsonAbi, name }) as AbiFunction | undefined;
          // Both sides must actually declare the function — a dropped entry is drift too.
          expect(exported).toBeDefined();
          expect(fromJson).toBeDefined();
          expect(toFunctionSelector(exported!)).toBe(toFunctionSelector(fromJson!));
        });
      }
    });
  }
});

describe("evm/engine load-bearing shapes", () => {
  it("v12KitchenAbi deployPot inputs are exactly [address, bytes32] (canonical form)", () => {
    const deployPot = getAbiItem({ abi: v12KitchenAbi, name: "deployPot" }) as AbiFunction;
    expect(deployPot.inputs.map((i) => i.type)).toEqual(["address", "bytes32"]);
  });

  it("the vendored V12Kitchen.json deployPot is also (address, bytes32) — no salt-only variant", () => {
    const jsonDeployPot = getAbiItem({
      abi: loadArtifactAbi("V12Kitchen"),
      name: "deployPot",
    }) as AbiFunction;
    expect(jsonDeployPot.inputs.map((i) => i.type)).toEqual(["address", "bytes32"]);
  });

  it("encodeCook calldata selector equals toFunctionSelector of cook(bytes[])", () => {
    const calldata = v12Pot.encodeCook(["0xdeadbeef"]);
    expect(selectorOf(calldata)).toBe(toFunctionSelector("cook(bytes[])"));
  });

  it("encodeDeployPot uses (address,bytes32) — its selector equals deployPot(address,bytes32)", () => {
    const owner = "0x00000000000000000000000000000000000000A1";
    const salt = `0x${"00".repeat(32)}` as const;
    const calldata = v12Kitchen.encodeDeployPot(owner, salt);
    expect(selectorOf(calldata)).toBe(toFunctionSelector("deployPot(address,bytes32)"));
  });
});
