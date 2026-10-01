# Curve Finance

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

StableSwap AMM optimized for low-slippage swaps between pegged assets (stablecoins, wrapped tokens). Uses a specialized invariant that provides near-zero slippage for like-kind assets while maintaining AMM properties.

## Category

dex | Chains and addresses: [registry/curve.md](registry/curve.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/curve.md](registry/curve.md).

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
