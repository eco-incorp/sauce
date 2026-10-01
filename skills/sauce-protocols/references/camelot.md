# Camelot

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Native Arbitrum DEX with dual AMM: V2 constant product pools (with native fee-on-transfer token support) and V3 concentrated liquidity pools (Algebra-based with dynamic fees, no fixed fee tiers).

## Category

dex | Chains: Arbitrum

## Key Operations

- **swapV2**: Swap via V2 router with fee-on-transfer token support and referral tracking
- **swapV3**: Swap via V3 concentrated liquidity router (Algebra-based, dynamic fees)
- **addLiquidity**: Add liquidity to V2 pools
- **removeLiquidity**: Remove liquidity from V2 pools

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  swapV2,
  swapV3,
  addLiquidity,
  removeLiquidity,
} from "@eco-incorp/sauce/protocols/camelot";
```

## SauceScript Examples

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
- `limitSqrtPrice`: `0` in this template, no price limit, so `amountOutMin` is the only bound. Camelot V3 is an Algebra pool, which the Sauce Router's `swapV3` drives with a real limit (`sauce-swaps`)

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

## Key Addresses

| Chain    | Contract      | Address                                      |
| -------- | ------------- | -------------------------------------------- |
| Arbitrum | V2 Factory    | `0x6EcCab422D763aC031210895C81787E87B43A652` |
| Arbitrum | V2 Router     | `0xc873fEcbd354f5A56E00E710B90EF4201db2448d` |
| Arbitrum | V3 Factory    | `0x1a3c9B1d2F0529D97f2afC5136Cc23e58f1FD35B` |
| Arbitrum | V3 SwapRouter | `0x1F721E2E82F6676FCE4eA07A5958cF098D339e18` |

## ABI Methods

### CamelotV2RouterABI

- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, address referrer, uint256 deadline)` - V2 swap with fee-on-transfer token support and referral. Note: no return value
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add V2 LP
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB)` - Remove V2 LP

### CamelotV3SwapRouterABI

- `exactInputSingle(tuple(address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 limitSqrtPrice)) -> uint256 amountOut` - V3 concentrated liquidity swap with dynamic fees

## Notes

- V2 router uses `swapExactTokensForTokensSupportingFeeOnTransferTokens` (not standard `swapExactTokensForTokens`) which natively handles rebasing/tax tokens
- V2 router includes a `referrer` parameter for referral fee sharing (unique to Camelot)
- V3 uses Algebra protocol (dynamic fees that adjust based on volatility, NOT fixed fee tiers like Uniswap V3)
- V3 uses `limitSqrtPrice` instead of `sqrtPriceLimitX96`
- Arbitrum-only deployment; the native DEX for Arbitrum ecosystem projects
