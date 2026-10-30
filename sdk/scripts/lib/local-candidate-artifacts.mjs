import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getAddress, getContractAddress, getCreate2Address, keccak256 } from "viem";
import { readInstalledCompilerProvenance } from "./compiler-provenance.mjs";

const HELPER_HASH = "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f";
const IMMUTABLES = [
  "owner",
  "userSalt",
  "gateSalt",
  "kitchen",
  "fixedRouter",
  "domainSeparator",
  "domainChainId",
];
const bytecode = (value) => {
  const hex = typeof value === "string" ? value : value?.object;
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(hex ?? ""))
    throw new Error("candidate has missing or invalid bytecode");
  return hex;
};
const same = (left, right) =>
  typeof left === "string" &&
  typeof right === "string" &&
  left.toLowerCase() === right.toLowerCase();
const jsonHash = (profile) =>
  keccak256(
    `0x${Buffer.from(
      JSON.stringify([
        profile.scheme,
        profile.helperInitCodeHash.toLowerCase(),
        profile.runtimeSize,
        profile.runtimeTemplateHash.toLowerCase(),
        IMMUTABLES.map((name) => [
          name,
          [...profile.immutableReferences[name]]
            .sort((left, right) => left.start - right.start || left.length - right.length)
            .map(({ start, length }) => [start, length]),
        ]),
      ]),
    ).toString("hex")}`,
  );

/** Explicit local build inputs; these never create or replace a published release row. */
export function loadLocalCandidate(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.schema !== 1 || manifest.source !== "LOCAL")
    throw new Error("expected a schema 1 LOCAL candidate manifest");
  for (const field of ["compiler", "wireProfile", "storageProfile"]) {
    if (typeof manifest[field] !== "string" || !manifest[field])
      throw new Error(`LOCAL candidate missing ${field}`);
  }
  if (
    !manifest.release ||
    !Object.keys(manifest.release).length ||
    Object.values(manifest.release).some((value) => typeof value !== "string" || !value)
  ) {
    throw new Error(
      "LOCAL candidate needs explicit source release provenance, not a published version",
    );
  }
  const compilerProvenance = readInstalledCompilerProvenance();
  if (manifest.compiler !== compilerProvenance.compiler) {
    throw new Error("LOCAL candidate compiler does not match the installed compiler");
  }
  for (const expected of [manifest.compilerWasmSha256, manifest.release.compilerWasmSha256]) {
    if (expected !== undefined && !same(expected, compilerProvenance.wasmSha256)) {
      throw new Error("LOCAL candidate compiler WASM hash mismatch");
    }
  }
  const asset = (name) => {
    const entry = manifest.assets?.[name];
    if (!entry || typeof entry.path !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? ""))
      throw new Error(`LOCAL candidate missing pinned asset ${name}`);
    const bytes = readFileSync(resolve(dirname(path), entry.path));
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
      throw new Error(`LOCAL candidate digest mismatch: ${name}`);
    return bytes;
  };
  const parse = (name) => JSON.parse(asset(name).toString("utf8"));
  const profile = parse("potProfile");
  const pot = parse("pot");
  const kitchen = parse("kitchen");
  const kitchenProxy = parse("kitchenProxy");
  const router = parse("router");
  const runtimeCreationCode = bytecode(asset("runtimeCreationCode").toString("utf8").trim());
  const engineRuntime = bytecode(asset("engineRuntime").toString("utf8").trim());
  const descriptor = parse("engineDescriptor");
  if (profile.scheme !== "create3" || profile.helperInitCodeHash !== HELPER_HASH)
    throw new Error("LOCAL candidate requires the fixed CREATE3 helper profile");
  const runtime = Buffer.from(bytecode(pot.deployedBytecode).slice(2), "hex");
  if (
    profile.runtimeSize !== runtime.length ||
    Object.keys(profile.immutableReferences ?? {})
      .sort()
      .join() !== [...IMMUTABLES].sort().join()
  )
    throw new Error("Pot profile runtime size or immutable fields mismatch");
  const variables = pot.ast?.nodes
    ?.find((node) => node.nodeType === "ContractDefinition" && node.name === "Pot")
    ?.nodes?.filter(
      (node) => node.nodeType === "VariableDeclaration" && node.mutability === "immutable",
    );
  if (variables?.length !== IMMUTABLES.length)
    throw new Error("Pot artifact missing authenticated immutable layout");
  const covered = new Set();
  for (const name of IMMUTABLES) {
    const positions = profile.immutableReferences[name];
    const variable = variables.find((entry) => entry.name === name);
    const compiled = pot.deployedBytecode.immutableReferences?.[variable?.id];
    if (!positions?.length || JSON.stringify(positions) !== JSON.stringify(compiled))
      throw new Error(`Pot profile immutable layout mismatch: ${name}`);
    for (const { start, length } of positions) {
      if (
        !Number.isSafeInteger(start) ||
        start < 1 ||
        length !== 32 ||
        start + length > runtime.length ||
        runtime[start - 1] !== 0x7f
      )
        throw new Error(`invalid immutable profile range: ${name}`);
      for (let index = start; index < start + length; index++) {
        if (covered.has(index)) throw new Error("overlapping immutable profile ranges");
        covered.add(index);
      }
      runtime.fill(0, start, start + length);
    }
  }
  if (!same(keccak256(`0x${runtime.toString("hex")}`), profile.runtimeTemplateHash))
    throw new Error("Pot profile template hash mismatch");
  const engine = getAddress(manifest.engine.address);
  const fixedRouter = getAddress(manifest.router.address);
  const kitchenAddress = getAddress(manifest.kitchen);
  const engineCodeHash = keccak256(engineRuntime);
  const routerCodeHash = keccak256(bytecode(router.deployedBytecode));
  const profileHash = jsonHash(profile);
  const gate = descriptor.gate;
  if (
    !same(engineCodeHash, manifest.engine.codeHash) ||
    !same(engineCodeHash, descriptor.runtimeCodeHash) ||
    !same(keccak256(runtimeCreationCode), descriptor.creationCodeKeccak)
  )
    throw new Error("engine code hash mismatch");
  if (!same(routerCodeHash, manifest.router.codeHash)) throw new Error("Router code hash mismatch");
  if (
    (profile.profileHash !== undefined && !same(profile.profileHash, profileHash)) ||
    gate?.scheme !== "create3" ||
    !same(gate.kitchen, kitchenAddress) ||
    !same(gate.fixedRouter, fixedRouter) ||
    !same(gate.potProfileHash, profileHash)
  ) {
    throw new Error("engine descriptor CREATE3 profile, Kitchen or Router mismatch");
  }
  const deployments = manifest.deployments;
  for (const [name, expected] of Object.entries({
    engine,
    router: fixedRouter,
    kitchen: kitchenAddress,
    kitchenImplementation: deployments?.contracts?.kitchenImplementation?.address,
  })) {
    const reference = deployments?.contracts?.[name];
    if (!same(reference?.address, expected))
      throw new Error(`${name} deployment identity mismatch`);
    const helper = getCreate2Address({
      from: getAddress(deployments.factory),
      salt: reference.guardedSalt,
      bytecodeHash: HELPER_HASH,
    });
    if (!same(getContractAddress({ from: helper, nonce: 1n }), expected))
      throw new Error(`${name} deployment salt derives another address`);
  }
  const normalize = (artifact) => ({ abi: artifact.abi, bytecode: bytecode(artifact.bytecode) });
  const artifacts = {
    V12Pot: normalize(pot),
    V12Kitchen: normalize(kitchen),
    V12KitchenProxy: normalize(kitchenProxy),
    Router: normalize(router),
    ISauceRouter: { abi: router.abi, bytecode: "0x" },
    V12RuntimeBytecode: { runtimeCreationCode },
    V12PotProfile: profile,
    V12EngineGate: {
      scheme: "create3",
      kitchen: kitchenAddress,
      fixedRouter,
      potProfileHash: profileHash,
      profile,
    },
  };
  const binding = {
    source: "LOCAL",
    compiler: manifest.compiler,
    engine,
    engineCodeHash,
    router: fixedRouter,
    routerCodeHash,
    kitchen: kitchenAddress,
    release: {
      ...manifest.release,
      "v12-evm": manifest.release["v12-evm"] ?? manifest.release.runtime,
      "kitchen-evm": manifest.release["kitchen-evm"] ?? manifest.release.kitchen,
      compiler: manifest.compiler,
      router: getAddress(gate.fixedRouter),
      compilerWasmSha256: compilerProvenance.wasmSha256,
    },
    wireProfile: manifest.wireProfile,
    storageProfile: manifest.storageProfile,
    profile,
    profileHash,
  };
  if (
    ["v12-evm", "kitchen-evm"].some(
      (component) => typeof binding.release[component] !== "string" || !binding.release[component],
    )
  ) {
    throw new Error("LOCAL candidate missing runtime or Kitchen release provenance");
  }
  return { artifacts, binding, deployments };
}

/** Validate every input before touching the separate LOCAL artifact directory. */
export function syncLocalCandidate(path, destinations) {
  const candidate = loadLocalCandidate(path);
  for (const destination of destinations) {
    const directory = resolve(destination, "local-candidate");
    mkdirSync(directory, { recursive: true });
    for (const [name, artifact] of Object.entries({
      ...candidate.artifacts,
      V12LocalCandidate: { ...candidate.binding, deployments: candidate.deployments },
    })) {
      writeFileSync(resolve(directory, `${name}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    }
  }
  return candidate;
}
