import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { keccak256, type Hex } from "viem";
import { releasePinPending, validateCreate3Release } from "../scripts/lib/evm-release-profile.mjs";
import { potRuntimeProfileHash } from "../src/evm/pot-binding.js";

const manifestPath = process.env.SAUCE_LOCAL_CANDIDATE_MANIFEST;
const suite = manifestPath ? describe : describe.skip;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("published release readiness", () => {
  it("does not treat a CREATE3 pin's unused historical hash as a pending release", () => {
    expect(
      releasePinPending({
        scheme: "create3",
        kitchen: "known",
        helperInitCodeHash: "known",
        potProfileHash: "known",
        fixedRouter: "known",
        potInitCodeHash: null,
        assets: { "pot-profile.json": "known" },
      }),
    ).toBe(false);
  });

  it("requires every CREATE3 identity field and preserves historical null-pin handling", () => {
    expect(
      releasePinPending({
        scheme: "create3",
        kitchen: "known",
        helperInitCodeHash: "known",
        fixedRouter: "known",
        assets: { "pot-profile.json": "known" },
      }),
    ).toBe(true);
    expect(releasePinPending({ kitchen: "known", potInitCodeHash: null, assets: {} })).toBe(true);
  });
});
// Real compiler/runtime bytes in the publisher's asset shape; no LOCAL sync branch is invoked.
function publishedFixture() {
  const local = JSON.parse(readFileSync(manifestPath!, "utf8"));
  const asset = (name: string): Buffer =>
    readFileSync(resolve(dirname(manifestPath!), local.assets[name].path));
  const profileBytes = asset("potProfile");
  const profile = JSON.parse(profileBytes.toString("utf8"));
  const descriptor = JSON.parse(asset("engineDescriptor").toString("utf8"));
  const pot = JSON.parse(asset("pot").toString("utf8"));
  const router = JSON.parse(asset("router").toString("utf8"));
  const contracts = {
    Pot: { abi: pot.abi, bytecode: pot.bytecode.object },
    Router: { abi: router.abi, bytecode: router.bytecode.object },
  };
  const abisBytes = Buffer.from(JSON.stringify({ contracts }));
  const binding = {
    scheme: "create3",
    helperInitCodeHash: profile.helperInitCodeHash,
    potProfileHash: profile.profileHash,
    fixedRouter: local.router.address,
  };
  const potProfile = {
    artifact: "pot-profile.json",
    sha256: sha256(profileBytes),
    profileHash: profile.profileHash,
  };
  return {
    pin: {
      kitchen: local.kitchen,
      ...binding,
      assets: { "pot-profile.json": sha256(profileBytes), "abis.json": sha256(abisBytes) },
    },
    enginePin: {
      engine: local.engine.address,
      assets: {
        "pot-profile.json": sha256(profileBytes),
        "runtime.creation.hex": descriptor.creationCodeKeccak,
      },
    },
    kitchenManifest: { abis: { sha256: sha256(abisBytes) }, potProfile },
    engineManifest: {
      ...descriptor,
      potProfile,
      gate: { ...descriptor.gate, helperInitCodeHash: profile.helperInitCodeHash },
    },
    kitchenAddresses: {
      contracts: {
        kitchen: { address: local.kitchen },
        router: { ...local.deployments.contracts.router, addressing: "content" },
      },
      factory: local.deployments.factory,
      deployer: `0x${local.deployments.contracts.router.rawSalt.slice(2, 42)}`,
      pot: { ...binding, deployer: local.kitchen },
    },
    engineAddresses: { contracts: { engine: { address: local.engine.address } } },
    profileBytes,
    engineProfileBytes: profileBytes,
    abisBytes,
    runtimeCreationCode: asset("runtimeCreationCode").toString("utf8").trim(),
  };
}

suite("normal published CREATE3 artifact validation", () => {
  it("accepts actual compiler layout and paired release assets without a Pot init-code gate", () => {
    const fixture = publishedFixture();
    const validated = validateCreate3Release(fixture);
    expect(validated.gate.potInitCodeHash).toBeUndefined();
    expect(validated.gate.potProfileHash).toBe(fixture.pin.potProfileHash);
    expect(validated.profile.runtimeSize).toBeGreaterThan(0);
    expect(validated.contracts.Pot.bytecode).toBe(
      JSON.parse(fixture.abisBytes.toString()).contracts.Pot.bytecode,
    );
  });

  it("validates independently published profile digests without requiring identical JSON formatting", () => {
    const fixture = publishedFixture();
    fixture.engineProfileBytes = Buffer.concat([fixture.engineProfileBytes, Buffer.from("\n")]);
    fixture.enginePin.assets["pot-profile.json"] = sha256(fixture.engineProfileBytes);
    fixture.engineManifest.potProfile = {
      ...fixture.engineManifest.potProfile,
      sha256: sha256(fixture.engineProfileBytes),
    };
    expect(validateCreate3Release(fixture).profileHash).toBe(fixture.pin.potProfileHash);
  });

  it.each(["fixedRouter", "kitchen", "potProfileHash"])("rejects mismatched engine %s", (field) => {
    const fixture = publishedFixture();
    fixture.engineManifest.gate[field] = `0x${"01".repeat(field === "potProfileHash" ? 32 : 20)}`;
    expect(() => validateCreate3Release(fixture)).toThrow(/mismatch|profile|Router|Kitchen/i);
  });

  it("rejects profile asset tampering", () => {
    const fixture = publishedFixture();
    fixture.profileBytes = Buffer.concat([fixture.profileBytes, Buffer.from(" ")]);
    expect(() => validateCreate3Release(fixture)).toThrow(/digest/i);
  });

  it("rejects altered immutable layout even when both published descriptors are repinned", () => {
    const fixture = publishedFixture();
    const profile = JSON.parse(fixture.profileBytes.toString());
    profile.immutableReferences.owner[0].start += 1;
    profile.profileHash = potRuntimeProfileHash(profile);
    fixture.profileBytes = Buffer.from(JSON.stringify(profile));
    fixture.engineProfileBytes = fixture.profileBytes;
    const digest = sha256(fixture.profileBytes);
    fixture.pin.assets["pot-profile.json"] = digest;
    fixture.enginePin.assets["pot-profile.json"] = digest;
    fixture.kitchenManifest.potProfile = {
      artifact: "pot-profile.json",
      sha256: digest,
      profileHash: profile.profileHash,
    };
    fixture.engineManifest.potProfile = fixture.kitchenManifest.potProfile;
    fixture.engineManifest.gate.potProfileHash = profile.profileHash;
    fixture.kitchenAddresses.pot.potProfileHash = profile.profileHash;
    fixture.pin.potProfileHash = profile.profileHash;
    expect(() => validateCreate3Release(fixture)).toThrow(/compiled.*layout/i);
  });

  it("rejects compiled Pot drift even when the ABI asset and manifest digests are updated", () => {
    const fixture = publishedFixture();
    const contracts = JSON.parse(fixture.abisBytes.toString()).contracts;
    const creation = contracts.Pot.bytecode as Hex;
    contracts.Pot.bytecode = `${creation.slice(0, -2)}${creation.endsWith("00") ? "01" : "00"}`;
    fixture.abisBytes = Buffer.from(JSON.stringify({ contracts }));
    fixture.pin.assets["abis.json"] = sha256(fixture.abisBytes);
    fixture.kitchenManifest.abis.sha256 = sha256(fixture.abisBytes);
    expect(() => validateCreate3Release(fixture)).toThrow(/compiled|template|layout/i);
  });

  it("rejects a different Router creation binary behind unchanged release addresses", () => {
    const fixture = publishedFixture();
    const contracts = JSON.parse(fixture.abisBytes.toString()).contracts;
    contracts.Router.bytecode += "00";
    fixture.abisBytes = Buffer.from(JSON.stringify({ contracts }));
    fixture.pin.assets["abis.json"] = sha256(fixture.abisBytes);
    fixture.kitchenManifest.abis.sha256 = sha256(fixture.abisBytes);
    expect(() => validateCreate3Release(fixture)).toThrow(/Router.*creation|content/i);
    expect(keccak256(contracts.Router.bytecode)).not.toBe(
      fixture.kitchenAddresses.contracts.router.initCodeHash,
    );
  });
});
