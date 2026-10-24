<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V4 (`uniswap-v4`)

Singleton AMM with hooks architecture enabling custom pool logic, flash accounting, and native ETH support.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV4` on ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora |
| Chains | ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora |
| Document | [uniswap-v4.md](../uniswap-v4.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `UniswapV4` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's poolManager, `0x000000000004444c5dc75cB358380D2e3dE08A90`.
  require(UniswapV4.PoolManager != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | poolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` | `UniswapV4.PoolManager` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | positionManager | `0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e` | `UniswapV4.PositionManager` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stateView | `0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227` | `UniswapV4.StateView` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | universalRouter | `0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af` | `UniswapV4.UniversalRouter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | poolManager | `0x9a13F98Cb987694C9F086b1F5eB990EeA8264Ec3` | `UniswapV4.PoolManager` |
| [Optimism](../../../sauce-chains/references/optimism.md) | positionManager | `0x3C3Ea4B57a46241e54610e5f022E5c45859A1017` | `UniswapV4.PositionManager` |
| [Optimism](../../../sauce-chains/references/optimism.md) | stateView | `0xc18a3169788F4F75A170290584ECA6395C75Ecdb` | `UniswapV4.StateView` |
| [Optimism](../../../sauce-chains/references/optimism.md) | universalRouter | `0x851116D9223fabED8E56C0E6b8Ad0c31d98B3507` | `UniswapV4.UniversalRouter` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | poolManager | `0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF` | `UniswapV4.PoolManager` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | positionManager | `0x7A4a5c919aE2541AeD11041A1AEeE68f1287f95b` | `UniswapV4.PositionManager` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | stateView | `0xd13Dd3D6E93f276FAfc9Db9E6BB47C1180aeE0c4` | `UniswapV4.StateView` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | universalRouter | `0x1906c1d672b88cD1B9aC7593301cA990F94Eae07` | `UniswapV4.UniversalRouter` |
| [Unichain](../../../sauce-chains/references/unichain.md) | poolManager | `0x1F98400000000000000000000000000000000004` | `UniswapV4.PoolManager` |
| [Unichain](../../../sauce-chains/references/unichain.md) | stateView | `0x86e8631A016F9068C3f085fAF484Ee3F5fDee8f2` | `UniswapV4.StateView` |
| [Polygon](../../../sauce-chains/references/polygon.md) | poolManager | `0x67366782805870060151383F4BbFF9daB53e5cD6` | `UniswapV4.PoolManager` |
| [Polygon](../../../sauce-chains/references/polygon.md) | positionManager | `0x1Ec2eBf4F37E7363FDfe3551602425af0B3ceef9` | `UniswapV4.PositionManager` |
| [Polygon](../../../sauce-chains/references/polygon.md) | stateView | `0x5eA1bD7974c8A611cBAB0bDCAFcB1D9CC9b3BA5a` | `UniswapV4.StateView` |
| [Polygon](../../../sauce-chains/references/polygon.md) | universalRouter | `0x1095692A6237d83C6a72F3F5eFEdb9A670C49223` | `UniswapV4.UniversalRouter` |
| [Monad](../../../sauce-chains/references/monad.md) | poolManager | `0x188d586Ddcf52439676Ca21A244753fA19F9Ea8e` | `UniswapV4.PoolManager` |
| [Monad](../../../sauce-chains/references/monad.md) | positionManager | `0x5b7eC4a94fF9beDb700fb82aB09d5846972F4016` | `UniswapV4.PositionManager` |
| [Monad](../../../sauce-chains/references/monad.md) | stateView | `0x77395F3b2E73aE90843717371294fa97cC419D64` | `UniswapV4.StateView` |
| [Monad](../../../sauce-chains/references/monad.md) | universalRouter | `0x0D97Dc33264bfC1c226207428A79b26757fb9dc3` | `UniswapV4.UniversalRouter` |
| [Arc](../../../sauce-chains/references/arc.md) | poolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | `UniswapV4.PoolManager` |
| [Arc](../../../sauce-chains/references/arc.md) | positionManager | `0x6049c9a0e26405C0985f9E3685C87d0aE917f82B` | `UniswapV4.PositionManager` |
| [Arc](../../../sauce-chains/references/arc.md) | stateView | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` | `UniswapV4.StateView` |
| [Arc](../../../sauce-chains/references/arc.md) | universalRouter | `0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1` | `UniswapV4.UniversalRouter` |
| [Base](../../../sauce-chains/references/base.md) | poolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | `UniswapV4.PoolManager` |
| [Base](../../../sauce-chains/references/base.md) | positionManager | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` | `UniswapV4.PositionManager` |
| [Base](../../../sauce-chains/references/base.md) | stateView | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` | `UniswapV4.StateView` |
| [Base](../../../sauce-chains/references/base.md) | universalRouter | `0x6fF5693b99212Da76ad316178A184AB56D299b43` | `UniswapV4.UniversalRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | poolManager | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` | `UniswapV4.PoolManager` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | positionManager | `0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869` | `UniswapV4.PositionManager` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | stateView | `0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990` | `UniswapV4.StateView` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | universalRouter | `0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3` | `UniswapV4.UniversalRouter` |
| [Celo](../../../sauce-chains/references/celo.md) | poolManager | `0x288dc841A52FCA2707c6947B3A777c5E56cd87BC` | `UniswapV4.PoolManager` |
| [Celo](../../../sauce-chains/references/celo.md) | stateView | `0xbc21f8720BABf4b20d195eE5C6e99c52b76F2bfb` | `UniswapV4.StateView` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | poolManager | `0x06380C0e0912312B5150364B9DC4542BA0DbBc85` | `UniswapV4.PoolManager` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | positionManager | `0xB74b1F14d2754AcfcbBe1a221023a5cf50Ab8ACD` | `UniswapV4.PositionManager` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | stateView | `0xc3c9e198C735a4b97e3e683f391cCBDD60B69286` | `UniswapV4.StateView` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | universalRouter | `0x94b75331AE8d42C1b61065089B7d48FE14aA73b7` | `UniswapV4.UniversalRouter` |
| [Ink](../../../sauce-chains/references/ink.md) | poolManager | `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32` | `UniswapV4.PoolManager` |
| [Ink](../../../sauce-chains/references/ink.md) | stateView | `0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990` | `UniswapV4.StateView` |
| [Blast](../../../sauce-chains/references/blast.md) | poolManager | `0x1631559198A9e474033433b2958daBC135ab6446` | `UniswapV4.PoolManager` |
| [Blast](../../../sauce-chains/references/blast.md) | stateView | `0x12a88AE16F46DCe4e8B15368008Ab3380885df30` | `UniswapV4.StateView` |
| [Zora](../../../sauce-chains/references/zora.md) | poolManager | `0x0575338e4C17006aE181B47900A84404247CA30f` | `UniswapV4.PoolManager` |
| [Zora](../../../sauce-chains/references/zora.md) | stateView | `0x385785Af07d63b50d0a0ea57C4FF89D06adf7328` | `UniswapV4.StateView` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `UniswapV4PoolManagerABI`

`import UniswapV4PoolManagerABI from "./protocols/uniswap-v4/UniswapV4PoolManagerABI.json";` Speaks for: poolManager.

- `initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) returns (int24 tick)`
- `swap((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, bytes hookData) returns (int256 delta)`
- `modifyLiquidity((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt) params, bytes hookData) returns (int256 delta, int256 feeDelta)`
- `extsload(bytes32 slot) view returns (bytes32)`
- `extsload(bytes32 startSlot, uint256 nSlots) view returns (bytes32[])`

### `UniswapV4PositionManagerABI`

`import UniswapV4PositionManagerABI from "./protocols/uniswap-v4/UniswapV4PositionManagerABI.json";` Speaks for: positionManager.

- `modifyLiquidities(bytes unlockData, uint256 deadline) payable`

### `UniswapV4StateViewABI`

`import UniswapV4StateViewABI from "./protocols/uniswap-v4/UniswapV4StateViewABI.json";` Speaks for: stateView.

- `getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)`
- `getLiquidity(bytes32 poolId) view returns (uint128 liquidity)`
- `getTickInfo(bytes32 poolId, int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128)`
- `getTickLiquidity(bytes32 poolId, int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet)`
- `getTickFeeGrowthOutside(bytes32 poolId, int24 tick) view returns (uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128)`
- `getTickBitmap(bytes32 poolId, int16 tick) view returns (uint256 tickBitmap)`
- `getFeeGrowthGlobals(bytes32 poolId) view returns (uint256 feeGrowthGlobal0, uint256 feeGrowthGlobal1)`
- `getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)`
- `getPositionInfo(bytes32 poolId, bytes32 positionId) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)`
- `getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)`
- `getPositionLiquidity(bytes32 poolId, bytes32 positionId) view returns (uint128 liquidity)`
- `poolManager() view returns (address)`: the address is a `UniswapV4.PoolManager`

### `UniswapV4UniversalRouterABI`

`import UniswapV4UniversalRouterABI from "./protocols/uniswap-v4/UniswapV4UniversalRouterABI.json";` Speaks for: universalRouter.

- `execute(bytes commands, bytes[] inputs, uint256 deadline) payable`
- `execute(bytes commands, bytes[] inputs) payable`
