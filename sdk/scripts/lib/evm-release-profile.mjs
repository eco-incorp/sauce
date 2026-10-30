import { createHash } from "node:crypto";
import {
  encodeAbiParameters,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
} from "viem";

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
const same = (left, right) =>
  typeof left === "string" &&
  typeof right === "string" &&
  left.toLowerCase() === right.toLowerCase();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const codeOf = (contract) => {
  const code =
    typeof contract.bytecode === "string" ? contract.bytecode : contract.bytecode?.object;
  if (!/^0x(?:[0-9a-f]{2})+$/i.test(code ?? ""))
    throw new Error("missing compiled creation bytecode");
  return code;
};

/** Release readiness follows the selected creation identity, never an unused historical field. */
export function releasePinPending(entry) {
  const fields =
    entry?.scheme === "create3"
      ? ["kitchen", "helperInitCodeHash", "potProfileHash", "fixedRouter"]
      : ["engine", "kitchen", "potInitCodeHash"];
  return (
    fields.some((key) =>
      entry?.scheme === "create3" ? entry[key] == null : entry?.[key] === null,
    ) || Object.values(entry?.assets ?? {}).some((digest) => digest === null)
  );
}
/** Validate the compiler-generated layout and template against the compiled Pot runtime suffix. */
export function validateCompiledPotProfile(profile, pot) {
  if (
    profile.scheme !== "create3" ||
    !same(profile.helperInitCodeHash, HELPER_HASH) ||
    !Number.isSafeInteger(profile.runtimeSize) ||
    profile.runtimeSize <= 0 ||
    Object.keys(profile.immutableReferences ?? {})
      .sort()
      .join() !== [...IMMUTABLES].sort().join()
  ) {
    throw new Error("invalid CREATE3 compiled Pot profile");
  }
  const creation = Buffer.from(codeOf(pot).slice(2), "hex");
  if (creation.length < profile.runtimeSize)
    throw new Error("compiled Pot runtime exceeds creation bytes");
  const runtime = Buffer.from(creation.subarray(creation.length - profile.runtimeSize));
  const covered = new Set();
  const fields = IMMUTABLES.map((name) => {
    const references = profile.immutableReferences[name];
    if (!Array.isArray(references) || !references.length)
      throw new Error(`missing compiled immutable layout: ${name}`);
    return [
      name,
      [...references]
        .sort((left, right) => left.start - right.start)
        .map(({ start, length }) => {
          if (
            !Number.isSafeInteger(start) ||
            start < 1 ||
            length !== 32 ||
            start + length > runtime.length ||
            runtime[start - 1] !== 0x7f
          )
            throw new Error(`invalid compiled immutable layout: ${name}`);
          for (let index = start; index < start + length; index++) {
            if (covered.has(index)) throw new Error("overlapping compiled immutable layout");
            covered.add(index);
          }
          runtime.fill(0, start, start + length);
          return [start, length];
        }),
    ];
  });
  if (!same(keccak256(`0x${runtime.toString("hex")}`), profile.runtimeTemplateHash))
    throw new Error("compiled Pot runtime template mismatch");
  const hash = keccak256(
    `0x${Buffer.from(
      JSON.stringify([
        profile.scheme,
        profile.helperInitCodeHash.toLowerCase(),
        profile.runtimeSize,
        profile.runtimeTemplateHash.toLowerCase(),
        fields,
      ]),
    ).toString("hex")}`,
  );
  if (profile.profileHash !== undefined && !same(profile.profileHash, hash))
    throw new Error("compiled Pot profile hash mismatch");
  return hash;
}

/** The normal published path authenticates both component assets against committed release pins. */
export function validateCreate3Release(input) {
  const {
    pin,
    enginePin,
    kitchenManifest,
    engineManifest,
    kitchenAddresses,
    engineAddresses,
    profileBytes,
    engineProfileBytes,
    abisBytes,
    runtimeCreationCode,
  } = input;
  const digest = sha256(profileBytes);
  const engineDigest = sha256(engineProfileBytes);
  if (
    digest !== pin.assets["pot-profile.json"] ||
    engineDigest !== enginePin.assets["pot-profile.json"] ||
    digest !== kitchenManifest.potProfile?.sha256 ||
    engineDigest !== engineManifest.potProfile?.sha256 ||
    kitchenManifest.potProfile?.artifact !== "pot-profile.json" ||
    engineManifest.potProfile?.artifact !== "pot-profile.json"
  )
    throw new Error("CREATE3 Pot profile asset digest mismatch");
  if (
    sha256(abisBytes) !== pin.assets["abis.json"] ||
    sha256(abisBytes) !== kitchenManifest.abis?.sha256
  )
    throw new Error("CREATE3 ABI asset digest mismatch");
  if (
    !same(keccak256(runtimeCreationCode), enginePin.assets["runtime.creation.hex"]) ||
    !same(keccak256(runtimeCreationCode), engineManifest.creationCodeKeccak)
  )
    throw new Error("engine creation asset digest mismatch");
  const contracts = JSON.parse(abisBytes).contracts;
  const profile = JSON.parse(profileBytes);
  const profileHash = validateCompiledPotProfile(profile, contracts.Pot);
  if (
    !same(validateCompiledPotProfile(JSON.parse(engineProfileBytes), contracts.Pot), profileHash)
  ) {
    throw new Error("engine and Kitchen compiled Pot profiles mismatch");
  }
  const gate = engineManifest.gate;
  const pot = kitchenAddresses.pot;
  const kitchen = kitchenAddresses.contracts?.kitchen?.address;
  const router = kitchenAddresses.contracts?.router;
  if (
    pin.scheme !== "create3" ||
    gate?.scheme !== "create3" ||
    pot?.scheme !== "create3" ||
    !same(pin.kitchen, kitchen) ||
    !same(gate.kitchen, kitchen) ||
    !same(pot.deployer, kitchen)
  )
    throw new Error("CREATE3 Kitchen identity mismatch");
  for (const value of [pin.helperInitCodeHash, gate.helperInitCodeHash, pot.helperInitCodeHash]) {
    if (!same(value, HELPER_HASH)) throw new Error("CREATE3 helper mismatch");
  }
  for (const value of [
    pin.potProfileHash,
    gate.potProfileHash,
    pot.potProfileHash,
    kitchenManifest.potProfile.profileHash,
    engineManifest.potProfile.profileHash,
  ]) {
    if (!same(value, profileHash)) throw new Error("CREATE3 profile binding mismatch");
  }
  for (const value of [pin.fixedRouter, gate.fixedRouter, pot.fixedRouter]) {
    if (!same(value, router?.address)) throw new Error("CREATE3 fixed Router mismatch");
  }
  if (
    router?.addressing !== "content" ||
    !same(router.initCodeHash, keccak256(codeOf(contracts.Router)))
  )
    throw new Error("Router creation content mismatch");
  const rawSalt = `0x${kitchenAddresses.deployer?.slice(2).toLowerCase()}0000${router.initCodeHash.slice(2, 22).toLowerCase()}`;
  if (!same(router.rawSalt, rawSalt)) throw new Error("Router creation content salt mismatch");
  const guardedSalt = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [getAddress(kitchenAddresses.deployer), rawSalt],
    ),
  );
  const helper = getCreate2Address({
    from: getAddress(kitchenAddresses.factory),
    salt: guardedSalt,
    bytecodeHash: HELPER_HASH,
  });
  if (
    !same(router.guardedSalt, guardedSalt) ||
    !same(getContractAddress({ from: helper, nonce: 1n }), router.address)
  )
    throw new Error("Router content address mismatch");
  if (!same(engineAddresses.contracts?.engine?.address, enginePin.engine))
    throw new Error("engine release identity mismatch");
  return {
    gate: {
      scheme: "create3",
      kitchen: gate.kitchen,
      fixedRouter: gate.fixedRouter,
      helperInitCodeHash: HELPER_HASH,
      potProfileHash: profileHash,
      profile,
    },
    profile,
    contracts,
    profileHash,
  };
}
