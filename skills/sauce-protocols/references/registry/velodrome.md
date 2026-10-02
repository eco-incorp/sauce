<!-- Generated from the SDK's registries. Do not edit. -->

# Velodrome (`velodrome`)

The central trading and liquidity marketplace on Optimism. Solidly-fork with ve(3,3) tokenomics, supporting both stable and volatile pools.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Velodrome` on optimism |
| Chains | optimism |
| Document | [velodrome.md](../velodrome.md): what it is for, how to choose it, its pitfalls |

## In a program

On Optimism, `Velodrome` is a namespace: its contracts need no import.

```sauce chain=optimism
function main() {
  // Optimism's poolFactory, `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a`.
  require(Velodrome.PoolFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../../../sauce-chains/references/optimism.md) | poolFactory | `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a` | `Velodrome.PoolFactory` |
| [Optimism](../../../sauce-chains/references/optimism.md) | routerV2 | `0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858` | `Velodrome.RouterV2` |

## ABI

### `VelodromePoolABI`

`import VelodromePoolABI from "./protocols/velodrome/VelodromePoolABI.json";`

- `getReserves() view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)`
- `getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)`
- `stable() view returns (bool)`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `VelodromePoolFactoryABI`

`import VelodromePoolFactoryABI from "./protocols/velodrome/VelodromePoolFactoryABI.json";` Speaks for: poolFactory.

- `getPool(address tokenA, address tokenB, bool stable) view returns (address pool)`

### `VelodromeRouterABI`

`import VelodromeRouterABI from "./protocols/velodrome/VelodromeRouterABI.json";` Speaks for: routerV2.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
