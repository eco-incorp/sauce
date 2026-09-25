import {
  getAddress,
  toFunctionSelector,
  toFunctionSignature,
  type Abi,
  type AbiFunction,
  type Address,
} from "viem";
import type { ChainDeployment, ProtocolInfo } from "../core/types.js";
import { requireChain, type ChainSlug } from "../chains/canonical.js";
import type { ContractLink } from "./links.js";
import type {
  ContractCoverage,
  ContractDescriptor,
  DescriptorMethod,
  StateMutability,
} from "./types.js";

/**
 * Default contract-name derivation: `abiExport` minus its trailing "ABI"
 * minus the protocol-name prefix, e.g. "UniswapV4UniversalRouterABI" with
 * protocol name "Uniswap V4" -> "UniversalRouter". Only used when the link
 * carries no explicit `contract` override (see links.ts's module comment for
 * why 6 of the 29 starter entries need one).
 */
export function deriveContractName(protocolName: string, abiExport: string): string {
  const withoutSuffix = abiExport.endsWith("ABI") ? abiExport.slice(0, -3) : abiExport;
  const prefix = protocolName.replace(/[^a-zA-Z0-9]/g, "");
  if (
    withoutSuffix.toLowerCase().startsWith(prefix.toLowerCase()) &&
    withoutSuffix.length > prefix.length
  ) {
    return withoutSuffix.slice(prefix.length);
  }
  return withoutSuffix;
}

/** Every registry ABI entry in this codebase already declares `stateMutability`. */
function stateMutabilityOf(fn: AbiFunction): StateMutability {
  const m = fn.stateMutability;
  if (m === "pure" || m === "view" || m === "nonpayable" || m === "payable") return m;
  return "nonpayable";
}

/** ABI -> ordered DescriptorMethod[] (no name-collapse — an overloaded name would appear twice, see the linkage test's zero-overload invariant). */
export function buildMethods(abi: Abi): DescriptorMethod[] {
  const methods: DescriptorMethod[] = [];
  for (const item of abi) {
    if (item.type !== "function") continue;
    const fn = item as AbiFunction;
    methods.push({
      name: fn.name,
      signature: toFunctionSignature(fn),
      selector: toFunctionSelector(fn),
      inputs: fn.inputs,
      outputs: fn.outputs,
      stateMutability: stateMutabilityOf(fn),
    });
  }
  return methods;
}

/** role key -> sparse, EIP-55-checksummed per-chain address map. `undefined` roleKey (kind:"interface") -> {}. */
export function buildPerChainAddress(
  chains: readonly ChainDeployment[],
  roleKey: string | undefined,
): Record<number, Address> {
  const out: Record<number, Address> = {};
  if (roleKey === undefined) return out;
  for (const deployment of chains) {
    const raw = deployment.addresses[roleKey];
    if (raw === undefined) continue;
    out[deployment.chainId] = getAddress(raw);
  }
  return out;
}

/** Sparse per-chain address map -> the chain slugs it resolves to, id-ascending. Fails closed (throws) on an id the canonical registry doesn't know — see test invariant #6. */
export function deriveChainSlugs(perChainAddress: Readonly<Record<number, Address>>): ChainSlug[] {
  return Object.keys(perChainAddress)
    .map(Number)
    .sort((a, b) => a - b)
    .map((id) => requireChain(id).slug as ChainSlug);
}

export function buildCoverage(
  methods: readonly DescriptorMethod[],
  link: ContractLink,
): ContractCoverage {
  return {
    abiSource: "sdk-registry",
    completeness: "partial",
    typeFidelity: link.typeFidelity ?? "exact",
    methodCount: methods.length,
    caveats: link.caveats ?? [],
  };
}

/** Assembles one full ContractDescriptor from a link entry plus the protocol's already-resolved data. */
export function buildDescriptor(
  link: ContractLink,
  protocolInfo: ProtocolInfo,
  abi: Abi | undefined,
): ContractDescriptor {
  const resolvedAbi: Abi = abi ?? [];
  const methods = buildMethods(resolvedAbi);
  const perChainAddress = buildPerChainAddress(protocolInfo.chains, link.roleKey);
  const contract =
    link.contract ??
    (link.abiExport !== undefined
      ? deriveContractName(protocolInfo.name, link.abiExport)
      : "Unknown");

  return {
    protocol: link.protocol,
    protocolName: protocolInfo.name,
    contract,
    kind: link.kind,
    roleKey: link.roleKey,
    abiExport: link.abiExport,
    abi: resolvedAbi,
    methods,
    perChainAddress,
    chains: deriveChainSlugs(perChainAddress),
    coverage: buildCoverage(methods, link),
  };
}
