import { requireChain, resolveChain } from "../chains/canonical.js";
import { getProtocol } from "../protocols/index.js";
import { DESCRIPTORS, byChain, byProtocol, byProtocolAndContract } from "./registry.js";
function normalizeKey(input) {
    return input.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
/** The whole flat registry, stable order. */
export function listDescriptors() {
    return DESCRIPTORS;
}
/** Forward index: protocol (slug, or normalized ProtocolInfo.name) -> its descriptors. */
export function listContracts(protocol) {
    return byProtocol.get(normalizeKey(protocol)) ?? [];
}
/** kind:"interface" descriptors (erc20, erc4626 in the starter set): ABI + methods, no fixed address. */
export function listInterfaces() {
    return DESCRIPTORS.filter((d) => d.kind === "interface");
}
/** Chain-free lookup: the descriptor is the chain-INDEPENDENT object; ResolvedContract (describeContract) is its chain-bound view. */
export function getDescriptor(protocol, contract) {
    return byProtocolAndContract.get(normalizeKey(protocol))?.get(normalizeKey(contract));
}
/** REVERSE INDEX: every returned descriptor is guaranteed to have an address on `chain`. kind:"interface" descriptors never appear here (reach them via listInterfaces()). */
export function contractsOnChain(chain) {
    const resolved = resolveChain(chain);
    if (resolved === undefined)
        return [];
    return byChain.get(resolved.slug) ?? [];
}
/** Reverse index at protocol granularity, deduped, over the STARTER SET only — deliberately narrower than protocols/index.ts's getProtocolsByChain (all ~128 protocols, no descriptor behind it). */
export function protocolsOnChain(chain) {
    const slugs = new Set();
    const out = [];
    for (const descriptor of contractsOnChain(chain)) {
        if (slugs.has(descriptor.protocol))
            continue;
        slugs.add(descriptor.protocol);
        const info = getProtocol(descriptor.protocol);
        if (info !== undefined)
            out.push(info);
    }
    return out;
}
/** The sparse-map accessor, bigint-aware — never index `perChainAddress` by a raw chain id directly. */
export function addressOn(descriptor, chain) {
    const resolved = resolveChain(chain);
    if (resolved === undefined)
        return undefined;
    return descriptor.perChainAddress[resolved.id];
}
/** Name-keyed method lookup. Safe for this dataset: zero overloaded function names across every starter-set ABI (see the linkage test). */
export function methodOf(descriptor, name) {
    return descriptor.methods.find((m) => m.name === name);
}
export function selectorOf(descriptor, name) {
    return methodOf(descriptor, name)?.selector;
}
/** Resolved CanonicalChain records (not raw slugs) for every chain this descriptor has an address on. */
export function descriptorChains(descriptor) {
    return descriptor.chains.map((slug) => requireChain(slug));
}
/** THE thin resolver: (chain, protocol, contract) -> address + abi + methods for that chain, or undefined. E2.3's typed accessor tree is a walk over this, not a reimplementation of it. */
export function describeContract(chain, protocol, contract) {
    const resolvedChain = resolveChain(chain);
    if (resolvedChain === undefined)
        return undefined;
    const descriptor = getDescriptor(protocol, contract);
    if (descriptor === undefined)
        return undefined;
    if (descriptor.kind !== "interface") {
        const address = addressOn(descriptor, resolvedChain);
        if (address === undefined)
            return undefined;
        return { descriptor, chain: resolvedChain, address, methods: new Map(descriptor.methods.map((m) => [m.name, m])) };
    }
    return { descriptor, chain: resolvedChain, methods: new Map(descriptor.methods.map((m) => [m.name, m])) };
}
/** Throwing sibling of describeContract, mirroring requireChain/requireV12Deployment's "here is the known set" error style. */
export function requireContract(chain, protocol, contract) {
    const protocolDescriptors = listContracts(protocol);
    if (protocolDescriptors.length === 0) {
        const known = new Set(DESCRIPTORS.map((d) => d.protocol));
        throw new Error(`Unknown protocol '${protocol}' (known: ${[...known].sort().join(", ")})`);
    }
    const descriptor = getDescriptor(protocol, contract);
    if (descriptor === undefined) {
        const known = protocolDescriptors.map((d) => d.contract).join(", ");
        throw new Error(`Unknown contract '${contract}' in protocol '${protocol}' (known: ${known})`);
    }
    const resolvedChain = requireChain(chain);
    const resolved = describeContract(resolvedChain, protocol, contract);
    if (resolved === undefined) {
        const known = descriptor.chains.length > 0 ? descriptor.chains.join(", ") : "(none)";
        throw new Error(`Contract '${descriptor.contract}' (${descriptor.protocol}) is not deployed on '${resolvedChain.slug}' (available: ${known})`);
    }
    return resolved;
}
//# sourceMappingURL=query.js.map