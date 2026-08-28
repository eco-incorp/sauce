import type { Chain } from "../core/types.js";
/** All supported EVM chains */
export declare const chains: Record<number, Chain>;
export declare function getChain(chainId: number): Chain | undefined;
export declare function getAllChainIds(): number[];
export * from "./canonical.js";
//# sourceMappingURL=index.d.ts.map