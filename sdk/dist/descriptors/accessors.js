import { requireChain } from "../chains/canonical.js";
import { pascalOfSlug } from "../routes/builder.js";
import { makeContractCall } from "./call.js";
import { addressOn, requireContract } from "./query.js";
import { DESCRIPTORS } from "./registry.js";
function buildAccessor(descriptor, chain, addressOverride) {
    const isInterface = descriptor.kind === "interface";
    const resolvedAddress = addressOverride ?? (isInterface ? undefined : addressOn(descriptor, chain));
    const available = isInterface ? addressOverride !== undefined : resolvedAddress !== undefined;
    const base = {
        descriptor,
        chain,
        address: resolvedAddress,
        available,
        chains: descriptor.chains,
        coverage: descriptor.coverage,
        abi: descriptor.abi,
        methods: descriptor.methods,
        at(newAddress) {
            return buildAccessor(descriptor, chain, newAddress);
        },
    };
    for (const method of descriptor.methods) {
        base[method.name] = (...args) => {
            let address = resolvedAddress;
            if (address === undefined) {
                if (isInterface) {
                    throw new Error(`${descriptor.protocol}.${descriptor.contract} is an interface descriptor (no fixed address) — bind an instance first: .at('0x…').${method.name}(...)`);
                }
                // Reuses requireContract's exact, established hole-error message
                // rather than re-deriving it here.
                const resolved = requireContract(chain, descriptor.protocol, descriptor.contract);
                address = resolved.address;
            }
            if (address === undefined) {
                throw new Error(`${descriptor.protocol}.${descriptor.contract}: no address resolved on '${chain.slug}'`);
            }
            return makeContractCall(descriptor, chain, address, method, args);
        };
    }
    return base;
}
/** protocol slug (exact, as declared in CONTRACT_LINKS) -> its descriptors, insertion order. */
const protocolGroups = (() => {
    const map = new Map();
    for (const d of DESCRIPTORS) {
        const list = map.get(d.protocol);
        if (list)
            list.push(d);
        else
            map.set(d.protocol, [d]);
    }
    return map;
})();
const protocolSlugs = [...protocolGroups.keys()];
/** `"uniswap-v4"` -> `"uniswap"`; a slug with no trailing `-v<N>` yields `undefined` (no family alias). */
function familyStem(slug) {
    const m = /^(.+)-v\d+$/.exec(slug);
    return m ? m[1] : undefined;
}
/** family alias key (PascalCase) -> member protocol slugs, insertion order. */
const familyMembers = (() => {
    const map = new Map();
    for (const slug of protocolSlugs) {
        const stem = familyStem(slug);
        if (stem === undefined)
            continue;
        const key = pascalOfSlug(stem);
        const list = map.get(key);
        if (list)
            list.push(slug);
        else
            map.set(key, [slug]);
    }
    return map;
})();
/**
 * Builds the whole lazy tree for one resolved chain. Every canonical
 * protocol namespace is memoised once per `chainContracts` call, so a family
 * alias resolving a non-ambiguous name (`Base.Uniswap.UniversalRouter`)
 * forwards to the EXACT SAME accessor object as the canonical path
 * (`Base.UniswapV4.UniversalRouter`) — verified by identity in
 * `test/descriptors-accessors.test.ts`.
 */
export function chainContracts(chainRef) {
    const chain = requireChain(chainRef);
    const protocolNamespaceCache = new Map();
    function protocolNamespace(slug) {
        const cached = protocolNamespaceCache.get(slug);
        if (cached !== undefined)
            return cached;
        const ns = {};
        for (const d of protocolGroups.get(slug) ?? []) {
            let memo;
            Object.defineProperty(ns, d.contract, {
                enumerable: true,
                configurable: true,
                get() {
                    if (memo === undefined)
                        memo = buildAccessor(d, chain);
                    return memo;
                },
            });
        }
        protocolNamespaceCache.set(slug, ns);
        return ns;
    }
    function buildFamilyNamespace(familyKey, members) {
        const ownersByContract = new Map();
        for (const slug of members) {
            for (const d of protocolGroups.get(slug) ?? []) {
                const owners = ownersByContract.get(d.contract);
                if (owners)
                    owners.push(slug);
                else
                    ownersByContract.set(d.contract, [slug]);
            }
        }
        const out = {};
        for (const [contractName, owners] of ownersByContract) {
            if (owners.length === 1) {
                const owner = owners[0];
                Object.defineProperty(out, contractName, {
                    enumerable: true,
                    configurable: true,
                    get: () => protocolNamespace(owner)[contractName],
                });
            }
            else {
                Object.defineProperty(out, contractName, {
                    enumerable: true,
                    configurable: true,
                    get() {
                        const candidates = owners.map((s) => `${pascalOfSlug(s)}.${contractName}`).join(" or ");
                        throw new Error(`"${contractName}" is ambiguous under ${familyKey} (${owners.join(", ")}) — use ${candidates}`);
                    },
                });
            }
        }
        return out;
    }
    const out = {};
    for (const slug of protocolSlugs) {
        const key = pascalOfSlug(slug);
        if (key in out) {
            throw new Error(`descriptors: duplicate protocol namespace '${key}' (from slug '${slug}')`);
        }
        Object.defineProperty(out, key, {
            enumerable: true,
            configurable: true,
            get: () => protocolNamespace(slug),
        });
    }
    for (const [familyKey, members] of familyMembers) {
        if (familyKey in out) {
            throw new Error(`descriptors: family alias '${familyKey}' collides with a canonical protocol namespace`);
        }
        let memo;
        Object.defineProperty(out, familyKey, {
            enumerable: true,
            configurable: true,
            get: () => {
                if (memo === undefined)
                    memo = buildFamilyNamespace(familyKey, members);
                return memo;
            },
        });
    }
    return out;
}
/** Import-based front door (option-b): `contracts.on('base').Uniswap.UniversalRouter.execute(...)`.
 *  Escape hatch for `__ECO_ROUTES_NO_GLOBALS__` hosts and for the TS2451 own-`const Base` caveat. */
export function on(chainRef) {
    return chainContracts(chainRef);
}
//# sourceMappingURL=accessors.js.map