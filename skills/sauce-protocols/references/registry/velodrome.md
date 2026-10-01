<!-- Generated from the SDK's registries. Do not edit. -->

# Velodrome (`velodrome`)

The central trading and liquidity marketplace on Optimism. Solidly-fork with ve(3,3) tokenomics, supporting both stable and volatile pools.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | optimism |
| Document | [velodrome.md](../velodrome.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Optimism's poolFactory):

```sauce chain=optimism
import VelodromePoolFactoryABI from "./protocols/velodrome/VelodromePoolFactoryABI.json";

const POOL_FACTORY = 0xF1046053aa5682b4F9a81b5481394DA16BE5FF5an;

function main() {
  const bound = VelodromePoolFactoryABI.at(POOL_FACTORY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../../../sauce-chains/references/optimism.md) | poolFactory | `0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a` | `VelodromePoolFactoryABI.at(0xF1046053aa5682b4F9a81b5481394DA16BE5FF5an)` |
| [Optimism](../../../sauce-chains/references/optimism.md) | routerV2 | `0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858` | `VelodromeRouterABI.at(0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858n)` |

## ABI

### `VelodromePoolFactoryABI`

`import VelodromePoolFactoryABI from "./protocols/velodrome/VelodromePoolFactoryABI.json";` Speaks for: poolFactory.

- `getPool(address tokenA, address tokenB, bool stable) view returns (address pool)`

### `VelodromeRouterABI`

`import VelodromeRouterABI from "./protocols/velodrome/VelodromeRouterABI.json";` Speaks for: routerV2.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
