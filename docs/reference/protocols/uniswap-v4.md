<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V4 (`uniswap-v4`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Singleton AMM with hooks architecture enabling custom pool logic, flash accounting, and native ETH support. All pools share a single PoolManager contract for gas savings on multi-hop swaps.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV4` on ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora |
| Chains | ethereum, optimism, bsc, unichain, polygon, monad, arc, base, arbitrum, celo, avalanche, ink, blast, zora |

## When to use it

- Every pool lives in one PoolManager, keyed by `(currency0, currency1, fee, tickSpacing,
hooks)`. A pool can attach a hook contract that runs around swaps and liquidity changes, and a
  currency of `0x0` is the native coin.
- A Sauce program swaps a pool with `@sauce/router`'s `uniswapV4`, with a price limit; no
  UniversalRouter commands are needed.

## Pitfalls for a program

- Exact input is a **negative** `amountSpecified` (`-amount`), the reverse of V3's pool.
  `uniswapV4` takes a positive `amountIn` and passes `-amountIn` itself.
- A hook can change a pool's behaviour and fee: use hookless keys (`hooks: 0`) unless you have
  reviewed the hook.
- A protocol fee can apply on top of the LP fee; both are in the pool's state
  ([the distributed swap](../../guides/distributed-swap.md) reads them).
- Anyone can initialize a key: a pool can exist with no liquidity at a stale price. Read its
  liquidity before trusting its price.
- A native-coin pool (`currency0` of `0x0`) is a different pair from the WETH pools.

## In a Sauce program

One guarded swap on the hookless 0.05% WETH/USDC pool:

```ts
import { uniswapV4 } from "@sauce/router";

function main(amountIn: Uint256, sqrtPriceLimitX96: Uint256, minOut: Uint256, recipient: Address) {
  const self = ctx.self();
  const before = WETH.balanceOf(self);
  uniswapV4(UniswapV4.PoolManager, WETH, USDC, amountIn, 500, 10, 0, sqrtPriceLimitX96, minOut, recipient);
  const unspent = amountIn - (before - WETH.balanceOf(self));
  if (unspent > 0) {
    WETH.transfer(recipient, unspent);
  }
}
```

`uniswapV4` builds the key from the two tokens in sort order with the fee (`500`), tick spacing
(`10`) and hooks (`0`, none), pays `recipient` and reverts below `minOut`. The WETH the pool did
not take before the price limit goes back to `recipient` too.

## Key Operations

- **swap**: Execute a swap through the UniversalRouter using command-based encoding
- **addLiquidity**: Modify liquidity positions through the PositionManager
- **removeLiquidity**: Decrease or remove liquidity positions through the PositionManager

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swap

```typescript
import { UniswapV4UniversalRouterABI as IUniversalRouter } from "./abis";

function main(routerAddress: Address, commands: bytes, inputs: bytes[]): Uint256 {
  const router = IUniversalRouter.at(routerAddress);
  router.execute(commands, inputs, 99999999999);
  return 1;
}
```

- `routerAddress`: UniversalRouter address for the target chain
- `commands`: Encoded bytes of command IDs defining the sequence of operations (each byte = one command)
- `inputs`: Encoded bytes array of ABI-encoded parameters for each command
- Commands and inputs must be pre-encoded off-chain; the router decodes and executes sequentially

### addLiquidity

```typescript
import { UniswapV4PositionManagerABI as IPositionManager } from "./abis";

function main(positionManagerAddress: Address, unlockData: bytes): Uint256 {
  const pm = IPositionManager.at(positionManagerAddress);
  pm.modifyLiquidities(unlockData, 99999999999);
  return 1;
}
```

- `positionManagerAddress`: PositionManager address for the target chain
- `unlockData`: ABI-encoded liquidity modification data including pool key, tick range, and amounts
- Data must be pre-encoded off-chain with the position parameters

### removeLiquidity

```typescript
import { UniswapV4PositionManagerABI as IPositionManager } from "./abis";

function main(positionManagerAddress: Address, unlockData: bytes): Uint256 {
  const pm = IPositionManager.at(positionManagerAddress);
  pm.modifyLiquidities(unlockData, 99999999999);
  return 1;
}
```

- Same interface as addLiquidity but with negative liquidityDelta in the encoded data

## Notes

- V4 uses a singleton architecture: ALL pools live in a single PoolManager contract, saving gas on multi-hop swaps
- Hooks: each pool can attach a custom hooks contract that intercepts before/after swap and liquidity events
- Pool key: `(currency0, currency1, fee, tickSpacing, hooks)` uniquely identifies a pool
- `currency0` = address(0) means native ETH; V4 supports native ETH directly (no WETH wrapping needed)
- `zeroForOne`: true = swap currency0 for currency1; false = swap currency1 for currency0
- `amountSpecified`: negative = exact input; positive = exact output (the reverse of Uniswap V3's pool `swap`)
- Flash accounting: V4 uses transient storage for balance tracking within a transaction, settling at the end
- Commands/inputs for the UniversalRouter must be constructed off-chain; this is more complex than V3 but more powerful
- V4 is the newest Uniswap version; use it for advanced pool logic (custom hooks) or when gas efficiency on multi-hop matters most
- From a Pot program, `@sauce/router`'s `uniswapV4(poolManager, tokenIn, tokenOut, amountIn, fee, tickSpacing, hooks, sqrtPriceLimitX96, minOut, recipient)` swaps one pool through the Pot's Sauce Router, which unlocks the PoolManager, swaps, takes the output and settles the input from the Pot — no UniversalRouter and no approval. The pool key is `tokenIn` and `tokenOut` in sort order (native ETH, the zero address, first) with `fee`, `tickSpacing` and `hooks`; the function passes `-amountIn`, exact input, and returns the amount out. The `uniswapV4Swap` action is the same call
- On Arc (5042) the PositionManager's `WETH9()` is a stub that always reverts with `UnsupportedProtocolError()`. Arc's native coin is USDC at 18 decimals, so a pool keyed on `address(0)` is native USDC, a different currency from the 6-decimal ERC-20 `0x3600000000000000000000000000000000000000` over the same balance

## Its names in a program

On Ethereum, `UniswapV4` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's poolManager, `0x000000000004444c5dc75cB358380D2e3dE08A90`.
  require(UniswapV4.PoolManager != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | poolManager | `0x000000000004444c5dc75cB358380D2e3dE08A90` | `UniswapV4.PoolManager` |
| [Ethereum](../chains/ethereum.md) | positionManager | `0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e` | `UniswapV4.PositionManager` |
| [Ethereum](../chains/ethereum.md) | stateView | `0x7ffe42c4a5deea5b0fec41c94c136cf115597227` | `UniswapV4.StateView` |
| [Ethereum](../chains/ethereum.md) | universalRouter | `0x66a9893cc07d91d95644aedd05d03f95e1dba8af` | `UniswapV4.UniversalRouter` |
| [Optimism](../chains/optimism.md) | poolManager | `0x9a13f98cb987694c9f086b1f5eb990eea8264ec3` | `UniswapV4.PoolManager` |
| [Optimism](../chains/optimism.md) | positionManager | `0x3c3ea4b57a46241e54610e5f022e5c45859a1017` | `UniswapV4.PositionManager` |
| [Optimism](../chains/optimism.md) | stateView | `0xc18a3169788f4f75a170290584eca6395c75ecdb` | `UniswapV4.StateView` |
| [Optimism](../chains/optimism.md) | universalRouter | `0x851116d9223fabed8e56c0e6b8ad0c31d98b3507` | `UniswapV4.UniversalRouter` |
| [BNB Chain](../chains/bsc.md) | poolManager | `0x28e2ea090877bf75740558f6bfb36a5ffee9e9df` | `UniswapV4.PoolManager` |
| [BNB Chain](../chains/bsc.md) | positionManager | `0x7a4a5c919ae2541aed11041a1aeee68f1287f95b` | `UniswapV4.PositionManager` |
| [BNB Chain](../chains/bsc.md) | stateView | `0xd13dd3d6e93f276fafc9db9e6bb47c1180aee0c4` | `UniswapV4.StateView` |
| [BNB Chain](../chains/bsc.md) | universalRouter | `0x1906c1d672b88cd1b9ac7593301ca990f94eae07` | `UniswapV4.UniversalRouter` |
| [Unichain](../chains/unichain.md) | poolManager | `0x1f98400000000000000000000000000000000004` | `UniswapV4.PoolManager` |
| [Unichain](../chains/unichain.md) | stateView | `0x86e8631a016f9068c3f085faf484ee3f5fdee8f2` | `UniswapV4.StateView` |
| [Polygon](../chains/polygon.md) | poolManager | `0x67366782805870060151383f4bbff9dab53e5cd6` | `UniswapV4.PoolManager` |
| [Polygon](../chains/polygon.md) | positionManager | `0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9` | `UniswapV4.PositionManager` |
| [Polygon](../chains/polygon.md) | stateView | `0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a` | `UniswapV4.StateView` |
| [Polygon](../chains/polygon.md) | universalRouter | `0x1095692a6237d83c6a72f3f5efedb9a670c49223` | `UniswapV4.UniversalRouter` |
| [Monad](../chains/monad.md) | poolManager | `0x188d586ddcf52439676ca21a244753fa19f9ea8e` | `UniswapV4.PoolManager` |
| [Monad](../chains/monad.md) | positionManager | `0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016` | `UniswapV4.PositionManager` |
| [Monad](../chains/monad.md) | stateView | `0x77395f3b2e73ae90843717371294fa97cc419d64` | `UniswapV4.StateView` |
| [Monad](../chains/monad.md) | universalRouter | `0x0d97dc33264bfc1c226207428a79b26757fb9dc3` | `UniswapV4.UniversalRouter` |
| [Arc](../chains/arc.md) | poolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | `UniswapV4.PoolManager` |
| [Arc](../chains/arc.md) | positionManager | `0x6049c9a0e26405C0985f9E3685C87d0aE917f82B` | `UniswapV4.PositionManager` |
| [Arc](../chains/arc.md) | stateView | `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b` | `UniswapV4.StateView` |
| [Arc](../chains/arc.md) | universalRouter | `0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1` | `UniswapV4.UniversalRouter` |
| [Base](../chains/base.md) | poolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` | `UniswapV4.PoolManager` |
| [Base](../chains/base.md) | positionManager | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` | `UniswapV4.PositionManager` |
| [Base](../chains/base.md) | stateView | `0xa3c0c9b65bad0b08107aa264b0f3db444b867a71` | `UniswapV4.StateView` |
| [Base](../chains/base.md) | universalRouter | `0x6ff5693b99212da76ad316178a184ab56d299b43` | `UniswapV4.UniversalRouter` |
| [Arbitrum One](../chains/arbitrum.md) | poolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | `UniswapV4.PoolManager` |
| [Arbitrum One](../chains/arbitrum.md) | positionManager | `0xd88f38f930b7952f2db2432cb002e7abbf3dd869` | `UniswapV4.PositionManager` |
| [Arbitrum One](../chains/arbitrum.md) | stateView | `0x76fd297e2d437cd7f76d50f01afe6160f86e9990` | `UniswapV4.StateView` |
| [Arbitrum One](../chains/arbitrum.md) | universalRouter | `0xa51afafe0263b40edaef0df8781ea9aa03e381a3` | `UniswapV4.UniversalRouter` |
| [Celo](../chains/celo.md) | poolManager | `0x288dc841A52FCA2707c6947B3A777c5E56cd87BC` | `UniswapV4.PoolManager` |
| [Celo](../chains/celo.md) | stateView | `0xbc21f8720babf4b20d195ee5c6e99c52b76f2bfb` | `UniswapV4.StateView` |
| [Avalanche C-Chain](../chains/avalanche.md) | poolManager | `0x06380c0e0912312b5150364b9dc4542ba0dbbc85` | `UniswapV4.PoolManager` |
| [Avalanche C-Chain](../chains/avalanche.md) | positionManager | `0xb74b1f14d2754acfcbbe1a221023a5cf50ab8acd` | `UniswapV4.PositionManager` |
| [Avalanche C-Chain](../chains/avalanche.md) | stateView | `0xc3c9e198c735a4b97e3e683f391ccbdd60b69286` | `UniswapV4.StateView` |
| [Avalanche C-Chain](../chains/avalanche.md) | universalRouter | `0x94b75331ae8d42c1b61065089b7d48fe14aa73b7` | `UniswapV4.UniversalRouter` |
| [Ink](../chains/ink.md) | poolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | `UniswapV4.PoolManager` |
| [Ink](../chains/ink.md) | stateView | `0x76fd297e2d437cd7f76d50f01afe6160f86e9990` | `UniswapV4.StateView` |
| [Blast](../chains/blast.md) | poolManager | `0x1631559198a9e474033433b2958dabc135ab6446` | `UniswapV4.PoolManager` |
| [Blast](../chains/blast.md) | stateView | `0x12a88ae16f46dce4e8b15368008ab3380885df30` | `UniswapV4.StateView` |
| [Zora](../chains/zora.md) | poolManager | `0x0575338e4c17006ae181b47900a84404247ca30f` | `UniswapV4.PoolManager` |
| [Zora](../chains/zora.md) | stateView | `0x385785af07d63b50d0a0ea57c4ff89d06adf7328` | `UniswapV4.StateView` |

## ABI

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
- `poolManager() view returns (address)`

### `UniswapV4UniversalRouterABI`

`import UniswapV4UniversalRouterABI from "./protocols/uniswap-v4/UniswapV4UniversalRouterABI.json";` Speaks for: universalRouter.

- `execute(bytes commands, bytes[] inputs, uint256 deadline) payable`
- `execute(bytes commands, bytes[] inputs) payable`
