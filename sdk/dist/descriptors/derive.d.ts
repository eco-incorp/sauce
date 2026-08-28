import { type Abi, type Address } from "viem";
import type { ChainDeployment, ProtocolInfo } from "../core/types.js";
import { type ChainSlug } from "../chains/canonical.js";
import type { ContractLink } from "./links.js";
import type { ContractCoverage, ContractDescriptor, DescriptorMethod } from "./types.js";
/**
 * Default contract-name derivation: `abiExport` minus its trailing "ABI"
 * minus the protocol-name prefix, e.g. "UniswapV4UniversalRouterABI" with
 * protocol name "Uniswap V4" -> "UniversalRouter". Only used when the link
 * carries no explicit `contract` override (see links.ts's module comment for
 * why 6 of the 29 starter entries need one).
 */
export declare function deriveContractName(protocolName: string, abiExport: string): string;
/** ABI -> ordered DescriptorMethod[] (no name-collapse — an overloaded name would appear twice, see the linkage test's zero-overload invariant). */
export declare function buildMethods(abi: Abi): DescriptorMethod[];
/** role key -> sparse, EIP-55-checksummed per-chain address map. `undefined` roleKey (kind:"interface") -> {}. */
export declare function buildPerChainAddress(chains: readonly ChainDeployment[], roleKey: string | undefined): Record<number, Address>;
/** Sparse per-chain address map -> the chain slugs it resolves to, id-ascending. Fails closed (throws) on an id the canonical registry doesn't know — see test invariant #6. */
export declare function deriveChainSlugs(perChainAddress: Readonly<Record<number, Address>>): ChainSlug[];
export declare function buildCoverage(methods: readonly DescriptorMethod[], link: ContractLink): ContractCoverage;
/** Assembles one full ContractDescriptor from a link entry plus the protocol's already-resolved data. */
export declare function buildDescriptor(link: ContractLink, protocolInfo: ProtocolInfo, abi: Abi | undefined): ContractDescriptor;
//# sourceMappingURL=derive.d.ts.map