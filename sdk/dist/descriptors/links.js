export const CONTRACT_LINKS = [
    // --- uniswap-v2 ---
    // `contract` below is explicit (not left to deriveContractName) purely so
    // `typeof CONTRACT_LINKS[number]["contract"]` is a literal for every entry —
    // see the E2.3 accessor-tree design doc. Values are byte-identical to what
    // deriveContractName(protocolInfo.name, abiExport) already computes;
    // test/descriptors-linkage.test.ts asserts that equality so the two can
    // never drift.
    { protocol: "uniswap-v2", roleKey: "factory", abiExport: "UniswapV2FactoryABI", contract: "Factory", kind: "singleton" },
    { protocol: "uniswap-v2", roleKey: "router", abiExport: "UniswapV2RouterABI", contract: "Router", kind: "singleton" },
    // --- uniswap-v3 ---
    // `fee` is vendored as uint32 throughout this protocol's ABIs; the real
    // deployed contracts use uint24 (verified against sdk/src/artifacts/IUniswapV3Pool.json,
    // and by hand: getPool(address,address,uint32) -> 0x71c54fc9, the real
    // getPool(address,address,uint24) -> 0x1698ee82).
    {
        protocol: "uniswap-v3",
        roleKey: "factory",
        abiExport: "UniswapV3FactoryABI",
        contract: "Factory",
        kind: "singleton",
        typeFidelity: "widened",
        caveats: ["fee is vendored as uint32; the deployed factory uses uint24, so computed selectors do not match the real contract"],
    },
    {
        protocol: "uniswap-v3",
        roleKey: "swapRouter",
        abiExport: "UniswapV3SwapRouterABI",
        contract: "SwapRouter",
        kind: "singleton",
        typeFidelity: "widened",
        caveats: ["fee is vendored as uint32; the deployed SwapRouter uses uint24, so computed selectors do not match the real contract"],
    },
    // Deliberately wrong-and-flagged, not omitted: the address is real (5
    // chains), but SwapRouter02 dropped the `deadline` field this ABI still
    // carries, so its selectors are wrong for a SECOND, independent reason on
    // top of the fee-width issue (real exactInputSingle selector: 0x04e45aaf).
    {
        protocol: "uniswap-v3",
        roleKey: "swapRouter02",
        abiExport: "UniswapV3SwapRouterABI",
        contract: "SwapRouter02",
        kind: "singleton",
        typeFidelity: "widened",
        caveats: [
            "fee is vendored as uint32; the deployed SwapRouter02 uses uint24",
            "this ABI is UniswapV3SwapRouterABI's exactInputSingle shape, which still carries a deadline field the deployed SwapRouter02 dropped — selectors do not match the real contract for this reason too",
        ],
    },
    {
        protocol: "uniswap-v3",
        roleKey: "quoterV2",
        abiExport: "UniswapV3QuoterV2ABI",
        contract: "QuoterV2",
        kind: "singleton",
        typeFidelity: "widened",
        caveats: ["fee is vendored as uint32; the deployed QuoterV2 uses uint24, so computed selectors do not match the real contract"],
    },
    {
        protocol: "uniswap-v3",
        roleKey: "nonfungiblePositionManager",
        abiExport: "UniswapV3NonfungiblePositionManagerABI",
        contract: "NonfungiblePositionManager",
        kind: "singleton",
    },
    // --- uniswap-v4 ---
    // fee/tickSpacing/tick are vendored as uint32; the real PoolManager packs
    // fee as uint24 and tickSpacing/tick as int24.
    {
        protocol: "uniswap-v4",
        roleKey: "poolManager",
        abiExport: "UniswapV4PoolManagerABI",
        contract: "PoolManager",
        kind: "singleton",
        typeFidelity: "widened",
        caveats: ["fee/tickSpacing/tick are vendored as uint32; the deployed PoolManager uses uint24/int24, so computed selectors do not match the real contract"],
    },
    // Only `execute` is vendored; the Universal Router's real swap surface is
    // expressed through the `commands`/`inputs` byte encoding, not modelled
    // here. No `exactIn`-shaped method is invented.
    {
        protocol: "uniswap-v4",
        roleKey: "universalRouter",
        abiExport: "UniswapV4UniversalRouterABI",
        contract: "UniversalRouter",
        kind: "singleton",
        caveats: ["vendored ABI covers execute(bytes,bytes[],uint256) only; the Universal Router's swap surface is expressed through the commands/inputs byte encoding, not modelled as separate methods here"],
    },
    {
        protocol: "uniswap-v4",
        roleKey: "positionManager",
        abiExport: "UniswapV4PositionManagerABI",
        contract: "PositionManager",
        kind: "singleton",
    },
    // --- sushiswap-v2 ---
    { protocol: "sushiswap-v2", roleKey: "factory", abiExport: "SushiSwapV2FactoryABI", contract: "Factory", kind: "singleton" },
    { protocol: "sushiswap-v2", roleKey: "router", abiExport: "SushiSwapV2RouterABI", contract: "Router", kind: "singleton" },
    // --- pancakeswap-v2 ---
    { protocol: "pancakeswap-v2", roleKey: "factory", abiExport: "PancakeSwapV2FactoryABI", contract: "Factory", kind: "singleton" },
    { protocol: "pancakeswap-v2", roleKey: "router", abiExport: "PancakeSwapV2RouterABI", contract: "Router", kind: "singleton" },
    // --- aerodrome ---
    { protocol: "aerodrome", roleKey: "router", abiExport: "AerodromeRouterABI", contract: "Router", kind: "singleton" },
    { protocol: "aerodrome", roleKey: "poolFactory", abiExport: "AerodromePoolFactoryABI", contract: "PoolFactory", kind: "singleton" },
    // --- cctp (Circle CCTP v2) ---
    { protocol: "cctp", roleKey: "tokenMessenger", abiExport: "TokenMessengerABI", contract: "TokenMessenger", kind: "singleton" },
    // --- aave-v3 ---
    { protocol: "aave-v3", roleKey: "pool", abiExport: "PoolABI", contract: "Pool", kind: "singleton" },
    // No ABI vendored for this role at all — a real, known address with no
    // methods, recorded rather than dropped.
    {
        protocol: "aave-v3",
        roleKey: "poolAddressesProvider",
        contract: "PoolAddressesProvider",
        kind: "address-only",
        caveats: ["no ABI vendored for this role; address recorded with zero methods"],
    },
    // --- aave-v2 ---
    { protocol: "aave-v2", roleKey: "lendingPool", abiExport: "LendingPoolABI", contract: "LendingPool", kind: "singleton" },
    // --- permit2 ---
    { protocol: "permit2", roleKey: "permit2", abiExport: "Permit2ABI", contract: "Permit2", kind: "singleton" },
    // --- oneinch ---
    { protocol: "oneinch", roleKey: "aggregationRouterV6", abiExport: "AggregationRouterV6ABI", contract: "AggregationRouterV6", kind: "singleton" },
    // --- pendle ---
    { protocol: "pendle", roleKey: "router", abiExport: "PendleRouterABI", contract: "Router", kind: "singleton" },
    // --- morpho-blue ---
    { protocol: "morpho-blue", roleKey: "morpho", abiExport: "MorphoABI", contract: "Morpho", kind: "singleton" },
    {
        protocol: "morpho-blue",
        roleKey: "bundler3",
        contract: "Bundler3",
        kind: "address-only",
        caveats: ["no ABI vendored for this role; address recorded with zero methods"],
    },
    // --- compound-v3 --- one ABI (CometABI) shared by three per-market
    // singleton contracts; each needs an explicit override or all three would
    // derive to the same name ("Comet").
    { protocol: "compound-v3", roleKey: "cUSDCv3", abiExport: "CometABI", contract: "CometUSDC", kind: "singleton" },
    { protocol: "compound-v3", roleKey: "cWETHv3", abiExport: "CometABI", contract: "CometWETH", kind: "singleton" },
    { protocol: "compound-v3", roleKey: "cUSDTv3", abiExport: "CometABI", contract: "CometUSDT", kind: "singleton" },
    // --- erc20 / erc4626 --- kind:"interface": ABI + methods, no fixed address; the caller supplies the instance.
    { protocol: "erc20", abiExport: "ERC20ABI", contract: "ERC20", kind: "interface" },
    { protocol: "erc4626", abiExport: "VaultABI", contract: "ERC4626Vault", kind: "interface" },
];
//# sourceMappingURL=links.js.map