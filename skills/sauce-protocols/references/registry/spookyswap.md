<!-- Generated from the SDK's registries. Do not edit. -->

# SpookySwap (`spookyswap`)

DEX on Fantom with UniV2-style constant product pools. Features yield farming, bridges, and limit orders.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Spookyswap` on fantom |
| Chains | fantom |
| Document | [spookyswap.md](../spookyswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On Fantom, `Spookyswap` is a namespace: its contracts need no import.

```sauce chain=fantom
function main() {
  // Fantom's v2Router, `0xF491e7B69E4244ad4002BC14e878a34207E38c29`.
  require(Spookyswap.V2Router != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Fantom](../../../sauce-chains/references/fantom.md) | v2Router | `0xF491e7B69E4244ad4002BC14e878a34207E38c29` | `Spookyswap.V2Router` |

## ABI

### `SpookySwapRouterABI`

`import SpookySwapRouterABI from "./protocols/spookyswap/SpookySwapRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
