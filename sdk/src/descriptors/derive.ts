import {
  getAddress,
  toFunctionSelector,
  toFunctionSignature,
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Address,
} from "viem";
import type { ChainDeployment, ProtocolInfo } from "../core/types.js";
import { chainById, requireChain, type ChainSlug } from "../chains/canonical.js";
import type { ContractLink } from "./links.js";
import type {
  ContractCoverage,
  ContractDescriptor,
  DescriptorMethod,
  MethodReturn,
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

/** One ABI's methods with the contracts they return, computed once as `buildMethods`'s are: by
 *  the export's own `returns` map, which every descriptor of that export shares. */
const returningByExport = new WeakMap<object, readonly DescriptorMethod[]>();

/** `methods`, each annotated with the contracts its address outputs are (`returns`, by signature). */
function withReturns(
  abi: Abi,
  returns: ReadonlyMap<string, readonly MethodReturn[]> | undefined,
): readonly DescriptorMethod[] {
  const methods = buildMethods(abi);
  if (returns === undefined || returns.size === 0) return methods;
  const cached = returningByExport.get(returns);
  if (cached !== undefined) return cached;
  const annotated = methods.map((method) => {
    const returned = returns.get(method.signature);
    return returned === undefined ? method : { ...method, returns: returned };
  });
  returningByExport.set(returns, annotated);
  return annotated;
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

/** A descriptor whose every deployment runs its whole ABI. */
const NOTHING_WITHHELD: Readonly<Record<number, readonly string[]>> = Object.freeze({});
/** A descriptor whose every deployment declares its ABI's functions as the ABI does. */
const NOTHING_RESHAPED: Readonly<Record<number, readonly AbiFunction[]>> = Object.freeze({});

/** A tuple parameter's fields; `undefined` for any other parameter. */
const componentsOf = (p: AbiParameter | undefined): readonly AbiParameter[] | undefined =>
  p !== undefined && "components" in p ? p.components : undefined;

/** The output parameter `path` leads to: the one output, or a field of the record returned. */
export function outputAt(
  outputs: readonly AbiParameter[],
  path: readonly string[],
): AbiParameter | undefined {
  if (path.length === 0) return outputs.length === 1 ? outputs[0] : undefined;
  let fields =
    outputs.length === 1 && outputs[0]!.type === "tuple" ? componentsOf(outputs[0]) : outputs;
  let found: AbiParameter | undefined;
  for (const name of path) {
    found = fields?.find((field) => field.name === name);
    if (found === undefined) return undefined;
    fields = componentsOf(found);
  }
  return found;
}

/**
 * Assembles one full ContractDescriptor from a link entry plus the protocol's already-resolved data.
 * `deployments` defaults to the protocol's catalog deployments; `returns` is the contracts the ABI's
 * methods return, by signature (`RETURNED_CONTRACTS`). Methods, addresses and coverage are computed
 * when first read: the registry holds about 300 contracts, and a program names a few.
 */
export function buildDescriptor(
  link: ContractLink,
  protocolInfo: ProtocolInfo,
  abi: Abi | undefined,
  deployments: readonly ChainDeployment[] = protocolInfo.chains,
  returns?: ReadonlyMap<string, readonly MethodReturn[]>,
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
    withheldOn: link.withheld ?? NOTHING_WITHHELD,
    shapesOn: link.shapes ?? NOTHING_RESHAPED,
    ...(link.default === true ? { isDefault: true as const } : {}),
  };
  lazy(descriptor, "methods", () => withReturns(resolvedAbi, returns));
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

/** Each descriptor's views by chain id, built once (`descriptorOn`). */
const chainViews = new WeakMap<ContractDescriptor, Map<number, ContractDescriptor>>();

/**
 * `descriptor` as the deployment on `chainId` runs it. The registry's ABI for a role is the union
 * of what its deployments run, so one chain's may lack some functions (`withheldOn`) or declare
 * some otherwise (`shapesOn`). Where the chain's deployment runs the whole ABI as declared (or
 * there is none), this is `descriptor` itself; otherwise a view, built once per descriptor and
 * chain, whose `abi` and `methods` leave the functions it lacks out and carry those it declares
 * otherwise as it declares them, in their place (keeping the contract an address output is only
 * where that output is still an address). Events and errors stay, and everything else is the
 * descriptor's.
 */
export function descriptorOn(descriptor: ContractDescriptor, chainId: number): ContractDescriptor {
  const withheld = descriptor.withheldOn[chainId] ?? [];
  const declared = descriptor.shapesOn[chainId] ?? [];
  if (withheld.length === 0 && declared.length === 0) return descriptor;
  let views = chainViews.get(descriptor);
  if (views === undefined) {
    views = new Map();
    chainViews.set(descriptor, views);
  }
  let view = views.get(chainId);
  if (view === undefined) {
    const lacking = new Set(withheld);
    const own = new Map(declared.map((fn) => [toFunctionSignature(fn), fn]));
    const ownMethods = new Map(buildMethods(declared).map((m) => [m.signature, m]));
    view = {
      ...descriptor,
      abi: descriptor.abi.flatMap((item): Abi[number][] => {
        if (item.type !== "function") return [item];
        const signature = toFunctionSignature(item);
        return lacking.has(signature) ? [] : [own.get(signature) ?? item];
      }),
      methods: descriptor.methods.flatMap((method) => {
        if (lacking.has(method.signature)) return [];
        const ownMethod = ownMethods.get(method.signature);
        if (ownMethod === undefined) return [method];
        const returns = method.returns?.filter(
          (r) => outputAt(ownMethod.outputs, r.path)?.type === "address",
        );
        return [returns?.length ? { ...ownMethod, returns } : ownMethod];
      }),
    };
    views.set(chainId, view);
  }

  return view;
}
