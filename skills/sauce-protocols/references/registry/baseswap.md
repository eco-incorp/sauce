<!-- Generated from the SDK's registries. Do not edit. -->

# BaseSwap (`baseswap`)

Base-native DEX with UniV2-style constant product pools. Features yield farming, launchpad, and NFT marketplace.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Baseswap` on base |
| Chains | base |
| Document | [baseswap.md](../baseswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On Base, `Baseswap` is a namespace: its contracts need no import.

```sauce chain=base
function main() {
  // Base's v2Router, `0x327Df1E6de05895d2ab08513aaDD9313Fe505d86`.
  require(Baseswap.V2Router != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Base](../../../sauce-chains/references/base.md) | v2Router | `0x327Df1E6de05895d2ab08513aaDD9313Fe505d86` | `Baseswap.V2Router` |

## ABI

### `BaseSwapRouterABI`

`import BaseSwapRouterABI from "./protocols/baseswap/BaseSwapRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
