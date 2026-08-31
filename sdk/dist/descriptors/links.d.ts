import type { ContractKind } from "./types.js";
/**
 * THE CRUX: role-key <-> ABI-export <-> human-contract-name linkage.
 *
 * `addresses.ts` keys per-chain addresses by a free-form role string
 * ("factory", "swapRouter02", …) and `abis.ts` exports `<Name>ABI` arrays —
 * nothing in the existing registry data connects the two, or names the
 * resulting contract for a human/accessor tree. That link genuinely isn't
 * derivable end to end from the data (see the name-normalization measurement
 * below), so it is hand-authored here, one entry per descriptor, and
 * cross-checked against the live vendored data by
 * `test/descriptors-linkage.test.ts` — a role key or ABI export that stops
 * existing fails that suite immediately rather than silently producing a
 * stale/hole descriptor.
 *
 * SCOPE (v1): a STARTER SET of 15 protocols with clean, unambiguous linkage —
 * NOT an attempt to auto-link all ~128 registry protocols. Excluded, with
 * reasons that are data, not taste:
 *  - curve, lido, compound-v2, benqi, moonwell, venus, silo, layerbank:
 *    role key <-> ABI export name mismatches that need a human judgment call
 *    (`lido.stETH` vs `LidoABI`; `curve.threePool` is a StableSwap INSTANCE,
 *    not a role naming a single ABI-typed contract).
 *  - every bridge (l1-side / l2-side role pairs are a per-chain-SIDE axis this model
 *    has no slot for yet).
 *  - maker / alchemix / olympus / tokemak / stargate and similar: role keys
 *    are majority plain ERC20 token addresses, not protocol contracts.
 *
 * `contract` is the human display name. When omitted it is DERIVED (never
 * invented) by `deriveContractName` in derive.ts: `abiExport` minus its
 * trailing "ABI" minus the protocol-name prefix. Only entries that would
 * otherwise collide, or that have no `abiExport` to derive from, carry an
 * explicit override — see the comments below.
 */
export interface ContractLink {
    readonly protocol: string;
    readonly roleKey?: string;
    readonly abiExport?: string;
    /** Override only; see module doc comment. */
    readonly contract?: string;
    readonly kind: ContractKind;
    /** Default "exact". "widened" flags a vendored ABI using a wider-than-real type
     *  (e.g. uint32 in place of the deployed contract's uint24) — the computed
     *  selector will NOT match the real, deployed contract. */
    readonly typeFidelity?: "widened";
    readonly caveats?: readonly string[];
}
export declare const CONTRACT_LINKS: readonly [{
    readonly protocol: "uniswap-v2";
    readonly roleKey: "factory";
    readonly abiExport: "UniswapV2FactoryABI";
    readonly contract: "Factory";
    readonly kind: "singleton";
}, {
    readonly protocol: "uniswap-v2";
    readonly roleKey: "router";
    readonly abiExport: "UniswapV2RouterABI";
    readonly contract: "Router";
    readonly kind: "singleton";
}, {
    readonly protocol: "uniswap-v3";
    readonly roleKey: "factory";
    readonly abiExport: "UniswapV3FactoryABI";
    readonly contract: "Factory";
    readonly kind: "singleton";
    readonly typeFidelity: "widened";
    readonly caveats: readonly ["fee is vendored as uint32; the deployed factory uses uint24, so computed selectors do not match the real contract"];
}, {
    readonly protocol: "uniswap-v3";
    readonly roleKey: "swapRouter";
    readonly abiExport: "UniswapV3SwapRouterABI";
    readonly contract: "SwapRouter";
    readonly kind: "singleton";
    readonly typeFidelity: "widened";
    readonly caveats: readonly ["fee is vendored as uint32; the deployed SwapRouter uses uint24, so computed selectors do not match the real contract"];
}, {
    readonly protocol: "uniswap-v3";
    readonly roleKey: "swapRouter02";
    readonly abiExport: "UniswapV3SwapRouterABI";
    readonly contract: "SwapRouter02";
    readonly kind: "singleton";
    readonly typeFidelity: "widened";
    readonly caveats: readonly ["fee is vendored as uint32; the deployed SwapRouter02 uses uint24", "this ABI is UniswapV3SwapRouterABI's exactInputSingle shape, which still carries a deadline field the deployed SwapRouter02 dropped — selectors do not match the real contract for this reason too"];
}, {
    readonly protocol: "uniswap-v3";
    readonly roleKey: "quoterV2";
    readonly abiExport: "UniswapV3QuoterV2ABI";
    readonly contract: "QuoterV2";
    readonly kind: "singleton";
    readonly typeFidelity: "widened";
    readonly caveats: readonly ["fee is vendored as uint32; the deployed QuoterV2 uses uint24, so computed selectors do not match the real contract"];
}, {
    readonly protocol: "uniswap-v3";
    readonly roleKey: "nonfungiblePositionManager";
    readonly abiExport: "UniswapV3NonfungiblePositionManagerABI";
    readonly contract: "NonfungiblePositionManager";
    readonly kind: "singleton";
}, {
    readonly protocol: "uniswap-v4";
    readonly roleKey: "poolManager";
    readonly abiExport: "UniswapV4PoolManagerABI";
    readonly contract: "PoolManager";
    readonly kind: "singleton";
    readonly typeFidelity: "widened";
    readonly caveats: readonly ["fee/tickSpacing/tick are vendored as uint32; the deployed PoolManager uses uint24/int24, so computed selectors do not match the real contract"];
}, {
    readonly protocol: "uniswap-v4";
    readonly roleKey: "universalRouter";
    readonly abiExport: "UniswapV4UniversalRouterABI";
    readonly contract: "UniversalRouter";
    readonly kind: "singleton";
    readonly caveats: readonly ["vendored ABI covers execute(bytes,bytes[],uint256) only; the Universal Router's swap surface is expressed through the commands/inputs byte encoding, not modelled as separate methods here"];
}, {
    readonly protocol: "uniswap-v4";
    readonly roleKey: "positionManager";
    readonly abiExport: "UniswapV4PositionManagerABI";
    readonly contract: "PositionManager";
    readonly kind: "singleton";
}, {
    readonly protocol: "sushiswap-v2";
    readonly roleKey: "factory";
    readonly abiExport: "SushiSwapV2FactoryABI";
    readonly contract: "Factory";
    readonly kind: "singleton";
}, {
    readonly protocol: "sushiswap-v2";
    readonly roleKey: "router";
    readonly abiExport: "SushiSwapV2RouterABI";
    readonly contract: "Router";
    readonly kind: "singleton";
}, {
    readonly protocol: "pancakeswap-v2";
    readonly roleKey: "factory";
    readonly abiExport: "PancakeSwapV2FactoryABI";
    readonly contract: "Factory";
    readonly kind: "singleton";
}, {
    readonly protocol: "pancakeswap-v2";
    readonly roleKey: "router";
    readonly abiExport: "PancakeSwapV2RouterABI";
    readonly contract: "Router";
    readonly kind: "singleton";
}, {
    readonly protocol: "aerodrome";
    readonly roleKey: "router";
    readonly abiExport: "AerodromeRouterABI";
    readonly contract: "Router";
    readonly kind: "singleton";
}, {
    readonly protocol: "aerodrome";
    readonly roleKey: "poolFactory";
    readonly abiExport: "AerodromePoolFactoryABI";
    readonly contract: "PoolFactory";
    readonly kind: "singleton";
}, {
    readonly protocol: "cctp";
    readonly roleKey: "tokenMessenger";
    readonly abiExport: "TokenMessengerABI";
    readonly contract: "TokenMessenger";
    readonly kind: "singleton";
}, {
    readonly protocol: "aave-v3";
    readonly roleKey: "pool";
    readonly abiExport: "PoolABI";
    readonly contract: "Pool";
    readonly kind: "singleton";
}, {
    readonly protocol: "aave-v3";
    readonly roleKey: "poolAddressesProvider";
    readonly contract: "PoolAddressesProvider";
    readonly kind: "address-only";
    readonly caveats: readonly ["no ABI vendored for this role; address recorded with zero methods"];
}, {
    readonly protocol: "aave-v2";
    readonly roleKey: "lendingPool";
    readonly abiExport: "LendingPoolABI";
    readonly contract: "LendingPool";
    readonly kind: "singleton";
}, {
    readonly protocol: "permit2";
    readonly roleKey: "permit2";
    readonly abiExport: "Permit2ABI";
    readonly contract: "Permit2";
    readonly kind: "singleton";
}, {
    readonly protocol: "oneinch";
    readonly roleKey: "aggregationRouterV6";
    readonly abiExport: "AggregationRouterV6ABI";
    readonly contract: "AggregationRouterV6";
    readonly kind: "singleton";
}, {
    readonly protocol: "pendle";
    readonly roleKey: "router";
    readonly abiExport: "PendleRouterABI";
    readonly contract: "Router";
    readonly kind: "singleton";
}, {
    readonly protocol: "morpho-blue";
    readonly roleKey: "morpho";
    readonly abiExport: "MorphoABI";
    readonly contract: "Morpho";
    readonly kind: "singleton";
}, {
    readonly protocol: "morpho-blue";
    readonly roleKey: "bundler3";
    readonly contract: "Bundler3";
    readonly kind: "address-only";
    readonly caveats: readonly ["no ABI vendored for this role; address recorded with zero methods"];
}, {
    readonly protocol: "compound-v3";
    readonly roleKey: "cUSDCv3";
    readonly abiExport: "CometABI";
    readonly contract: "CometUSDC";
    readonly kind: "singleton";
}, {
    readonly protocol: "compound-v3";
    readonly roleKey: "cWETHv3";
    readonly abiExport: "CometABI";
    readonly contract: "CometWETH";
    readonly kind: "singleton";
}, {
    readonly protocol: "compound-v3";
    readonly roleKey: "cUSDTv3";
    readonly abiExport: "CometABI";
    readonly contract: "CometUSDT";
    readonly kind: "singleton";
}, {
    readonly protocol: "erc20";
    readonly abiExport: "ERC20ABI";
    readonly contract: "ERC20";
    readonly kind: "interface";
}, {
    readonly protocol: "erc4626";
    readonly abiExport: "VaultABI";
    readonly contract: "ERC4626Vault";
    readonly kind: "interface";
}];
export type ContractLinkEntry = (typeof CONTRACT_LINKS)[number];
//# sourceMappingURL=links.d.ts.map