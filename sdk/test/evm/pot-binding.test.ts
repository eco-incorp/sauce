import {
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  getContractAddress,
  hashDomain,
  keccak256,
  zeroAddress,
  type Hex,
  type PublicClient,
} from "viem";
import {
  DEFAULT_POT_SALT,
  POT_CREATE3_HELPER_INIT_CODE_HASH,
  v12PotGateSalt,
  v12PredictPot,
  v12PredictSharedPot,
} from "../../src/deployments/pot.js";
import {
  authenticatePotRuntime,
  potRuntimeProfileHash,
  verifyPotBinding,
  PotBindingMismatchError,
  type EvmPotBindingInput,
  type EvmPotIdentity,
  type EvmPotRuntimeProfile,
} from "../../src/evm/pot-binding.js";
import { v12ReleaseSet } from "../../src/deployments/releases.js";

const owner = "0x0000000000000000000000000000000000000011";
const kitchen = "0x0000000000000000000000000000000000000022";
const router = "0x0000000000000000000000000000000000000033";
const fields = [
  "owner",
  "userSalt",
  "gateSalt",
  "kitchen",
  "fixedRouter",
  "domainSeparator",
  "domainChainId",
] as const;
const word = (type: "address" | "uint256", value: Hex | bigint): Hex =>
  type === "address"
    ? encodeAbiParameters([{ type: "address" }], [value as Hex])
    : encodeAbiParameters([{ type: "uint256" }], [value as bigint]);

describe("CREATE3 Pot derivation", () => {
  test.each([false, true])("uses Kitchen helper namespace, fixed=%s", (fixed) => {
    const salt = keccak256(
      fixed
        ? encodeAbiParameters(
            [{ type: "address" }, { type: "bytes32" }, { type: "bool" }],
            [owner, DEFAULT_POT_SALT, true],
          )
        : encodeAbiParameters(
            [{ type: "address" }, { type: "bytes32" }],
            [owner, DEFAULT_POT_SALT],
          ),
    );
    const helper = getCreate2Address({
      from: kitchen,
      salt,
      bytecodeHash: POT_CREATE3_HELPER_INIT_CODE_HASH,
    });
    expect(v12PredictPot(owner, DEFAULT_POT_SALT, kitchen, fixed)).toBe(
      getContractAddress({ from: helper, nonce: 1n }),
    );
  });

  test("Shared is owner zero in fixed salt namespace", () => {
    expect(v12PredictSharedPot(DEFAULT_POT_SALT, kitchen)).toBe(
      v12PredictPot(zeroAddress, DEFAULT_POT_SALT, kitchen, true),
    );
    expect(v12PredictPot(zeroAddress, DEFAULT_POT_SALT, kitchen, false)).not.toBe(
      v12PredictSharedPot(DEFAULT_POT_SALT, kitchen),
    );
    expect(v12PredictPot(owner, DEFAULT_POT_SALT, kitchen)).not.toBe(
      v12PredictPot(owner, DEFAULT_POT_SALT, kitchen, true),
    );
  });
});

describe("runtime profile authentication", () => {
  const masked = `0x60${"00".repeat(fields.length * 64)}00` as Hex;
  const references = (index: number) => [
    { start: 1 + index * 64, length: 32 },
    { start: 33 + index * 64, length: 32 },
  ];
  const profile: EvmPotRuntimeProfile = {
    scheme: "create3",
    helperInitCodeHash: POT_CREATE3_HELPER_INIT_CODE_HASH,
    runtimeSize: 2 + fields.length * 64,
    runtimeTemplateHash: keccak256(masked),
    immutableReferences: {
      owner: references(0),
      userSalt: references(1),
      gateSalt: references(2),
      kitchen: references(3),
      fixedRouter: references(4),
      domainSeparator: references(5),
      domainChainId: references(6),
    },
  };
  const identity: EvmPotIdentity = {
    pot: v12PredictPot(owner, DEFAULT_POT_SALT, kitchen),
    owner,
    kitchen,
    userSalt: DEFAULT_POT_SALT,
    kind: "private",
    chainId: 1,
    router,
  };
  const values = [
    word("address", owner),
    DEFAULT_POT_SALT,
    v12PotGateSalt(owner, DEFAULT_POT_SALT, false),
    word("address", kitchen),
    word("address", zeroAddress),
    hashDomain({
      domain: { name: "Sauce Pot", version: "1", chainId: 1n, verifyingContract: identity.pot },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    }),
    word("uint256", 1n),
  ];
  const code = `0x60${values.map((value) => value.slice(2).repeat(2)).join("")}00` as Hex;

  test("checks full template plus every immutable copy", () => {
    expect(authenticatePotRuntime(code, profile, identity)).toBe(keccak256(code));
    for (const field of fields) {
      for (const reference of profile.immutableReferences[field]) {
        const changed =
          `${code.slice(0, 2 + reference.start * 2)}${"ff".repeat(32)}${code.slice(2 + (reference.start + 32) * 2)}` as Hex;
        expect(() => authenticatePotRuntime(changed, profile, identity)).toThrow(new RegExp(field));
      }
    }
    const changedInstruction = `0x61${code.slice(4)}` as Hex;
    expect(() => authenticatePotRuntime(changedInstruction, profile, identity)).toThrow(
      /template hash/,
    );
  });

  test("profile identity commits immutable layout and original signature chain", () => {
    expect(potRuntimeProfileHash(profile)).not.toBe(
      potRuntimeProfileHash({
        ...profile,
        immutableReferences: { ...profile.immutableReferences, owner: [{ start: 2, length: 32 }] },
      }),
    );
    expect(() =>
      authenticatePotRuntime(code, profile, { ...identity, originalChainId: "2" }),
    ).toThrow(/domain/);
  });

  test("rejects foreign code even when getters could match", () => {
    expect(() => authenticatePotRuntime("0x6000", profile, identity)).toThrow(/size/);
  });

  test("rejects missing, overlapping and non-word immutable references", () => {
    for (const references of [
      { ...profile.immutableReferences, owner: [] },
      { ...profile.immutableReferences, owner: [{ start: 1, length: 31 }] },
      { ...profile.immutableReferences, owner: profile.immutableReferences.kitchen },
    ]) {
      expect(() =>
        authenticatePotRuntime(masked, { ...profile, immutableReferences: references }, identity),
      ).toThrow();
    }
  });

  test("rejects helper drift and wrong immutable identity", () => {
    expect(() =>
      authenticatePotRuntime(
        masked,
        { ...profile, helperInitCodeHash: DEFAULT_POT_SALT },
        identity,
      ),
    ).toThrow(/helper/);
    expect(() => authenticatePotRuntime(masked, profile, identity)).toThrow(/owner/);
    expect(v12PotGateSalt(owner, DEFAULT_POT_SALT, false)).toBe(
      keccak256(
        encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [owner, DEFAULT_POT_SALT]),
      ),
    );
  });
});

describe("persisted historical binding policy", () => {
  const release = v12ReleaseSet("2.6.0");
  const kitchen = getAddress(release["kitchen-evm"].kitchen!);
  const gateSalt = v12PotGateSalt(owner, DEFAULT_POT_SALT, false);
  const pot = getCreate2Address({
    from: kitchen,
    salt: gateSalt,
    bytecodeHash: release["kitchen-evm"].potInitCodeHash as Hex,
  });
  const code = "0x6000" as const;
  const binding: EvmPotBindingInput = {
    pot,
    kitchen,
    owner,
    userSalt: DEFAULT_POT_SALT,
    kind: "private",
    chainId: 1,
    router,
    compiler: release.compiler,
    engine: getAddress(release["v12-evm"].engine!),
    engineCodeHash: keccak256(code),
    routerCodeHash: keccak256(code),
    wireProfile: "compiler-2.6.0",
    storageProfile: "kitchen-evm-1.3.0",
    release: { compiler: release.compiler, "v12-evm": "1.3.0", "kitchen-evm": "1.3.0" },
  };
  // Unit dependency reads test resolver policy, not actual deployed-runtime compatibility.
  const client: Pick<PublicClient, "getChainId" | "getCode" | "readContract" | "request"> = {
    getChainId: async () => binding.chainId,
    request: async () => {
      throw new Error("Legacy policy fixtures must not run compatibility requests");
    },
    getCode: async () => code,
    readContract: (async ({ functionName }: { functionName: string }) =>
      (
        ({ owner, kitchen, router, userSalt: DEFAULT_POT_SALT, gateSalt }) as Record<string, string>
      )[functionName]) as PublicClient["readContract"],
  };

  test("rejects the wrong RPC chain before reading code", async () => {
    let codeReads = 0;
    await expect(
      verifyPotBinding(
        {
          ...client,
          getChainId: async () => 2,
          getCode: async () => {
            codeReads++;
            throw new Error("Code must not be read on the wrong chain");
          },
        },
        binding,
      ),
    ).rejects.toThrow(PotBindingMismatchError);
    expect(codeReads).toBe(0);
  });

  test("imports explicit deployed legacy provenance and retains its compiler across defaults", async () => {
    const proof = await verifyPotBinding(client, binding);
    expect(proof.compiler).toBe("2.6.0");
    expect(proof.engine).toBe(binding.engine);
    expect(proof.scheme).toBe("create2");
    expect(proof.codeHash).toBe(keccak256(code));
    expect(await verifyPotBinding(client, proof)).toEqual(proof);
  });

  test("returns only declared binding proof fields, not artifact deployment context", async () => {
    const descriptor = { ...binding, source: "LOCAL", deployments: { privateFixture: true } };
    const proof = await verifyPotBinding(client, descriptor);
    expect("source" in proof).toBe(false);
    expect("deployments" in proof).toBe(false);
  });

  test("does not rebind missing expected code or changed code to new CREATE3 defaults", async () => {
    await expect(
      verifyPotBinding({ ...client, getCode: async () => undefined }, binding),
    ).rejects.toThrow(PotBindingMismatchError);
    await expect(
      verifyPotBinding(client, { ...binding, codeHash: DEFAULT_POT_SALT }),
    ).rejects.toThrow(/code hash changed/);
    await expect(
      verifyPotBinding(client, {
        ...binding,
        pot: v12PredictPot(owner, DEFAULT_POT_SALT, kitchen),
      }),
    ).rejects.toThrow(/profile is required/);
  });

  test("refuses mismatched compiler provenance and missing dependencies", async () => {
    await expect(verifyPotBinding(client, { ...binding, compiler: "2.5.0" })).rejects.toThrow(
      /provenance/,
    );
    await expect(
      verifyPotBinding(client, { ...binding, routerCodeHash: DEFAULT_POT_SALT }),
    ).rejects.toThrow(/Router code/);
    await expect(
      verifyPotBinding(
        { ...client, getCode: async ({ address }) => (address === kitchen ? undefined : code) },
        binding,
      ),
    ).rejects.toThrow(/Kitchen has no code/);
  });

  test("leaves transport errors distinct from identity mismatches", async () => {
    const outage = new Error("RPC unavailable");
    await expect(
      verifyPotBinding(
        {
          ...client,
          getCode: async () => {
            throw outage;
          },
        },
        binding,
      ),
    ).rejects.toBe(outage);
  });
});
