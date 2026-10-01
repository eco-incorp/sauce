<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V4 (`uniswap-v4`)

Singleton AMM with hooks architecture enabling custom pool logic, flash accounting, and native ETH support.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV4` on ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche, blast |
| Chains | ethereum, optimism, bsc, polygon, monad, arc, base, arbitrum, avalanche, blast |
| Document | [uniswap-v4.md](../uniswap-v4.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `UniswapV4` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's poolManager, `0x000000000004444c5dc75cB358380D2e3dE08A90`.
  require(UniswapV4.PoolManager != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | poolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` | `UniswapV4.PoolManager` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | positionManager | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` | `UniswapV4.PositionManager` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | universalRouter | `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` | `UniswapV4.UniversalRouter` |
| [Optimism](../../../sauce-chains/references/optimism.md) | poolManager | `0x9a13f98cb987694c9f086b1f5eb990eea8264ec3` | `UniswapV4.PoolManager` |
| [Optimism](../../../sauce-chains/references/optimism.md) | positionManager | `0x3c3ea4b57a46241e54610e5f022e5c45859a1017` | `UniswapV4.PositionManager` |
| [Optimism](../../../sauce-chains/references/optimism.md) | universalRouter | `0x851116d9223fabed8e56c0e6b8ad0c31d98b3507` | `UniswapV4.UniversalRouter` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | poolManager | `0x28e2ea090877bf75740558f6bfb36a5ffee9e9df` | `UniswapV4.PoolManager` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | positionManager | `0x7a4a5c919ae2541aed11041a1aeee68f1287f95b` | `UniswapV4.PositionManager` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | universalRouter | `0x1906c1d672b88cd1b9ac7593301ca990f94eae07` | `UniswapV4.UniversalRouter` |
| [Polygon](../../../sauce-chains/references/polygon.md) | poolManager | `0x67366782805870060151383f4bbff9dab53e5cd6` | `UniswapV4.PoolManager` |
| [Polygon](../../../sauce-chains/references/polygon.md) | positionManager | `0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9` | `UniswapV4.PositionManager` |
| [Polygon](../../../sauce-chains/references/polygon.md) | universalRouter | `0x1095692a6237d83c6a72f3f5efedb9a670c49223` | `UniswapV4.UniversalRouter` |
| [Monad](../../../sauce-chains/references/monad.md) | poolManager | `0x188d586ddcf52439676ca21a244753fa19f9ea8e` | `UniswapV4.PoolManager` |
| [Monad](../../../sauce-chains/references/monad.md) | positionManager | `0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016` | `UniswapV4.PositionManager` |
| [Monad](../../../sauce-chains/references/monad.md) | universalRouter | `0x0d97dc33264bfc1c226207428a79b26757fb9dc3` | `UniswapV4.UniversalRouter` |
| [Arc](../../../sauce-chains/references/arc.md) | poolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | `UniswapV4.PoolManager` |
| [Arc](../../../sauce-chains/references/arc.md) | positionManager | `0x6049c9a0e26405C0985f9E3685C87d0aE917f82B` | `UniswapV4.PositionManager` |
| [Arc](../../../sauce-chains/references/arc.md) | universalRouter | `0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1` | `UniswapV4.UniversalRouter` |
| [Base](../../../sauce-chains/references/base.md) | poolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` | `UniswapV4.PoolManager` |
| [Base](../../../sauce-chains/references/base.md) | positionManager | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` | `UniswapV4.PositionManager` |
| [Base](../../../sauce-chains/references/base.md) | universalRouter | `0x6ff5693b99212da76ad316178a184ab56d299b43` | `UniswapV4.UniversalRouter` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | poolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | `UniswapV4.PoolManager` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | positionManager | `0xd88f38f930b7952f2db2432cb002e7abbf3dd869` | `UniswapV4.PositionManager` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | universalRouter | `0xa51afafe0263b40edaef0df8781ea9aa03e381a3` | `UniswapV4.UniversalRouter` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | poolManager | `0x06380c0e0912312b5150364b9dc4542ba0dbbc85` | `UniswapV4.PoolManager` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | positionManager | `0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd` | `UniswapV4.PositionManager` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | universalRouter | `0x94b75331ae8d42c1b61065089b7d48fe14aa73b7` | `UniswapV4.UniversalRouter` |
| [Blast](../../../sauce-chains/references/blast.md) | poolManager | `0x1631559198a9e474033433b2958dabc135ab6446` | `UniswapV4.PoolManager` |

## ABI

### `UniswapV4PoolManagerABI`

`import UniswapV4PoolManagerABI from "./protocols/uniswap-v4/UniswapV4PoolManagerABI.json";` Speaks for: poolManager.

- `initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) returns (int24 tick)`
- `swap((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, bytes hookData) returns (int256 delta)`
- `modifyLiquidity((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt) params, bytes hookData) returns (int256 delta, int256 feeDelta)`

### `UniswapV4PositionManagerABI`

`import UniswapV4PositionManagerABI from "./protocols/uniswap-v4/UniswapV4PositionManagerABI.json";` Speaks for: positionManager.

- `modifyLiquidities(bytes unlockData, uint256 deadline) payable`

### `UniswapV4UniversalRouterABI`

`import UniswapV4UniversalRouterABI from "./protocols/uniswap-v4/UniswapV4UniversalRouterABI.json";` Speaks for: universalRouter.

- `execute(bytes commands, bytes[] inputs, uint256 deadline) payable`
- `execute(bytes commands, bytes[] inputs) payable`
