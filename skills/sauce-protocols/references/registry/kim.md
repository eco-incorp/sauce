<!-- Generated from the SDK's registries. Do not edit. -->

# Kim (`kim`)

Mode-native DEX with UniV2-style constant product pools. The primary trading venue on Mode Network with farming incentives.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | mode |
| Document | [kim.md](../kim.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Mode's v2Router):

```sauce chain=mode
import KimRouterABI from "./protocols/kim/KimRouterABI.json";

const V2_ROUTER = 0x5D61c537393cf21893BE619E36fC94cd73C77DD3n;

function main() {
  const bound = KimRouterABI.at(V2_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Mode](../../../sauce-chains/references/mode.md) | v2Router | `0x5D61c537393cf21893BE619E36fC94cd73C77DD3` | `KimRouterABI.at(0x5D61c537393cf21893BE619E36fC94cd73C77DD3n)` |

## ABI

### `KimRouterABI`

`import KimRouterABI from "./protocols/kim/KimRouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
