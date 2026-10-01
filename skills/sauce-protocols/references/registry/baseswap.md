<!-- Generated from the SDK's registries. Do not edit. -->

# BaseSwap (`baseswap`)

Base-native DEX with UniV2-style constant product pools. Features yield farming, launchpad, and NFT marketplace.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | base |
| Document | [baseswap.md](../baseswap.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Base's v2Router):

```sauce chain=base
import BaseSwapRouterABI from "./protocols/baseswap/BaseSwapRouterABI.json";

const V2_ROUTER = 0x327Df1E6de05895d2ab08513aaDD9313Fe505d86n;

function main() {
  const bound = BaseSwapRouterABI.at(V2_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | v2Router | `0x327Df1E6de05895d2ab08513aaDD9313Fe505d86` | `BaseSwapRouterABI.at(0x327Df1E6de05895d2ab08513aaDD9313Fe505d86n)` |

## ABI

### `BaseSwapRouterABI`

`import BaseSwapRouterABI from "./protocols/baseswap/BaseSwapRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
