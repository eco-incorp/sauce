import type { Abi } from "viem";
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
import * as cctp from "../protocols/cctp/index.js";
import { CONTRACT_LINKS, type ContractLink } from "./links.js";
import { buildDescriptor } from "./derive.js";
import type { ContractDescriptor } from "./types.js";
import type { ChainSlug } from "../chains/canonical.js";

/**
 * Per-protocol ABI-export lookup, one module namespace import per starter
 * protocol above. Kept as a flat Record<abiExportName, Abi> per protocol
 * rather than resolved through `protocols/index.ts` (which only carries
 * `ProtocolInfo`, no raw `as const` ABI arrays) — this is the one place the
 * descriptor layer reaches into a protocol's own module directly.
 */
const ABI_EXPORTS: Readonly<Record<string, Readonly<Record<string, Abi>>>> = {
  "uniswap-v2": {
    UniswapV2FactoryABI: uniswapV2.UniswapV2FactoryABI as unknown as Abi,
    UniswapV2RouterABI: uniswapV2.UniswapV2RouterABI as unknown as Abi,
  },
  "uniswap-v3": {
    UniswapV3FactoryABI: uniswapV3.UniswapV3FactoryABI as unknown as Abi,
    UniswapV3SwapRouterABI: uniswapV3.UniswapV3SwapRouterABI as unknown as Abi,
    UniswapV3SwapRouter02ABI: uniswapV3.UniswapV3SwapRouter02ABI as unknown as Abi,
    UniswapV3QuoterV2ABI: uniswapV3.UniswapV3QuoterV2ABI as unknown as Abi,
    UniswapV3NonfungiblePositionManagerABI:
      uniswapV3.UniswapV3NonfungiblePositionManagerABI as unknown as Abi,
  },
  "uniswap-v4": {
    UniswapV4PoolManagerABI: uniswapV4.UniswapV4PoolManagerABI as unknown as Abi,
    UniswapV4UniversalRouterABI: uniswapV4.UniswapV4UniversalRouterABI as unknown as Abi,
    UniswapV4PositionManagerABI: uniswapV4.UniswapV4PositionManagerABI as unknown as Abi,
  },
  "sushiswap-v2": {
    SushiSwapV2FactoryABI: sushiswapV2.SushiSwapV2FactoryABI as unknown as Abi,
    SushiSwapV2RouterABI: sushiswapV2.SushiSwapV2RouterABI as unknown as Abi,
  },
  "pancakeswap-v2": {
    PancakeSwapV2FactoryABI: pancakeswapV2.PancakeSwapV2FactoryABI as unknown as Abi,
    PancakeSwapV2RouterABI: pancakeswapV2.PancakeSwapV2RouterABI as unknown as Abi,
  },
  aerodrome: {
    AerodromeRouterABI: aerodrome.AerodromeRouterABI as unknown as Abi,
    AerodromePoolFactoryABI: aerodrome.AerodromePoolFactoryABI as unknown as Abi,
  },
  "aave-v3": { PoolABI: aaveV3.PoolABI as unknown as Abi },
  "aave-v2": { LendingPoolABI: aaveV2.LendingPoolABI as unknown as Abi },
  permit2: { Permit2ABI: permit2.Permit2ABI as unknown as Abi },
  oneinch: { AggregationRouterV6ABI: oneinch.AggregationRouterV6ABI as unknown as Abi },
  pendle: { PendleRouterABI: pendle.PendleRouterABI as unknown as Abi },
  "morpho-blue": { MorphoABI: morphoBlue.MorphoABI as unknown as Abi },
  "compound-v3": { CometABI: compoundV3.CometABI as unknown as Abi },
  erc20: { ERC20ABI: erc20.ERC20ABI as unknown as Abi },
  erc4626: { VaultABI: erc4626.VaultABI as unknown as Abi },
  cctp: { TokenMessengerABI: cctp.TokenMessengerABI as unknown as Abi },
};

/** Exposed for the linkage test's fail-closed invariants — not part of the public query API (see query.ts/index.ts). */
export { ABI_EXPORTS };

function resolveAbi(protocol: string, abiExport: string | undefined): Abi | undefined {
  if (abiExport === undefined) return undefined;
  const abi = ABI_EXPORTS[protocol]?.[abiExport];
  if (abi === undefined) {
    throw new Error(
      `descriptors registry: unknown ABI export '${abiExport}' for protocol '${protocol}' — check links.ts against ${protocol}/abis.ts`,
    );
  }
  return abi;
}

function buildAllDescriptors(): ContractDescriptor[] {
  const out: ContractDescriptor[] = [];
  for (const link of CONTRACT_LINKS as readonly ContractLink[]) {
    const protocolInfo = getProtocol(link.protocol);
    if (protocolInfo === undefined) {
      throw new Error(
        `descriptors registry: unknown protocol '${link.protocol}' in CONTRACT_LINKS — check links.ts against protocols/index.ts`,
      );
    }
    const abi = resolveAbi(link.protocol, link.abiExport);
    out.push(buildDescriptor(link, protocolInfo, abi));
  }
  return out;
}

/** The whole flat registry, built once at module load. Stable order: as declared in CONTRACT_LINKS. */
export const DESCRIPTORS: readonly ContractDescriptor[] = Object.freeze(buildAllDescriptors());

function normalizeKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** protocol slug (normalized) -> its descriptors, in DESCRIPTORS order. */
export const byProtocol: ReadonlyMap<string, readonly ContractDescriptor[]> = (() => {
  const map = new Map<string, ContractDescriptor[]>();
  for (const d of DESCRIPTORS) {
    const key = normalizeKey(d.protocol);
    const list = map.get(key);
    if (list) list.push(d);
    else map.set(key, [d]);
  }
  return map;
})();

/** protocol slug (normalized) -> contract name (normalized) -> descriptor. */
export const byProtocolAndContract: ReadonlyMap<
  string,
  ReadonlyMap<string, ContractDescriptor>
> = (() => {
  const map = new Map<string, Map<string, ContractDescriptor>>();
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
export const byChain: ReadonlyMap<ChainSlug, readonly ContractDescriptor[]> = (() => {
  const map = new Map<ChainSlug, ContractDescriptor[]>();
  for (const d of DESCRIPTORS) {
    for (const slug of d.chains) {
      const list = map.get(slug);
      if (list) list.push(d);
      else map.set(slug, [d]);
    }
  }
  return map;
})();
