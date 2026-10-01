<!-- Generated from the SDK's registries. Do not edit. -->

# Camelot (`camelot`)

Native Arbitrum DEX with dual AMM (V2 constant product + V3 concentrated liquidity), custom fee structures, and launchpad features.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arbitrum |
| Document | [camelot.md](../camelot.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Arbitrum One's v2Router):

```sauce chain=arbitrum
import CamelotV2RouterABI from "./protocols/camelot/CamelotV2RouterABI.json";

const V2_ROUTER = 0xc873fEcbd354f5A56E00E710B90EF4201db2448dn;

function main() {
  const bound = CamelotV2RouterABI.at(V2_ROUTER);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v2Factory | `0x6EcCab422D763aC031210895C81787E87B43A652` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v2Router | `0xc873fEcbd354f5A56E00E710B90EF4201db2448d` | `CamelotV2RouterABI.at(0xc873fEcbd354f5A56E00E710B90EF4201db2448dn)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v3Factory | `0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v3SwapRouter | `0x1F721E2E82F6676FCE4eA07A5958cF098D339e18` | `CamelotV3SwapRouterABI.at(0x1F721E2E82F6676FCE4eA07A5958cF098D339e18n)` |

## ABI

### `CamelotV2RouterABI`

`import CamelotV2RouterABI from "./protocols/camelot/CamelotV2RouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`

### `CamelotV3SwapRouterABI`

`import CamelotV3SwapRouterABI from "./protocols/camelot/CamelotV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)`
