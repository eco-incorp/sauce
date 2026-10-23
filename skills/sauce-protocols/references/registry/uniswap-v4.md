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
| [Ethereum](../../../sauce-chains/references/ethereum.md) | positionManager | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` | `UniswapV4.PositionManager` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stateView | `0x7ffe42c4a5deea5b0fec41c94c136cf115597227` | `UniswapV4.StateView` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | universalRouter | `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` | `UniswapV4.UniversalRouter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | poolManager | `0x9a13f98cb987694c9f086b1f5eb990eea8264ec3` | `UniswapV4.PoolManager` |
| [Optimism](../../../sauce-chains/references/optimism.md) | positionManager | `0x3c3ea4b57a46241e54610e5f022e5c45859a1017` | `UniswapV4.PositionManager` |
| [Optimism](../../../sauce-chains/references/optimism.md) | stateView | `0xc18a3169788f4f75a170290584eca6395c75ecdb` | `UniswapV4.StateView` |
| [Optimism](../../../sauce-chains/references/optimism.md) | universalRouter | `0x851116d9223fabed8e56c0e6b8ad0c31d98b3507` | `UniswapV4.UniversalRouter` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | poolManager | `0x28e2ea090877bf75740558f6bfb36a5ffee9e9df` | `UniswapV4.PoolManager` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | positionManager | `0x7a4a5c919ae2541aed11041a1aeee68f1287f95b` | `UniswapV4.PositionManager` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | stateView | `0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4` | `UniswapV4.StateView` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | universalRouter | `0x1906c1d672b88cd1b9ac7593301ca990f94eae07` | `UniswapV4.UniversalRouter` |
| [Unichain](../../../sauce-chains/references/unichain.md) | poolManager | `0x1f98400000000000000000000000000000000004` | `UniswapV4.PoolManager` |
| [Unichain](../../../sauce-chains/references/unichain.md) | stateView | `0x86e8631a016f9068c3f085faf484ee3f5fdee8f2` | `UniswapV4.StateView` |
| [Polygon](../../../sauce-chains/references/polygon.md) | poolManager | `0x67366782805870060151383f4bbff9dab53e5cd6` | `UniswapV4.PoolManager` |
| [Polygon](../../../sauce-chains/references/polygon.md) | positionManager | `0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9` | `UniswapV4.PositionManager` |
| [Polygon](../../../sauce-chains/references/polygon.md) | stateView | `0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a` | `UniswapV4.StateView` |
| [Polygon](../../../sauce-chains/references/polygon.md) | universalRouter | `0x1095692a6237d83c6a72f3f5efedb9a670c49223` | `UniswapV4.UniversalRouter` |
| [Monad](../../../sauce-chains/references/monad.md) | poolManager | `0x188d586ddcf52439676ca21a244753fa19f9ea8e` | `UniswapV4.PoolManager` |
| [Monad](../../../sauce-chains/references/monad.md) | positionManager | `0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016` | `UniswapV4.PositionManager` |
| [Monad](../../../sauce-chains/references/monad.md) | stateView | `0x77395f3b2e73ae90843717371294fa97cc419d64` | `UniswapV4.StateView` |
| [Monad](../../../sauce-chains/references/monad.md) | universalRouter | `0x0d97dc33264bfc1c226207428a79b26757fb9dc3` | `UniswapV4.UniversalRouter` |
| [Arc](../../../sauce-chains/references/arc.md) | poolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | `UniswapV4.PoolManager` |
| [Arc](../../../sauce-chains/references/arc.md) | positionManager | `0x6049c9a0e26405C0985f9E3685C87d0aE917f82B` | `UniswapV4.PositionManager` |
| [Arc](../../../sauce-chains/references/arc.md) | stateView | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` | `UniswapV4.StateView` |
| [Arc](../../../sauce-chains/references/arc.md) | universalRouter | `0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1` | `UniswapV4.UniversalRouter` |
| [Base](../../../sauce-chains/references/base.md) | poolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` | `UniswapV4.PoolManager` |
| [Base](../../../sauce-chains/references/base.md) | positionManager | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` | `UniswapV4.PositionManager` |
| [Base](../../../sauce-chains/references/base.md) | stateView | `0xa3c0c9b65bad0b08107aa264b0f3db444b867a71` | `UniswapV4.StateView` |
| [Base](../../../sauce-chains/references/base.md) | universalRouter | `0x6ff5693b99212da76ad316178a184ab56d299b43` | `UniswapV4.UniversalRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | poolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | `UniswapV4.PoolManager` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | positionManager | `0xd88f38f930b7952f2db2432cb002e7abbf3dd869` | `UniswapV4.PositionManager` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | stateView | `0x76fd297e2d437cd7f76d50f01afe6160f86e9990` | `UniswapV4.StateView` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | universalRouter | `0xa51afafe0263b40edaef0df8781ea9aa03e381a3` | `UniswapV4.UniversalRouter` |
| [Celo](../../../sauce-chains/references/celo.md) | poolManager | `0x288dc841A52FCA2707c6947B3A777c5E56cd87BC` | `UniswapV4.PoolManager` |
| [Celo](../../../sauce-chains/references/celo.md) | stateView | `0xbc21f8720babf4b20d195ee5c6e99c52b76f2bfb` | `UniswapV4.StateView` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | poolManager | `0x06380c0e0912312b5150364b9dc4542ba0dbbc85` | `UniswapV4.PoolManager` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | positionManager | `0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd` | `UniswapV4.PositionManager` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | stateView | `0xc3c9e198c735a4b97e3e683f391ccbdd60b69286` | `UniswapV4.StateView` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | universalRouter | `0x94b75331ae8d42c1b61065089b7d48fe14aa73b7` | `UniswapV4.UniversalRouter` |
| [Ink](../../../sauce-chains/references/ink.md) | poolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | `UniswapV4.PoolManager` |
| [Ink](../../../sauce-chains/references/ink.md) | stateView | `0x76fd297e2d437cd7f76d50f01afe6160f86e9990` | `UniswapV4.StateView` |
| [Blast](../../../sauce-chains/references/blast.md) | poolManager | `0x1631559198a9e474033433b2958dabc135ab6446` | `UniswapV4.PoolManager` |
| [Blast](../../../sauce-chains/references/blast.md) | stateView | `0x12a88ae16f46dce4e8b15368008ab3380885df30` | `UniswapV4.StateView` |
| [Zora](../../../sauce-chains/references/zora.md) | poolManager | `0x0575338e4c17006ae181b47900a84404247ca30f` | `UniswapV4.PoolManager` |
| [Zora](../../../sauce-chains/references/zora.md) | stateView | `0x385785af07d63b50d0a0ea57c4ff89d06adf7328` | `UniswapV4.StateView` |

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
