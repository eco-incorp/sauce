import {
  getAddress,
  toFunctionSelector,
  toFunctionSignature,
  type Abi,
  type AbiFunction,
  type Address,
} from "viem";
import type { ChainDeployment, ProtocolInfo } from "../core/types.js";
import { chainById, requireChain, type ChainSlug } from "../chains/canonical.js";
import type { ContractLink } from "./links.js";
import type {
  ContractCoverage,
  ContractDescriptor,
  DescriptorMethod,
  StateMutability,
} from "./types.js";

const pascalOf = (slug: string): string =>
  slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

/**
 * An ABI export's contract name: the export without its trailing "ABI" and without the protocol's
 * own prefix — its display name squashed ("Uniswap V4"), or its slug's PascalCase ("arrakis" for
 * "Arrakis Finance") — e.g. "UniswapV4UniversalRouterABI" under "Uniswap V4" is "UniversalRouter".
 * A prefix is stripped only where a word follows it. This names the registry's interfaces, and a role
 * bound to different ABIs on different chains; every other contract is named after its role key
 * (see links.ts). `scripts/gen-source-globals.mjs` applies the same rule.
 */
export function deriveContractName(protocolName: string, abiExport: string, slug?: string): string {
  const base = abiExport.endsWith("ABI") ? abiExport.slice(0, -3) : abiExport;
  const prefixes = [protocolName, slug === undefined ? "" : pascalOf(slug)]
    .map((prefix) => prefix.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((prefix) => prefix.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    const rest = base.slice(prefix.length);
    if (base.toLowerCase().startsWith(prefix.toLowerCase()) && /^[A-Z0-9]/.test(rest)) return rest;
  }
  return base;
}

/** Every registry ABI entry in this codebase already declares `stateMutability`. */
function stateMutabilityOf(fn: AbiFunction): StateMutability {
  const m = fn.stateMutability;
  if (m === "pure" || m === "view" || m === "nonpayable" || m === "payable") return m;
  return "nonpayable";
}

/** One ABI's methods, computed once however many contracts share it (Aave V4's spokes do). */
const methodsByAbi = new WeakMap<Abi, DescriptorMethod[]>();

/** ABI -> ordered DescriptorMethod[] (no name-collapse: an overloaded name appears once per overload, which the linkage test holds to distinct argument counts). */
export function buildMethods(abi: Abi): DescriptorMethod[] {
  const cached = methodsByAbi.get(abi);
  if (cached !== undefined) return cached;
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
  methodsByAbi.set(abi, methods);
  return methods;
}

/**
 * role key -> sparse, EIP-55-checksummed per-chain address map, over canonical EVM chains (a Solana
 * program id under the same role is no EVM contract). `undefined` roleKey (kind:"interface") -> {}.
 * `chains` narrows it to the deployments one ABI binding covers.
 */
export function buildPerChainAddress(
  chains: readonly ChainDeployment[],
  roleKey: string | undefined,
  only?: readonly number[],
): Record<number, Address> {
  const out: Record<number, Address> = {};
  if (roleKey === undefined) return out;
  for (const deployment of chains) {
    const raw = deployment.addresses[roleKey];
    if (raw === undefined || !/^0x[0-9a-fA-F]{40}$/.test(raw)) continue;
    if (chainById(deployment.chainId)?.kind !== "evm") continue;
    if (only !== undefined && !only.includes(deployment.chainId)) continue;
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
  link: Pick<ContractLink, "typeFidelity" | "caveats">,
): ContractCoverage {
  return {
    abiSource: "sdk-registry",
    completeness: "partial",
    typeFidelity: link.typeFidelity ?? "exact",
    methodCount: methods.length,
    caveats: link.caveats ?? [],
  };
}

/** A memoising getter: the value is computed the first time it is read. */
function lazy<T>(target: object, key: string, compute: () => T): void {
  let value: T | undefined;
  let done = false;
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: false,
    get(): T {
      if (!done) {
        value = compute();
        done = true;
      }
      return value as T;
    },
  });
}

/**
 * Assembles one full ContractDescriptor from a link entry plus the protocol's already-resolved data.
 * `deployments` defaults to the protocol's catalog deployments. Methods, addresses and coverage are
 * computed when first read: the registry holds about 300 contracts, and a program names a few.
 */
export function buildDescriptor(
  link: ContractLink,
  protocolInfo: ProtocolInfo,
  abi: Abi | undefined,
  deployments: readonly ChainDeployment[] = protocolInfo.chains,
): ContractDescriptor {
  const resolvedAbi: Abi = abi ?? [];
  const descriptor = {
    protocol: link.protocol,
    protocolName: protocolInfo.name,
    contract: link.contract,
    kind: link.kind,
    roleKey: link.roleKey,
    abiExport: link.abiExport,
    abi: resolvedAbi,
  };
  lazy(descriptor, "methods", () => buildMethods(resolvedAbi));
  lazy(descriptor, "perChainAddress", () =>
    buildPerChainAddress(deployments, link.roleKey, link.chains),
  );
  lazy(descriptor, "chains", () =>
    deriveChainSlugs((descriptor as unknown as ContractDescriptor).perChainAddress),
  );
  lazy(descriptor, "coverage", () =>
    buildCoverage((descriptor as unknown as ContractDescriptor).methods, link),
  );
  return descriptor as unknown as ContractDescriptor;
}
