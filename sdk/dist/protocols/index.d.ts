import type { ProtocolInfo, ProtocolCategory } from "../core/types.js";
/** All protocol metadata indexed by slug */
export declare const protocols: Record<string, ProtocolInfo>;
/** Get a protocol by slug */
export declare function getProtocol(slug: string): ProtocolInfo | undefined;
/** List all protocols */
export declare function listProtocols(): ProtocolInfo[];
/** Get all protocols in a category */
export declare function getProtocolsByCategory(category: ProtocolCategory): ProtocolInfo[];
/** Get all protocols deployed on a specific chain */
export declare function getProtocolsByChain(chainId: number): ProtocolInfo[];
/** Get all unique slugs */
export declare function listProtocolSlugs(): string[];
export * as uniswapV2 from "./uniswap-v2/index.js";
export * as uniswapV3 from "./uniswap-v3/index.js";
export * as uniswapV4 from "./uniswap-v4/index.js";
export * as sushiswapV2 from "./sushiswap-v2/index.js";
export * as curve from "./curve/index.js";
export * as balancerV2 from "./balancer-v2/index.js";
export * as aaveV2 from "./aave-v2/index.js";
export * as aaveV3 from "./aave-v3/index.js";
export * as cctp from "./cctp/index.js";
export * as compoundV3 from "./compound-v3/index.js";
export * as oneInch from "./oneinch/index.js";
export * as chainlink from "./chainlink/index.js";
export * as pyth from "./pyth/index.js";
export * as permit2 from "./permit2/index.js";
export * as safe from "./safe/index.js";
export * as lido from "./lido/index.js";
export * as eigenlayer from "./eigenlayer/index.js";
export * as erc3156 from "./erc3156/index.js";
export * as instadapp from "./instadapp/index.js";
export * as perpetualProtocol from "./perpetual-protocol/index.js";
export * as muxProtocol from "./mux-protocol/index.js";
export * as aevo from "./aevo/index.js";
export * as reflexer from "./reflexer/index.js";
export * as abracadabra from "./abracadabra/index.js";
export * as alchemix from "./alchemix/index.js";
export * as harvest from "./harvest/index.js";
export * as sommelier from "./sommelier/index.js";
export * as olympus from "./olympus/index.js";
export * as tokemak from "./tokemak/index.js";
export * as erc20 from "./erc20/index.js";
export * as erc4626 from "./erc4626/index.js";
//# sourceMappingURL=index.d.ts.map