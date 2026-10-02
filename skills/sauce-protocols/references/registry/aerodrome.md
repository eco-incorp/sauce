<!-- Generated from the SDK's registries. Do not edit. -->

# Aerodrome (`aerodrome`)

The central trading and liquidity marketplace on Base. Fork of Velodrome with ve(3,3) tokenomics, the largest DEX on Base by TVL.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Aerodrome` on base |
| Chains | base |
| Document | [aerodrome.md](../aerodrome.md): what it is for, how to choose it, its pitfalls |

## In a program

On Base, `Aerodrome` is a namespace: its contracts need no import.

```sauce chain=base
function main() {
  // Base's poolFactory, `0x420DD381b31aEf6683db6B902084cB0FFECe40Da`.
  require(Aerodrome.PoolFactory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | poolFactory | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | `Aerodrome.PoolFactory` |
| [Base](../../../sauce-chains/references/base.md) | router | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | `Aerodrome.Router` |

## ABI

### `AerodromePoolABI`

`import AerodromePoolABI from "./protocols/aerodrome/AerodromePoolABI.json";`

- `getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)`
- `getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)`
- `stable() view returns (bool)`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `AerodromePoolFactoryABI`

`import AerodromePoolFactoryABI from "./protocols/aerodrome/AerodromePoolFactoryABI.json";` Speaks for: poolFactory.

- `getPool(address tokenA, address tokenB, bool stable) view returns (address pool)`

### `AerodromeRouterABI`

`import AerodromeRouterABI from "./protocols/aerodrome/AerodromeRouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
