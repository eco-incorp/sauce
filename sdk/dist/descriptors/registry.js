import { getProtocol } from "../protocols/index.js";
import * as uniswapV2 from "../protocols/uniswap-v2/index.js";
import * as uniswapV3 from "../protocols/uniswap-v3/index.js";
import * as uniswapV4 from "../protocols/uniswap-v4/index.js";
import * as sushiswapV2 from "../protocols/sushiswap-v2/index.js";
import * as pancakeswapV2 from "../protocols/pancakeswap-v2/index.js";
import * as aerodrome from "../protocols/aerodrome/index.js";
import * as aaveV3 from "../protocols/aave-v3/index.js";
import * as aaveV2 from "../protocols/aave-v2/index.js";
import * as permit2 from "../protocols/permit2/index.js";
import * as oneinch from "../protocols/oneinch/index.js";
import * as pendle from "../protocols/pendle/index.js";
import * as morphoBlue from "../protocols/morpho-blue/index.js";
import * as compoundV3 from "../protocols/compound-v3/index.js";
import * as erc20 from "../protocols/erc20/index.js";
import * as erc4626 from "../protocols/erc4626/index.js";
import { CONTRACT_LINKS } from "./links.js";
import { buildDescriptor } from "./derive.js";
/**
 * Per-protocol ABI-export lookup, one module namespace import per starter
 * protocol above. Kept as a flat Record<abiExportName, Abi> per protocol
 * rather than resolved through `protocols/index.ts` (which only carries
 * `ProtocolInfo`, no raw `as const` ABI arrays) — this is the one place the
 * descriptor layer reaches into a protocol's own module directly.
 */
const ABI_EXPORTS = {
    "uniswap-v2": { UniswapV2FactoryABI: uniswapV2.UniswapV2FactoryABI, UniswapV2RouterABI: uniswapV2.UniswapV2RouterABI },
    "uniswap-v3": {
        UniswapV3FactoryABI: uniswapV3.UniswapV3FactoryABI,
        UniswapV3SwapRouterABI: uniswapV3.UniswapV3SwapRouterABI,
        UniswapV3QuoterV2ABI: uniswapV3.UniswapV3QuoterV2ABI,
        UniswapV3NonfungiblePositionManagerABI: uniswapV3.UniswapV3NonfungiblePositionManagerABI,
    },
    "uniswap-v4": {
        UniswapV4PoolManagerABI: uniswapV4.UniswapV4PoolManagerABI,
        UniswapV4UniversalRouterABI: uniswapV4.UniswapV4UniversalRouterABI,
        UniswapV4PositionManagerABI: uniswapV4.UniswapV4PositionManagerABI,
    },
    "sushiswap-v2": { SushiSwapV2FactoryABI: sushiswapV2.SushiSwapV2FactoryABI, SushiSwapV2RouterABI: sushiswapV2.SushiSwapV2RouterABI },
    "pancakeswap-v2": { PancakeSwapV2FactoryABI: pancakeswapV2.PancakeSwapV2FactoryABI, PancakeSwapV2RouterABI: pancakeswapV2.PancakeSwapV2RouterABI },
    aerodrome: { AerodromeRouterABI: aerodrome.AerodromeRouterABI, AerodromePoolFactoryABI: aerodrome.AerodromePoolFactoryABI },
    "aave-v3": { PoolABI: aaveV3.PoolABI },
    "aave-v2": { LendingPoolABI: aaveV2.LendingPoolABI },
    permit2: { Permit2ABI: permit2.Permit2ABI },
    oneinch: { AggregationRouterV6ABI: oneinch.AggregationRouterV6ABI },
    pendle: { PendleRouterABI: pendle.PendleRouterABI },
    "morpho-blue": { MorphoABI: morphoBlue.MorphoABI },
    "compound-v3": { CometABI: compoundV3.CometABI },
    erc20: { ERC20ABI: erc20.ERC20ABI },
    erc4626: { VaultABI: erc4626.VaultABI },
};
/** Exposed for the linkage test's fail-closed invariants — not part of the public query API (see query.ts/index.ts). */
export { ABI_EXPORTS };
function resolveAbi(protocol, abiExport) {
    if (abiExport === undefined)
        return undefined;
    const abi = ABI_EXPORTS[protocol]?.[abiExport];
    if (abi === undefined) {
        throw new Error(`descriptors registry: unknown ABI export '${abiExport}' for protocol '${protocol}' — check links.ts against ${protocol}/abis.ts`);
    }
    return abi;
}
function buildAllDescriptors() {
    const out = [];
    for (const link of CONTRACT_LINKS) {
        const protocolInfo = getProtocol(link.protocol);
        if (protocolInfo === undefined) {
            throw new Error(`descriptors registry: unknown protocol '${link.protocol}' in CONTRACT_LINKS — check links.ts against protocols/index.ts`);
        }
        const abi = resolveAbi(link.protocol, link.abiExport);
        out.push(buildDescriptor(link, protocolInfo, abi));
    }
    return out;
}
/** The whole flat registry, built once at module load. Stable order: as declared in CONTRACT_LINKS. */
export const DESCRIPTORS = Object.freeze(buildAllDescriptors());
function normalizeKey(input) {
    return input.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
/** protocol slug (normalized) -> its descriptors, in DESCRIPTORS order. */
export const byProtocol = (() => {
    const map = new Map();
    for (const d of DESCRIPTORS) {
        const key = normalizeKey(d.protocol);
        const list = map.get(key);
        if (list)
            list.push(d);
        else
            map.set(key, [d]);
    }
    return map;
})();
/** protocol slug (normalized) -> contract name (normalized) -> descriptor. */
export const byProtocolAndContract = (() => {
    const map = new Map();
    for (const d of DESCRIPTORS) {
        const pKey = normalizeKey(d.protocol);
        let inner = map.get(pKey);
        if (!inner) {
            inner = new Map();
            map.set(pKey, inner);
        }
        inner.set(normalizeKey(d.contract), d);
    }
    return map;
})();
/** REVERSE INDEX: chain slug -> descriptors with an address on that chain (kind:"interface" descriptors are always excluded — see listInterfaces). */
export const byChain = (() => {
    const map = new Map();
    for (const d of DESCRIPTORS) {
        for (const slug of d.chains) {
            const list = map.get(slug);
            if (list)
                list.push(d);
            else
                map.set(slug, [d]);
        }
    }
    return map;
})();
//# sourceMappingURL=registry.js.map