<!-- Generated from the SDK's registries. Do not edit. -->

# Camelot (`camelot`)

> **In a Sauce program**, swap with `@sauce/router`, one function per venue with a minimum output, and a price limit where the pool takes one ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Native Arbitrum DEX with dual AMM: V2 constant product pools (with native fee-on-transfer token support) and V3 concentrated liquidity pools (Algebra-based with dynamic fees, no fixed fee tiers).

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Camelot` on arbitrum |
| Chains | arbitrum |

## Key Operations

- **swapV2**: Swap via V2 router with fee-on-transfer token support and referral tracking
- **swapV3**: Swap via V3 concentrated liquidity router (Algebra-based, dynamic fees)
- **addLiquidity**: Add liquidity to V2 pools
- **removeLiquidity**: Remove liquidity from V2 pools

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swapV2

```typescript
import { CamelotV2RouterABI as ICamelotRouter } from "./abis";

function main(
  routerAddress: Address,
  path: Address[],
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
  referrer: Address,
): Uint256 {
  const router = ICamelotRouter.at(routerAddress);
  router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
    amountIn,
    amountOutMin,
    path,
    recipient,
    referrer,
    99999999999,
  );
  return 1;
}
```

- `routerAddress`: Camelot V2 Router on Arbitrum
- `path`: Ordered token address array for the swap route
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- `referrer`: Address of the referrer for fee sharing (use zero address if none)
- This method supports fee-on-transfer (rebasing) tokens natively

### swapV3

```typescript
import { CamelotV3SwapRouterABI as ICamelotV3Router } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ICamelotV3Router.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    recipient: recipient,
    deadline: 99999999999,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    limitSqrtPrice: 0,
  });
}
```

- `routerAddress`: Camelot V3 SwapRouter on Arbitrum
- No `fee` parameter needed: Camelot V3 uses dynamic fees (Algebra-based), not fixed fee tiers
- `limitSqrtPrice`: `0` in this template, no price limit, so `amountOutMin` is the only bound. Camelot V3 is an Algebra pool, which the Sauce Router's `swapV3` drives with a real limit ([`@sauce/router`](../../api/router.md))

### addLiquidity

```typescript
import { CamelotV2RouterABI as ICamelotRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
  amountADesired: Uint256,
  amountBDesired: Uint256,
  amountAMin: Uint256,
  amountBMin: Uint256,
  recipient: Address,
): { amountA: Uint256; amountB: Uint256; liquidity: Uint256 } {
  const router = ICamelotRouter.at(routerAddress);
  return router.addLiquidity(
    tokenA,
    tokenB,
    amountADesired,
    amountBDesired,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- Both tokens must be approved to the V2 router

### removeLiquidity

```typescript
import { CamelotV2RouterABI as ICamelotRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
  liquidity: Uint256,
  amountAMin: Uint256,
  amountBMin: Uint256,
  recipient: Address,
): { amountA: Uint256; amountB: Uint256 } {
  const router = ICamelotRouter.at(routerAddress);
  return router.removeLiquidity(
    tokenA,
    tokenB,
    liquidity,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- LP token must be approved to the V2 router

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
  require(Camelot.V2Factory != 0n);
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
