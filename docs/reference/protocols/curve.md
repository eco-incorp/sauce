<!-- Generated from the SDK's registries. Do not edit. -->

# Curve Finance (`curve`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

StableSwap AMM optimized for low-slippage swaps between pegged assets (stablecoins, wrapped tokens). Uses a specialized invariant that provides near-zero slippage for like-kind assets while maintaining AMM properties.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Curve` on ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |
| Chains | ethereum, optimism, gnosis, polygon, fantom, base, arbitrum, avalanche |

## Key Operations

- **swap**: Exchange tokens within a pool using index-based routing
- **addLiquidity**: Add liquidity with flexible token amounts (can be imbalanced)
- **removeLiquidity**: Remove liquidity proportionally or single-sided

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { CurveStableSwapABI as IStableSwap } from "./abis";

function main(
  poolAddress: Address,
  i: Uint256,
  j: Uint256,
  amountIn: Uint256,
  minAmountOut: Uint256,
): Uint256 {
  const pool = IStableSwap.at(poolAddress);
  return pool.exchange(i, j, amountIn, minAmountOut);
}
```

- `poolAddress`: The specific Curve pool contract address (each pool is a separate contract)
- `i`: Index of the input token within the pool (0-based)
- `j`: Index of the output token within the pool (0-based)
- `amountIn`: Exact amount of input token (in wei)
- `minAmountOut`: Minimum output for slippage protection
- Token indices vary per pool
- For StableSwap-NG pools. 3pool's `exchange` returns nothing, so reading back a `uint256` reverts there: use `CurveThreePoolABI` for 3pool

### addLiquidity

```typescript
import { CurveStableSwapABI as IStableSwap } from "./abis";

function main(poolAddress: Address, amounts: Uint256[], minMintAmount: Uint256): Uint256 {
  const pool = IStableSwap.at(poolAddress);
  return pool.add_liquidity(amounts, minMintAmount);
}
```

- `amounts`: Array of deposit amounts for each token in pool order (can include zeros for imbalanced deposits)
- `minMintAmount`: Minimum LP tokens to receive (slippage protection)
- All deposited tokens must be approved to the pool contract

### removeLiquidity

```typescript
import { CurveStableSwapABI as IStableSwap } from "./abis";

function main(poolAddress: Address, amount: Uint256, minAmounts: Uint256[]): Uint256[] {
  const pool = IStableSwap.at(poolAddress);
  return pool.remove_liquidity(amount, minAmounts);
}
```

- `amount`: Amount of LP tokens to burn
- `minAmounts`: Minimum amounts of each token to receive (array in pool token order)

## Notes

- Pool tokens are indexed (i, j) not addressed; you must know the token order for each pool
- Common pool token orders: 3pool = [DAI(0), USDC(1), USDT(2)]
- `exchange_underlying` is used for metapools or lending pools where tokens wrap underlying assets
- `remove_liquidity_one_coin` is useful for single-sided withdrawal (higher slippage than proportional)
- Each pool is a separate contract; use the AddressProvider or registry to discover pools
- RouterNG enables cross-pool routing for multi-hop swaps across different pools
- Curve excels at stablecoin swaps (much lower slippage than Uniswap for like-kind pairs)
- The `get_virtual_price` never decreases and represents the LP token value growth over time
- Tokens must be ERC20-approved to the pool contract (not a router) for direct pool swaps
- For Router NG swaps, approve tokens to the Router NG contract
- The StableSwap-NG pool interface (plain and meta pools). Classic pools such as 3pool have their own shape: see `CurveThreePoolABI` below.
- 3pool (`threePool` in the addresses), a classic StableSwap pool. Its liquidity arrays are fixed-size, and its state-changing functions return nothing: read amounts as balance changes.
- From a Pot program, `@sauce/router` swaps at the pool directly: `curve(pool, tokenIn, tokenOut, amountIn, i, j, uint256Indices, minOut, recipient)`, with `uint256Indices` `false` for StableSwap and NG pools (`int128` indices) and `true` for CryptoSwap, approves the pool for exactly `amountIn` and calls the 4-argument `exchange` with `minOut` as `min_dy`, without decoding a return (3pool-era pools have none); the allowance ends at zero, and it returns the Pot's balance change, forwarded when the recipient is not the Pot. `tryCurve` catches a failed `exchange`, resets the approval and returns `0n`. The `curveSwap` action is the same call. The Sauce Router's own Curve handler cannot trade a pool whose `exchange` returns nothing, nor a uint256-index pool

## Its names in a program

On Ethereum, `Curve` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's addressProvider, `0x0000000022D53366457F9d5E68Ec105046FC4383`.
  require(Curve.AddressProvider != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Ethereum](../chains/ethereum.md) | crvToken | `0xD533a949740bb3306d119CC777fa900bA034cd52` | `Curve.CrvToken` |
| [Ethereum](../chains/ethereum.md) | routerNG | `0x16C6521Dff6baB339122a0FE25a9116693265353` | `Curve.RouterNG` |
| [Ethereum](../chains/ethereum.md) | threePool | `0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7` | `Curve.ThreePool` |
| [Optimism](../chains/optimism.md) | routerNG | `0x0DCDED3545D565bA3B19E683431381007245d983` | `Curve.RouterNG` |
| [Gnosis](../chains/gnosis.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Polygon](../chains/polygon.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Fantom](../chains/fantom.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Base](../chains/base.md) | routerNG | `0x4f37A9d177470499A2dD084621020b023fcffc1F` | `Curve.RouterNG` |
| [Arbitrum One](../chains/arbitrum.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |
| [Arbitrum One](../chains/arbitrum.md) | routerNG | `0x2191718CD32d02B8E60BAdFFeA33E4B5DD9A0A0D` | `Curve.RouterNG` |
| [Avalanche C-Chain](../chains/avalanche.md) | addressProvider | `0x0000000022D53366457F9d5E68Ec105046FC4383` | `Curve.AddressProvider` |

## ABI

### `CurveAddressProviderABI`

`import CurveAddressProviderABI from "./protocols/curve/CurveAddressProviderABI.json";` Speaks for: addressProvider.

- `get_registry() view returns (address)`
- `get_address(uint256 _id) view returns (address)`

### `CurveRouterNGABI`

`import CurveRouterNGABI from "./protocols/curve/CurveRouterNGABI.json";` Speaks for: routerNG.

- `exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _expected, address[5] _pools) payable returns (uint256)`
- `exchange(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, uint256 _min_dy, address[5] _pools, address _receiver) payable returns (uint256)`
- `get_dy(address[11] _route, uint256[5][5] _swap_params, uint256 _amount, address[5] _pools) view returns (uint256)`

### `CurveStableSwapABI`

`import CurveStableSwapABI from "./protocols/curve/CurveStableSwapABI.json";`

- `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)`
- `exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)`
- `add_liquidity(uint256[] amounts, uint256 min_mint_amount) returns (uint256)`
- `remove_liquidity(uint256 _amount, uint256[] min_amounts) returns (uint256[])`
- `remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 min_amount) returns (uint256)`
- `get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)`
- `get_virtual_price() view returns (uint256)`

### `CurveThreePoolABI`

`import CurveThreePoolABI from "./protocols/curve/CurveThreePoolABI.json";` Speaks for: threePool.

- `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)`
- `add_liquidity(uint256[3] amounts, uint256 min_mint_amount)`
- `remove_liquidity(uint256 _amount, uint256[3] min_amounts)`
- `remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 min_amount)`
- `get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)`
- `get_virtual_price() view returns (uint256)`
