/**
 * DRIFT GUARD for the EVM wire contract (evm/engine viem export).
 *
 * The bug this exists to prevent: the SDK vendors the V12Pot / V12Kitchen ABIs as JSON
 * (src/artifacts/*.json) but hand-writes the viem `parseAbi` mirror in src/evm/engine.ts. If a
 * repin regenerates the JSON with a changed signature (a renamed function, a widened arg, the
 * salt-only deployPot foot-gun) the hand-written mirror would silently drift and consumers would
 * encode calldata against a selector the deployed contract no longer answers to.
 *
 * The exported ABI is the release's COMPLETE ABI, in both directions: every entry it declares —
 * function, event, error, constructor, fallback, receive — appears in the artifact read fresh from
 * src/artifacts/*.json with the same signature, the same outputs and mutability for a function, and
 * the same `indexed` flags for an event; and every entry of the artifact appears in the export. A
 * mirrored entry the release dropped or changed fails here, and so does one the release added that
 * the export lacks (a consumer once had to read the artifact for the Kitchen's `initialize`). It
 * additionally pins the load-bearing shapes: deployPot(address,bytes32) inputs, and that
 * encodeCook / encodeDeployPot emit the matching 4-byte selector.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAbiItem, toFunctionSelector, type Abi, type AbiFunction } from "viem";
import { formatAbiItem } from "viem/utils";
import { v12Pot, v12PotAbi, v12Kitchen, v12KitchenAbi } from "../../src/evm/engine.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = resolve(HERE, "../../src/artifacts");

/** Read the vendored artifact JSON and return its `abi` array (the compiler/forge output shape). */
const loadArtifactAbi = (name: string): Abi =>
  JSON.parse(readFileSync(resolve(ARTIFACTS, `${name}.json`), "utf8")).abi as Abi;

type Item = Abi[number];

const named = (item: Item): item is Extract<Item, { name: string }> => "name" in item;

/** What an entry must agree on with its release counterpart: kind, signature, and for a function
 *  its outputs and mutability, for an event which inputs are indexed. A constructor, fallback or
 *  receive has no name, so its signature is its kind, its inputs and its mutability. */
const shape = (item: Item): unknown => ({
  type: item.type,
  signature: named(item)
    ? formatAbiItem(item as never)
    : `${item.type}(${("inputs" in item ? item.inputs : []).map((i) => i.type).join(",")})`,
  ...(item.type === "function"
    ? { outputs: item.outputs.map((o) => o.type), stateMutability: item.stateMutability }
    : {}),
  ...(item.type === "constructor" || item.type === "fallback" || item.type === "receive"
    ? { stateMutability: item.stateMutability }
    : {}),
  ...(item.type === "event" ? { indexed: item.inputs.map((i) => i.indexed ?? false) } : {}),
});

/** A stable key for a shape, so two ABIs compare as multisets regardless of order. */
const key = (item: Item): string => JSON.stringify(shape(item));

describe("evm/engine ABI drift guard", () => {
  for (const [artifact, exportedAbi] of [
    ["V12Pot", v12PotAbi],
    ["V12Kitchen", v12KitchenAbi],
  ] as const) {
    describe(artifact, () => {
      const released = loadArtifactAbi(artifact).filter(named);

      for (const item of (exportedAbi as Abi).filter(named)) {
        it(`${item.type} ${item.name}: matches the released ${artifact}.json entry`, () => {
          const counterpart = released.filter((r) => r.type === item.type && r.name === item.name);
          // A mirrored entry the release no longer carries is drift too.
          expect(counterpart.map(shape)).toContainEqual(shape(item));
        });
      }

      it(`exports every entry of the released ${artifact}.json, and nothing else`, () => {
        const all = loadArtifactAbi(artifact);
        expect([...(exportedAbi as Abi)].map(key).sort()).toEqual(all.map(key).sort());
      });
    });
  }

  it("v12KitchenAbi carries the Kitchen's administration: initialize, setRouter, setExecutionFee", () => {
    const names = (v12KitchenAbi as Abi).filter(named).map((i) => `${i.type} ${i.name}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "function initialize",
        "function setRouter",
        "function setExecutionFee",
        "function potInitCodeHash",
        "function owner",
      ]),
    );
  });

  // The Router is the Pot's own since kitchen-evm put it in Pot storage: pinned by name so a
  // release that dropped the switch fails here, not in an owner's transaction.
  it("mirrors the Router switch on both contracts", () => {
    const names = (abi: Abi) => abi.filter(named).map((i) => `${i.type} ${i.name}`);
    expect(names(v12PotAbi)).toEqual(
      expect.arrayContaining([
        "function router",
        "function setRouter",
        "event RouterSet",
        "error RouterHasNoCode",
        "error RouterUnset",
        "error NotOwner",
      ]),
    );
    expect(names(v12KitchenAbi)).toEqual(
      expect.arrayContaining([
        "function router",
        "function setRouter",
        "event RouterSet",
        "error RouterHasNoCode",
      ]),
    );
  });
});

/** 4-byte selector prefix of encoded calldata (`0x` + 8 hex chars). */
const selectorOf = (calldata: string): string => calldata.slice(0, 10);

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

  // `cook` names the engine per call since v12 #432 — it was `cook(bytes[] ingredients)`, whose
  // array only ever carried one element. This selector is what the release ABI moving would break.
  it("encodeCook calldata selector equals toFunctionSelector of cook(address,bytes)", () => {
    const calldata = v12Pot.encodeCook("0x1111111111111111111111111111111111111111", "0xdeadbeef");
    expect(selectorOf(calldata)).toBe(toFunctionSelector("cook(address,bytes)"));
  });

  it("encodeDeployPot uses (address,bytes32) — its selector equals deployPot(address,bytes32)", () => {
    const owner = "0x00000000000000000000000000000000000000A1";
    const salt = `0x${"00".repeat(32)}` as const;
    const calldata = v12Kitchen.encodeDeployPot(owner, salt);
    expect(selectorOf(calldata)).toBe(toFunctionSelector("deployPot(address,bytes32)"));
  });
});
