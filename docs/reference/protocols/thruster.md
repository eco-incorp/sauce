<!-- Generated from the SDK's registries. Do not edit. -->

# Thruster (`thruster`)

> **In a Sauce program**, swap with `@sauce/router`, one function per venue with a minimum output, and a price limit where the pool takes one ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Blast-native DEX with concentrated liquidity (V3-style) pools. Optimized for Blast's native yield on ETH and USDB, and gas rebate features. Fork of Uniswap V3 architecture.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Thruster` on blast |
| Chains | blast |

## Key Operations

- **swap**: Exact input single-hop swap with fee tier selection via V3 SwapRouter

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Notes

- Standard Uniswap V3 fork interface with identical parameter naming
- Blast-only deployment; the primary concentrated liquidity DEX on Blast
- Leverages Blast's native yield: ETH and USDB in pools automatically earn native yield
- Gas rebates from Blast's gas monetization feature benefit traders
- Input token must be ERC20-approved to the V3 SwapRouter
- For Blast DEX swaps, also consider Fenix (ve(3,3) Solidly-fork) for stable pairs

## Its names in a program

On Blast, `Thruster` is a namespace: its contracts need no import.

```ts
function main() {
  // Blast's v3SwapRouter, `0x337827814155ECBf24D20231fCA4444F530c0555`.
  require(Thruster.V3SwapRouter != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Blast](../chains/blast.md) | v3SwapRouter | `0x337827814155ECBf24D20231fCA4444F530c0555` | `Thruster.V3SwapRouter` |

## ABI

### `ThrusterV3SwapRouterABI`

`import ThrusterV3SwapRouterABI from "./protocols/thruster/ThrusterV3SwapRouterABI.json";` Speaks for: v3SwapRouter.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
