/**
 * The pinned release addresses, assembled by `sync-engine-artifacts` from each release's
 * `addresses.json` (`artifacts/V12Deployments.json`) and read back through the `./deployments`
 * accessors.
 *
 * The load-bearing assertions cross-check the assembled set against sources that are pinned
 * INDEPENDENTLY of addresses.json — the engine's own gate anchors (`V12EngineGate.json`: the Kitchen,
 * Router and Pot initCodeHash a released engine gates every cook to) and the packaged Kitchen IDL's
 * declared program id. addresses.json carries no manifest digest, so this agreement IS its integrity
 * check: a repin that moved an address without moving the gate (or vice versa) fails here.
 *
 * Skips when the artifact is absent — a credential-less checkout where the sync could not fetch the
 * private addresses.json — the same gate the engine-binary suites use.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  v12DeployedAddresses,
  v12DeployedVersion,
  v12EngineAddress,
  v12KitchenAddress,
  v12KitchenImplementationAddress,
  v12PotDerivation,
  v12ReleaseSet,
  v12RouterAddress,
  v12SvmEngineProgramId,
  v12SvmKitchenProgramId,
} from "../src/deployments/index.js";

const ARTIFACTS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "artifacts");
const GATE = resolve(ARTIFACTS, "V12EngineGate.json");
const KITCHEN_IDL = resolve(ARTIFACTS, "svm", "kitchen-idl.json");

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH_32 = /^0x[0-9a-fA-F]{64}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const describeAddresses = existsSync(resolve(ARTIFACTS, "V12Deployments.json"))
  ? describe
  : describe.skip;

describeAddresses("v12 deployed addresses", () => {
  it("assembles every address a consumer needs, well-formed", () => {
    expect(v12DeployedVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    for (const address of [
      v12EngineAddress(),
      v12RouterAddress(),
      v12KitchenAddress(),
      v12KitchenImplementationAddress(),
    ]) {
      expect(address).toMatch(EVM_ADDRESS);
    }
    expect(v12PotDerivation().initCodeHash).toMatch(HASH_32);
    expect(v12SvmEngineProgramId()).toMatch(BASE58);
    expect(v12SvmKitchenProgramId()).toMatch(BASE58);
    // The four EVM contracts are distinct addresses, not one repeated by an assembly bug.
    const evm = [
      v12EngineAddress(),
      v12RouterAddress(),
      v12KitchenAddress(),
      v12KitchenImplementationAddress(),
    ];
    expect(new Set(evm).size).toBe(evm.length);
  });

  it("agrees with the engine gate anchors — Kitchen and Pot initCodeHash", () => {
    // V12EngineGate.json is the engine manifest's gate, re-verified by the harness against the live
    // potInitCodeHash(); if these disagree, the addresses name a different stack than the engine
    // actually gates to. The Router is not an anchor: no Pot hash derives from it.
    const gate = JSON.parse(readFileSync(GATE, "utf8")) as Record<string, string>;
    expect(Object.keys(gate).sort()).toEqual(["kitchen", "potInitCodeHash"]);
    expect(v12KitchenAddress()).toBe(gate.kitchen);
    expect(v12PotDerivation().initCodeHash).toBe(gate.potInitCodeHash);
    // A Pot is deployed BY the Kitchen it is gated to.
    expect(v12PotDerivation().deployer).toBe(gate.kitchen);
  });

  it("the SVM kitchen program id matches the packaged kitchen IDL", () => {
    if (!existsSync(KITCHEN_IDL)) return; // IDL ships only after --fetch-v12-engines
    const idl = JSON.parse(readFileSync(KITCHEN_IDL, "utf8")) as { address: string };
    expect(v12SvmKitchenProgramId()).toBe(idl.address);
  });

  it("preserves independent engine and Kitchen provenance, from the pinned release set", () => {
    const releases = v12DeployedAddresses().releases;
    const set = v12ReleaseSet();
    for (const component of ["v12-evm", "kitchen-evm", "v12-svm", "kitchen-svm"] as const) {
      expect(releases[component]).toEqual({
        version: set[component].version,
        commit: expect.stringMatching(/^[0-9a-f]{40}$/),
      });
    }
    expect(v12DeployedVersion()).toBe(releases["kitchen-evm"].version);
    expect(v12DeployedAddresses().commit).toBe(releases["kitchen-evm"].commit);
    expect(v12EngineAddress()).toBe(set["v12-evm"].engine);
    expect(v12SvmEngineProgramId()).toBe(set["v12-svm"].engine);
  });

  it("records the execution Router's content-addressed provenance", () => {
    const router = v12DeployedAddresses().evm.contracts.router;
    expect(router.addressing).toBe("content");
    expect(router.initCodeHash).toMatch(HASH_32);
    expect(router.saltName).toBeUndefined();
    expect(router.generation).toBeUndefined();
    expect(v12DeployedAddresses().evm.contracts.quoteRouter.generation).toBe(3);
  });

  it("carries the release provenance (version + commit)", () => {
    const all = v12DeployedAddresses();
    expect(all.version).toBe(v12DeployedVersion());
    expect(all.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(all.evm.chainIndependent).toBe(true);
    expect(all.svm.clusterIndependent).toBe(true);
  });
});
