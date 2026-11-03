import type { Address, Hex, Abi, AbiFunction, AbiParameter } from "viem";
import type { CanonicalChain, ChainSlug } from "../chains/canonical.js";

/**
 * What KIND of thing a descriptor represents. Not a boolean: the vendored
 * registry data genuinely contains three structurally different shapes
 * sharing one `addresses.ts`/`abis.ts` file pair per protocol.
 */
export type ContractKind =
  | "singleton" // fixed per-chain address + a vendored ABI (the common case)
  | "address-only" // address exists in addresses.ts, no ABI vendored
  | "interface"; // ABI vendored, no address — caller supplies the instance

export type StateMutability = "pure" | "view" | "nonpayable" | "payable";

export interface DescriptorMethod {
  readonly name: string;
  /** Canonical, tuple-expanded signature, e.g. "getPool(address,address,uint32)". */
  readonly signature: string;
  /** 4-byte selector, computed from the vendored ABI — see coverage.typeFidelity for whether it matches the deployed contract. */
  readonly selector: Hex;
  readonly inputs: readonly AbiParameter[];
  readonly outputs: readonly AbiParameter[];
  readonly stateMutability: StateMutability;
  /** The registry contract an address output is, where the registry knows it (see
   *  `ReturnedContractLink`): `UniswapV3.Factory`'s `getPool` returns a `UniswapV3.Pool`. */
  readonly returns?: readonly MethodReturn[];
}

/** One address output of a method, and the registry contract it is. */
export interface MethodReturn {
  /** `[]` for the method's one output, else the field names that lead to the address. */
  readonly path: readonly string[];
  /** The contract's protocol slug and its name in that protocol's namespace. */
  readonly protocol: string;
  readonly contract: string;
}

export interface ContractCoverage {
  /** Always "sdk-registry" in v1 — the SDK's own vendored data, never an external ABI source. */
  readonly abiSource: "sdk-registry";
  /**
   * "partial": the registry ABI is its deployments' full verified ABI less what cannot be exposed
   * (each export's omissions, with why, are `test/fixtures/registry-abi/omitted.json`); a `standard`
   * or `common` interface is only what every instance runs; and a chain's `descriptorOn` view also
   * drops what that chain's deployment does not run (`withheldOn`) and carries what it declares
   * otherwise as it declares it (`shapesOn`). No shipped record says which exports omit nothing, so
   * none is claimed "full".
   */
  readonly completeness: "partial" | "unknown";
  /** "widened" means the selectors computed here will NOT match the deployed contract's real selectors. */
  readonly typeFidelity: "exact" | "widened";
  readonly methodCount: number;
  /** Free-text, curated, one per known gap. */
  readonly caveats: readonly string[];
}

export interface ContractDescriptor {
  /** ProtocolInfo.slug, e.g. "uniswap-v4". */
  readonly protocol: string;
  /** ProtocolInfo.name, e.g. "Uniswap V4". */
  readonly protocolName: string;
  /** Human contract name, e.g. "UniversalRouter". */
  readonly contract: string;
  readonly kind: ContractKind;
  /** The addresses.ts role key. Undefined for kind:"interface". */
  readonly roleKey?: string;
  /** The abis.ts export name. Undefined for kind:"address-only". */
  readonly abiExport?: string;
  /** [] for kind:"address-only". */
  readonly abi: Abi;
  readonly methods: readonly DescriptorMethod[];
  /** Sparse; {} for kind:"interface". Keyed by numeric chain id (matches ChainDeployment.chainId verbatim). */
  readonly perChainAddress: Readonly<Record<number, Address>>;
  /** Derived via the canonical chain registry, id-ascending. */
  readonly chains: readonly ChainSlug[];
  readonly coverage: ContractCoverage;
  /** The protocol's default contract, which `<Protocol>.<method>(…)` calls, where the registry
   *  marks one among several singletons (`ContractLink.default`). */
  readonly isDefault?: true;
  /**
   * Per chain id, the canonical signatures of `abi`'s functions the chain's deployment does not run
   * as declared (see `ContractLink.withheld`); `{}` when every deployment runs all of it. `abi`
   * and `methods` are the union over the deployments: `descriptorOn(descriptor, chainId)` is the
   * chain's own.
   */
  readonly withheldOn: Readonly<Record<number, readonly string[]>>;
  /**
   * Per chain id, the functions of `abi` the chain's deployment declares otherwise, as it declares
   * them (see `ContractLink.shapes`); `{}` when none does. `descriptorOn(descriptor, chainId)`
   * carries each in place of `abi`'s.
   */
  readonly shapesOn: Readonly<Record<number, readonly AbiFunction[]>>;
}

export interface ResolvedContract {
  readonly descriptor: ContractDescriptor;
  readonly chain: CanonicalChain;
  /** Undefined for kind:"interface". */
  readonly address?: Address;
  readonly methods: ReadonlyMap<string, DescriptorMethod>;
}
