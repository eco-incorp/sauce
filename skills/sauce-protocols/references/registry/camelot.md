<!-- Generated from the SDK's registries. Do not edit. -->

# Camelot (`camelot`)

Native Arbitrum DEX with dual AMM (V2 constant product + V3 concentrated liquidity), custom fee structures, and launchpad features.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Camelot` on arbitrum |
| Chains | arbitrum |
| Document | [camelot.md](../camelot.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `Camelot` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's v2Factory, `0x6EcCab422D763aC031210895C81787E87B43A652`.
  require(Camelot.V2Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v2Factory | `0x6EcCab422D763aC031210895C81787E87B43A652` | `Camelot.V2Factory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v2Router | `0xc873fEcbd354f5A56E00E710B90EF4201db2448d` | `Camelot.V2Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v3Factory | `0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B` | `Camelot.V3Factory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | v3SwapRouter | `0x1F721E2E82F6676FCE4eA07A5958cF098D339e18` | `Camelot.V3SwapRouter` |

## ABI

### `CamelotV2FactoryABI`

`import CamelotV2FactoryABI from "./protocols/camelot/CamelotV2FactoryABI.json";` Speaks for: v2Factory.

- `getPair(address tokenA, address tokenB) view returns (address pair)`

### `CamelotV2PairABI`

`import CamelotV2PairABI from "./protocols/camelot/CamelotV2PairABI.json";`

- `getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint16 _token0FeePercent, uint16 _token1FeePercent)`
- `getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)`
- `stableSwap() view returns (bool)`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `CamelotV2RouterABI`

`import CamelotV2RouterABI from "./protocols/camelot/CamelotV2RouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`

### `CamelotV3FactoryABI`

`import CamelotV3FactoryABI from "./protocols/camelot/CamelotV3FactoryABI.json";` Speaks for: v3Factory.

- `poolByPair(address tokenA, address tokenB) view returns (address pool)`

### `CamelotV3PoolABI`

`import CamelotV3PoolABI from "./protocols/camelot/CamelotV3PoolABI.json";`

- `globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)`
- `liquidity() view returns (uint128)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`
- `token1() view returns (address)`

### `CamelotV3SwapRouterABI`

`import CamelotV3SwapRouterABI from "./protocols/camelot/CamelotV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)`
