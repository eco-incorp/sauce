import type { Address, Hex } from "viem";
import { type CanonicalChain, type ChainRef } from "../chains/canonical.js";
import type { ProtocolInfo } from "../core/types.js";
import type { ContractDescriptor, DescriptorMethod, ResolvedContract } from "./types.js";
/** The whole flat registry, stable order. */
export declare function listDescriptors(): readonly ContractDescriptor[];
/** Forward index: protocol (slug, or normalized ProtocolInfo.name) -> its descriptors. */
export declare function listContracts(protocol: string): readonly ContractDescriptor[];
/** kind:"interface" descriptors (erc20, erc4626 in the starter set): ABI + methods, no fixed address. */
export declare function listInterfaces(): readonly ContractDescriptor[];
/** Chain-free lookup: the descriptor is the chain-INDEPENDENT object; ResolvedContract (describeContract) is its chain-bound view. */
export declare function getDescriptor(protocol: string, contract: string): ContractDescriptor | undefined;
/** REVERSE INDEX: every returned descriptor is guaranteed to have an address on `chain`. kind:"interface" descriptors never appear here (reach them via listInterfaces()). */
export declare function contractsOnChain(chain: ChainRef): readonly ContractDescriptor[];
/** Reverse index at protocol granularity, deduped, over the STARTER SET only — deliberately narrower than protocols/index.ts's getProtocolsByChain (all ~128 protocols, no descriptor behind it). */
export declare function protocolsOnChain(chain: ChainRef): readonly ProtocolInfo[];
/** The sparse-map accessor, bigint-aware — never index `perChainAddress` by a raw chain id directly. */
export declare function addressOn(descriptor: ContractDescriptor, chain: ChainRef): Address | undefined;
/** Name-keyed method lookup. Safe for this dataset: zero overloaded function names across every starter-set ABI (see the linkage test). */
export declare function methodOf(descriptor: ContractDescriptor, name: string): DescriptorMethod | undefined;
export declare function selectorOf(descriptor: ContractDescriptor, name: string): Hex | undefined;
/** Resolved CanonicalChain records (not raw slugs) for every chain this descriptor has an address on. */
export declare function descriptorChains(descriptor: ContractDescriptor): readonly CanonicalChain[];
/** THE thin resolver: (chain, protocol, contract) -> address + abi + methods for that chain, or undefined. E2.3's typed accessor tree is a walk over this, not a reimplementation of it. */
export declare function describeContract(chain: ChainRef, protocol: string, contract: string): ResolvedContract | undefined;
/** Throwing sibling of describeContract, mirroring requireChain/requireV12Deployment's "here is the known set" error style. */
export declare function requireContract(chain: ChainRef, protocol: string, contract: string): ResolvedContract;
//# sourceMappingURL=query.d.ts.map