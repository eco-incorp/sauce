import type { Address, Hex, Abi, AbiParameter } from "viem";
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
}

export interface ContractCoverage {
  /** Always "sdk-registry" in v1 — the SDK's own vendored data, never an external ABI source. */
  readonly abiSource: "sdk-registry";
  /** Every vendored ABI is a curated subset; never "full" in v1. */
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
}

export interface ResolvedContract {
  readonly descriptor: ContractDescriptor;
  readonly chain: CanonicalChain;
  /** Undefined for kind:"interface". */
  readonly address?: Address;
  readonly methods: ReadonlyMap<string, DescriptorMethod>;
}
