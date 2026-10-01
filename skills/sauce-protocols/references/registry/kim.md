<!-- Generated from the SDK's registries. Do not edit. -->

# Kim (`kim`)

Mode-native DEX with UniV2-style constant product pools. The primary trading venue on Mode Network with farming incentives.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Kim` on mode |
| Chains | mode |
| Document | [kim.md](../kim.md): what it is for, how to choose it, its pitfalls |

## In a program

On Mode, `Kim` is a namespace: its contracts need no import.

```sauce chain=mode
function main() {
  // Mode's v2Router, `0x5D61c537393cf21893BE619E36fC94cd73C77DD3`.
  require(Kim.V2Router != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Mode](../../../sauce-chains/references/mode.md) | v2Router | `0x5D61c537393cf21893BE619E36fC94cd73C77DD3` | `Kim.V2Router` |

## ABI

### `KimRouterABI`

`import KimRouterABI from "./protocols/kim/KimRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
