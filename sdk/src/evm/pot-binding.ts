import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  RpcRequestError,
  bytesToHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  hashDomain,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  size,
  slice,
  stringToBytes,
  stringToHex,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  POT_CREATE3_HELPER_INIT_CODE_HASH,
  v12PotGateSalt,
  v12PredictPot,
} from "../deployments/pot.js";
import { sdkCompilerVersion, V12_RELEASE_SETS } from "../deployments/releases.js";
import {
  COMPILER_COMPATIBILITY_PROBES,
  COMPILER_PROVENANCE,
} from "../embedded/compiler.generated.js";

export class PotBindingMismatchError extends Error {
  override readonly name = "PotBindingMismatchError";
}

export type EvmPotKind = "private" | "private-fixed-router" | "shared";
const immutableNames = [
  "owner",
  "userSalt",
  "gateSalt",
  "kitchen",
  "fixedRouter",
  "domainSeparator",
  "domainChainId",
] as const;
type ImmutableName = (typeof immutableNames)[number];

/** Public contract authentication metadata, supplied by an authenticated release artifact. */
export interface EvmPotRuntimeProfile {
  readonly scheme: "create3";
  readonly helperInitCodeHash: Hex;
  readonly runtimeSize: number;
  readonly runtimeTemplateHash: Hex;
  readonly immutableReferences: Readonly<
    Record<ImmutableName, readonly { readonly start: number; readonly length: number }[]>
  >;
}

export interface EvmPotIdentity {
  readonly pot: Address;
  readonly kitchen: Address;
  readonly owner: Address;
  readonly userSalt: Hex;
  readonly kind: EvmPotKind;
  readonly chainId: number;
  readonly router: Address;
  /** Trusted construction-chain pin; runtime validation proves domain consistency, not historical origin. */
  readonly originalChainId?: string;
}

/** Explicit release selection; never inferred from an SDK's changing defaults. */
export interface EvmPotBindingInput extends EvmPotIdentity {
  readonly compiler: string;
  readonly engine: Address;
  readonly engineCodeHash: Hex;
  readonly release: Readonly<Record<string, string>>;
  readonly wireProfile: string;
  readonly storageProfile: string;
  readonly routerCodeHash: Hex;
  readonly codeHash?: Hex;
  readonly profile?: EvmPotRuntimeProfile;
  readonly scheme?: "create2" | "create3";
  readonly routerPolicy?: "owner-controlled" | "fixed";
  readonly profileHash?: Hex;
  /** Retain the exact compiler's known-answer program across later SDK compiler updates. */
  readonly compatibilityProbe?: {
    readonly compiler: string;
    readonly compilerWasmSha256: string;
    readonly program: Hex;
  };
}

export interface EvmPotBinding extends EvmPotBindingInput {
  readonly codeHash: Hex;
  readonly scheme: "create2" | "create3";
  readonly routerPolicy: "owner-controlled" | "fixed";
  readonly profileHash?: Hex;
  readonly originalChainId: string;
}

const getters = parseAbi([
  "function owner() view returns (address)",
  "function userSalt() view returns (bytes32)",
  "function gateSalt() view returns (bytes32)",
  "function kitchen() view returns (address)",
  "function router() view returns (address)",
]);
const probeAbi = parseAbi([
  "function cook(address engine, bytes program) payable returns (bytes)",
  "function executionFee() view returns (uint256)",
]);
let compiledProbe: Promise<Hex> | undefined;
const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();
const word = (type: "address" | "uint256", value: Address | bigint): Hex =>
  type === "address"
    ? encodeAbiParameters([{ type: "address" }], [value as Address])
    : encodeAbiParameters([{ type: "uint256" }], [value as bigint]);

function fixed(identity: EvmPotIdentity): boolean {
  if ((identity.kind === "shared") !== (getAddress(identity.owner) === zeroAddress)) {
    throw new PotBindingMismatchError("Pot owner does not match its salt kind");
  }
  if (!["private", "private-fixed-router", "shared"].includes(identity.kind)) {
    throw new PotBindingMismatchError("Unknown Pot salt kind");
  }

  return identity.kind !== "private";
}

/** Hash every runtime byte except the declared words; validate every copy of every excluded word. */
export function authenticatePotRuntime(
  code: Hex,
  profile: EvmPotRuntimeProfile,
  identity: EvmPotIdentity,
): Hex {
  if (
    profile.scheme !== "create3" ||
    !same(profile.helperInitCodeHash, POT_CREATE3_HELPER_INIT_CODE_HASH)
  ) {
    throw new PotBindingMismatchError("Unknown Pot CREATE3 helper profile");
  }
  if (
    profile.immutableReferences === null ||
    typeof profile.immutableReferences !== "object" ||
    Object.keys(profile.immutableReferences).length !== immutableNames.length
  ) {
    throw new PotBindingMismatchError("Unknown Pot immutable reference layout");
  }
  if (
    !Number.isSafeInteger(profile.runtimeSize) ||
    profile.runtimeSize <= 0 ||
    size(code) !== profile.runtimeSize
  ) {
    throw new PotBindingMismatchError("Pot runtime size does not match the release profile");
  }
  const routerFixed = fixed(identity);
  if (
    !same(
      v12PredictPot(identity.owner, identity.userSalt, identity.kitchen, routerFixed),
      identity.pot,
    )
  ) {
    throw new PotBindingMismatchError("Pot CREATE3 address does not match its identity");
  }
  if (identity.originalChainId !== undefined && !/^[1-9][0-9]*$/.test(identity.originalChainId)) {
    throw new PotBindingMismatchError("Invalid original chain id");
  }
  const originalChainId = BigInt(identity.originalChainId ?? identity.chainId);
  if (originalChainId <= 0n || originalChainId >= 1n << 256n)
    throw new PotBindingMismatchError("Invalid original chain id");
  const values: Record<ImmutableName, Hex> = {
    owner: word("address", identity.owner),
    userSalt: identity.userSalt,
    gateSalt: v12PotGateSalt(identity.owner, identity.userSalt, routerFixed),
    kitchen: word("address", identity.kitchen),
    fixedRouter: word("address", routerFixed ? identity.router : zeroAddress),
    domainChainId: word("uint256", originalChainId),
    domainSeparator: hashDomain({
      domain: {
        name: "Sauce Pot",
        version: "1",
        chainId: originalChainId,
        verifyingContract: identity.pot,
      },
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    }),
  };
  const ranges = immutableNames
    .flatMap((name) => {
      const references = profile.immutableReferences[name];
      if (!Array.isArray(references) || references.length === 0)
        throw new PotBindingMismatchError(`Missing ${name} immutable references`);

      return references.map((reference) => ({
        start: reference.start,
        length: reference.length,
        name,
      }));
    })
    .sort((left, right) => left.start - right.start);
  let previousEnd = 0;
  for (const reference of ranges) {
    if (
      !Number.isSafeInteger(reference.start) ||
      reference.start < previousEnd ||
      reference.length !== 32 ||
      reference.start + 32 > size(code)
    ) {
      throw new PotBindingMismatchError("Malformed or overlapping Pot immutable references");
    }
    previousEnd = reference.start + 32;
  }
  let masked = code.slice(2);
  for (const reference of ranges) {
    if (!same(slice(code, reference.start, reference.start + 32), values[reference.name])) {
      throw new PotBindingMismatchError(
        `Pot ${reference.name} immutable does not match the release binding`,
      );
    }
    masked =
      masked.slice(0, reference.start * 2) +
      "00".repeat(32) +
      masked.slice((reference.start + 32) * 2);
  }
  if (!same(keccak256(`0x${masked}`), profile.runtimeTemplateHash)) {
    throw new PotBindingMismatchError(
      "Pot runtime template hash does not match the release profile",
    );
  }

  return keccak256(code);
}

/** Authenticate an already-deployed Pot before persisting, funding, allowing, or signing work. */
export async function verifyPotBinding(
  client: {
    getChainId: () => Promise<number>;
    getCode: (request: { address: Address }) => Promise<Hex | undefined>;
    readContract: (request: {
      address: Address;
      abi: typeof getters;
      functionName: (typeof getters)[number]["name"];
    }) => Promise<Hex>;
    request: (request: {
      method: "eth_call";
      params: [
        { from: Address; to: Address; data: Hex; value?: Hex },
        "latest",
        Record<Address, { balance: Hex }>,
      ];
    }) => Promise<Hex>;
  },
  input: EvmPotBindingInput,
): Promise<EvmPotBinding> {
  if (
    ![input.pot, input.owner, input.kitchen, input.engine, input.router].every((address) =>
      isAddress(address, { strict: false }),
    ) ||
    ![
      input.userSalt,
      input.engineCodeHash,
      input.routerCodeHash,
      ...(input.codeHash === undefined ? [] : [input.codeHash]),
    ].every((hash) => /^0x[0-9a-fA-F]{64}$/.test(hash))
  ) {
    throw new PotBindingMismatchError("Invalid Pot address or bytes32 code identity");
  }
  const routerFixed = fixed(input);
  if (
    !Number.isSafeInteger(input.chainId) ||
    input.chainId <= 0 ||
    !input.compiler ||
    !input.wireProfile ||
    !input.storageProfile
  ) {
    throw new PotBindingMismatchError("Incomplete Pot compiler, chain, wire or storage binding");
  }
  if (
    input.release === null ||
    typeof input.release !== "object" ||
    !input.release["v12-evm"] ||
    !input.release["kitchen-evm"] ||
    Object.values(input.release).some((value) => typeof value !== "string" || value === "") ||
    (input.release.compiler !== undefined && input.release.compiler !== input.compiler)
  ) {
    throw new PotBindingMismatchError(
      "Incomplete or mismatched explicit release/compiler provenance",
    );
  }
  const trustedProbe =
    input.profile !== undefined && Object.hasOwn(COMPILER_COMPATIBILITY_PROBES, input.compiler)
      ? COMPILER_COMPATIBILITY_PROBES[input.compiler]
      : undefined;
  if (input.profile !== undefined) {
    if (trustedProbe === undefined) {
      throw new PotBindingMismatchError("Unknown trusted compiler compatibility probe descriptor");
    }
    const supplied = input.compatibilityProbe;
    if (
      supplied !== undefined &&
      (supplied === null ||
        typeof supplied !== "object" ||
        supplied.compiler !== input.compiler ||
        supplied.compilerWasmSha256 !== trustedProbe.compilerWasmSha256 ||
        typeof supplied.program !== "string" ||
        !same(supplied.program, trustedProbe.program))
    ) {
      throw new PotBindingMismatchError(
        "CREATE3 compatibility probe differs from trusted compiler/WASM/program provenance",
      );
    }
  }
  const chainId = await client.getChainId();
  if (chainId !== input.chainId) {
    throw new PotBindingMismatchError(
      `Pot RPC chain ${chainId} does not match binding chain ${input.chainId}`,
    );
  }
  const [code, engineCode, routerCode, kitchenCode] = await Promise.all([
    client.getCode({ address: input.pot }),
    client.getCode({ address: input.engine }),
    client.getCode({ address: input.router }),
    client.getCode({ address: input.kitchen }),
  ]);
  if (code === undefined || code === "0x")
    throw new PotBindingMismatchError(`${input.pot} has no code: expected an already-deployed Pot`);
  if (
    engineCode === undefined ||
    engineCode === "0x" ||
    !same(keccak256(engineCode), input.engineCodeHash)
  ) {
    throw new PotBindingMismatchError("Pot engine code does not match the pinned release");
  }
  if (
    routerCode === undefined ||
    routerCode === "0x" ||
    !same(keccak256(routerCode), input.routerCodeHash)
  ) {
    throw new PotBindingMismatchError("Pot Router code does not match the pinned release");
  }
  if (kitchenCode === undefined || kitchenCode === "0x") {
    throw new PotBindingMismatchError("Pot Kitchen has no code");
  }
  const codeHash = keccak256(code);
  if (input.codeHash !== undefined && !same(codeHash, input.codeHash))
    throw new PotBindingMismatchError("Pot code hash changed from its persisted binding");
  const gateSalt = v12PotGateSalt(input.owner, input.userSalt, routerFixed);
  if (input.profile !== undefined) {
    if (input.release.compiler !== input.compiler) {
      throw new PotBindingMismatchError(
        "CREATE3 release descriptor must bind the explicit compiler",
      );
    }
    if (
      !isAddress(input.release.router ?? "", { strict: false }) ||
      (routerFixed && !same(input.router, input.release.router!))
    ) {
      throw new PotBindingMismatchError(
        "CREATE3 fixed Router does not match the authenticated engine release Router",
      );
    }
    authenticatePotRuntime(code, input.profile, input);
  } else {
    const set = V12_RELEASE_SETS.find((release) => release.compiler === input.compiler);
    if (set === undefined)
      throw new PotBindingMismatchError("Unknown historical Pot compiler provenance");
    const pin = set["kitchen-evm"];
    if (
      pin.scheme === "create3" ||
      pin.kitchen == null ||
      typeof pin.potInitCodeHash !== "string" ||
      !same(pin.kitchen, input.kitchen) ||
      set["v12-evm"].engine === null ||
      !same(set["v12-evm"].engine!, input.engine) ||
      input.release["v12-evm"] !== set["v12-evm"].version ||
      input.release["kitchen-evm"] !== pin.version ||
      (input.release.compiler !== undefined && input.release.compiler !== input.compiler)
    ) {
      throw new PotBindingMismatchError("Unknown historical Pot release/compiler provenance");
    }
    // Historical creation commitments verify existing code only, never offer old materialization.
    const expected = getCreate2Address({
      from: input.kitchen,
      salt: gateSalt,
      bytecodeHash: pin.potInitCodeHash as Hex,
    });
    if (!same(expected, input.pot))
      throw new PotBindingMismatchError(
        "Existing Pot does not match the historical creation commitment; a CREATE3 profile is required",
      );
  }
  const [owner, userSalt, actualGateSalt, kitchen, router] = await Promise.all([
    client.readContract({ address: input.pot, abi: getters, functionName: "owner" }),
    client.readContract({ address: input.pot, abi: getters, functionName: "userSalt" }),
    client.readContract({ address: input.pot, abi: getters, functionName: "gateSalt" }),
    client.readContract({ address: input.pot, abi: getters, functionName: "kitchen" }),
    client.readContract({ address: input.pot, abi: getters, functionName: "router" }),
  ]);
  if (
    !same(owner, input.owner) ||
    !same(userSalt, input.userSalt) ||
    !same(actualGateSalt, gateSalt) ||
    !same(kitchen, input.kitchen) ||
    !same(router, input.router)
  ) {
    throw new PotBindingMismatchError(
      "Pot getters do not match its pinned identity and Router policy",
    );
  }
  const scheme = input.profile === undefined ? "create2" : "create3";
  const routerPolicy = routerFixed ? "fixed" : "owner-controlled";
  const profileHash =
    input.profile === undefined ? undefined : potRuntimeProfileHash(input.profile);
  if (
    (input.scheme !== undefined && input.scheme !== scheme) ||
    (input.routerPolicy !== undefined && input.routerPolicy !== routerPolicy) ||
    (input.profileHash !== undefined &&
      (profileHash === undefined || !same(input.profileHash, profileHash)))
  ) {
    throw new PotBindingMismatchError(
      "Pot profile or Router policy changed from its persisted binding",
    );
  }
  let compatibilityProbe = input.compatibilityProbe;
  if (input.profile !== undefined) {
    if (compatibilityProbe === undefined) {
      if (
        input.compiler !== sdkCompilerVersion() ||
        input.compiler !== COMPILER_PROVENANCE.compiler ||
        COMPILER_PROVENANCE.wasmSha256 !== trustedProbe!.compilerWasmSha256
      ) {
        throw new PotBindingMismatchError(
          `Initial CREATE3 compatibility verification requires installed compiler ${input.compiler}, not ${sdkCompilerVersion()}`,
        );
      }
      compiledProbe ??= import("../wasm-compiler.js")
        .then(async ({ compile, ready }) => {
          await ready();

          return bytesToHex(
            compile({
              target: "evm",
              resolve: (path) =>
                path === "main.js"
                  ? stringToBytes("function main(): Uint256 { return 42; }")
                  : undefined,
            }).bytecode,
          );
        })
        .catch((error: unknown) => {
          compiledProbe = undefined;
          throw error;
        });
      compatibilityProbe = {
        compiler: input.compiler,
        compilerWasmSha256: COMPILER_PROVENANCE.wasmSha256,
        program: await compiledProbe,
      };
    }
    if (
      compatibilityProbe.compiler !== input.compiler ||
      compatibilityProbe.compilerWasmSha256 !== trustedProbe!.compilerWasmSha256 ||
      !same(compatibilityProbe.program, trustedProbe!.program) ||
      (input.release.compilerWasmSha256 !== undefined &&
        input.release.compilerWasmSha256 !== compatibilityProbe.compilerWasmSha256) ||
      !isHex(compatibilityProbe.program) ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(compatibilityProbe.program) ||
      size(compatibilityProbe.program) > 1024
    ) {
      throw new PotBindingMismatchError(
        "CREATE3 compatibility probe does not match the retained compiler",
      );
    }
    // Raw eth_call never follows CCIP-read URLs; only fee balance is simulated after code authentication.
    const caller = input.kind === "shared" ? input.pot : input.owner;
    const feeData = await client.request({
      method: "eth_call",
      params: [
        {
          from: caller,
          to: input.kitchen,
          data: encodeFunctionData({
            abi: probeAbi,
            functionName: "executionFee",
          }),
        },
        "latest",
        {},
      ],
    });
    if (!/^0x[0-9a-fA-F]{64}$/.test(feeData)) {
      throw new PotBindingMismatchError("Kitchen execution fee did not return a uint256");
    }
    const result = await client
      .request({
        method: "eth_call",
        params: [
          {
            from: caller,
            to: input.pot,
            data: encodeFunctionData({
              abi: probeAbi,
              functionName: "cook",
              args: [input.engine, compatibilityProbe.program],
            }),
            value: toHex(BigInt(feeData)),
          },
          "latest",
          { [caller]: { balance: toHex((1n << 256n) - 1n) } },
        ],
      })
      .catch((error: unknown) => {
        if (error instanceof BaseError) {
          const reverted = error.walk(
            (cause) =>
              cause instanceof ExecutionRevertedError ||
              cause instanceof ContractFunctionRevertedError ||
              (cause instanceof RpcRequestError && /execution reverted/i.test(cause.details)),
          );
          if (
            reverted instanceof ExecutionRevertedError ||
            reverted instanceof ContractFunctionRevertedError ||
            (reverted instanceof RpcRequestError && /execution reverted/i.test(reverted.details))
          ) {
            throw new PotBindingMismatchError("CREATE3 engine/Pot compatibility probe reverted", {
              cause: error,
            });
          }
        }
        throw error;
      });
    if (
      typeof result !== "string" ||
      !same(result, encodeAbiParameters([{ type: "uint256" }], [42n]))
    ) {
      throw new PotBindingMismatchError("CREATE3 engine/Pot compatibility known answer mismatch");
    }
  }

  const profile: EvmPotRuntimeProfile | undefined =
    input.profile === undefined
      ? undefined
      : {
          scheme: input.profile.scheme,
          helperInitCodeHash: input.profile.helperInitCodeHash,
          runtimeSize: input.profile.runtimeSize,
          runtimeTemplateHash: input.profile.runtimeTemplateHash,
          immutableReferences: {
            owner: input.profile.immutableReferences.owner.map(({ start, length }) => ({
              start,
              length,
            })),
            userSalt: input.profile.immutableReferences.userSalt.map(({ start, length }) => ({
              start,
              length,
            })),
            gateSalt: input.profile.immutableReferences.gateSalt.map(({ start, length }) => ({
              start,
              length,
            })),
            kitchen: input.profile.immutableReferences.kitchen.map(({ start, length }) => ({
              start,
              length,
            })),
            fixedRouter: input.profile.immutableReferences.fixedRouter.map(({ start, length }) => ({
              start,
              length,
            })),
            domainSeparator: input.profile.immutableReferences.domainSeparator.map(
              ({ start, length }) => ({ start, length }),
            ),
            domainChainId: input.profile.immutableReferences.domainChainId.map(
              ({ start, length }) => ({ start, length }),
            ),
          },
        };

  return {
    pot: input.pot,
    kitchen: input.kitchen,
    owner: input.owner,
    userSalt: input.userSalt,
    kind: input.kind,
    chainId: input.chainId,
    router: input.router,
    compiler: input.compiler,
    engine: input.engine,
    engineCodeHash: input.engineCodeHash,
    routerCodeHash: input.routerCodeHash,
    release: {
      ...input.release,
      ...(compatibilityProbe === undefined
        ? {}
        : {
            compilerWasmSha256: compatibilityProbe.compilerWasmSha256,
          }),
    },
    wireProfile: input.wireProfile,
    storageProfile: input.storageProfile,
    codeHash,
    scheme,
    routerPolicy,
    originalChainId: input.originalChainId ?? String(input.chainId),
    ...(profile === undefined ? {} : { profile }),
    ...(profileHash === undefined ? {} : { profileHash }),
    ...(compatibilityProbe === undefined
      ? {}
      : {
          compatibilityProbe: {
            compiler: compatibilityProbe.compiler,
            compilerWasmSha256: compatibilityProbe.compilerWasmSha256,
            program: compatibilityProbe.program,
          },
        }),
  };
}

/** Canonical identity includes the complete immutable layout, not only the masked code hash. */
export function potRuntimeProfileHash(profile: EvmPotRuntimeProfile): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify([
        profile.scheme,
        profile.helperInitCodeHash.toLowerCase(),
        profile.runtimeSize,
        profile.runtimeTemplateHash.toLowerCase(),
        immutableNames.map((name) => [
          name,
          [...profile.immutableReferences[name]]
            .sort((left, right) => left.start - right.start)
            .map(({ start, length }) => [start, length]),
        ]),
      ]),
    ),
  );
}
