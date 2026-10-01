# Thruster

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Blast-native DEX with concentrated liquidity (V3-style) pools. Optimized for Blast's native yield on ETH and USDB, and gas rebate features. Fork of Uniswap V3 architecture.

## Category

dex | Chains: Blast

## Key Operations

- **swap**: Exact input single-hop swap with fee tier selection via V3 SwapRouter

## SDK Usage

```typescript
import { protocolInfo, deployments, swap } from "@eco-incorp/sauce/protocols/thruster";
```

## SauceScript Examples

### swap

```typescript
import { ThrusterV3SwapRouterABI as ISwapRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ISwapRouter.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: recipient,
    deadline: 99999999999,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0,
  });
}
```

- `routerAddress`: Thruster V3 SwapRouter on Blast (`0x337827814155ECBf24D20231fCA4444F530c0555`)
- `tokenIn` / `tokenOut`: Input and output token addresses
- `fee`: Pool fee tier (standard Uniswap V3 tiers: `500`, `3000`, `10000`)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- `sqrtPriceLimitX96`: `0` in this template, no price limit, so `amountOutMin` is the only bound

## Key Addresses

| Chain | Contract      | Address                                      |
| ----- | ------------- | -------------------------------------------- |
| Blast | V3 SwapRouter | `0x337827814155ECBf24D20231fCA4444F530c0555` |

## ABI Methods

### ThrusterV3SwapRouterABI

- `exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) -> uint256 amountOut` - Single-hop exact input swap

## Notes

- Standard Uniswap V3 fork interface with identical parameter naming
- Blast-only deployment; the primary concentrated liquidity DEX on Blast
- Leverages Blast's native yield: ETH and USDB in pools automatically earn native yield
- Gas rebates from Blast's gas monetization feature benefit traders
- Input token must be ERC20-approved to the V3 SwapRouter
- For Blast DEX swaps, also consider Fenix (ve(3,3) Solidly-fork) for stable pairs
