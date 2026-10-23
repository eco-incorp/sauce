<!-- Generated from the SDK's registries. Do not edit. -->

# Camelot (`camelot`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Camelot is an exchange: people swap one token for another in its pools. This page lists the chains
> it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Native Arbitrum DEX with dual AMM: V2 constant product pools (with native fee-on-transfer token support) and V3 concentrated liquidity pools (Algebra-based with dynamic fees, no fixed fee tiers).

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Camelot` on arbitrum |
| Chains | arbitrum |

## What it offers

- **swapV2**: Swap via V2 router with fee-on-transfer token support and referral tracking
- **swapV3**: Swap via V3 concentrated liquidity router (Algebra-based, dynamic fees)
- **addLiquidity**: Add liquidity to V2 pools
- **removeLiquidity**: Remove liquidity from V2 pools

## Notes

- V2 router uses `swapExactTokensForTokensSupportingFeeOnTransferTokens` (not standard `swapExactTokensForTokens`) which natively handles rebasing/tax tokens
- V2 router includes a `referrer` parameter for referral fee sharing (unique to Camelot)
- V3 uses Algebra protocol (dynamic fees that adjust based on volatility, NOT fixed fee tiers like Uniswap V3)
- V3 uses `limitSqrtPrice` instead of `sqrtPriceLimitX96`
- Arbitrum-only deployment; the native DEX for Arbitrum ecosystem projects

## Its names in a program

On Arbitrum One, `Camelot` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's v2Factory, `0x6EcCab422D763aC031210895C81787E87B43A652`.
  require(Camelot.V2Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | v2Factory | `0x6EcCab422D763aC031210895C81787E87B43A652` | `Camelot.V2Factory` |
| [Arbitrum One](../chains/arbitrum.md) | v2Router | `0xc873fEcbd354f5A56E00E710B90EF4201db2448d` | `Camelot.V2Router` |
| [Arbitrum One](../chains/arbitrum.md) | v3Factory | `0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B` | `Camelot.V3Factory` |
| [Arbitrum One](../chains/arbitrum.md) | v3SwapRouter | `0x1F721E2E82F6676FCE4eA07A5958cF098D339e18` | `Camelot.V3SwapRouter` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `CamelotV2FactoryABI`

`import CamelotV2FactoryABI from "./protocols/camelot/CamelotV2FactoryABI.json";` Speaks for: v2Factory.

- `getPair(address tokenA, address tokenB) view returns (address pair)`: the address is a `Camelot.V2Pair`

### `CamelotV2PairABI`

`import CamelotV2PairABI from "./protocols/camelot/CamelotV2PairABI.json";`

- `getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint16 _token0FeePercent, uint16 _token1FeePercent)`
- `getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)`
- `stableSwap() view returns (bool)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `CamelotV2RouterABI`

`import CamelotV2RouterABI from "./protocols/camelot/CamelotV2RouterABI.json";` Speaks for: v2Router.

- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`

### `CamelotV3FactoryABI`

`import CamelotV3FactoryABI from "./protocols/camelot/CamelotV3FactoryABI.json";` Speaks for: v3Factory.

- `poolByPair(address tokenA, address tokenB) view returns (address pool)`: the address is a `Camelot.V3Pool`

### `CamelotV3PoolABI`

`import CamelotV3PoolABI from "./protocols/camelot/CamelotV3PoolABI.json";`

- `globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16 timepointIndex, uint8 communityFeeToken0, uint8 communityFeeToken1, bool unlocked)`
- `liquidity() view returns (uint128)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `CamelotV3SwapRouterABI`

`import CamelotV3SwapRouterABI from "./protocols/camelot/CamelotV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice) params) payable returns (uint256 amountOut)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
