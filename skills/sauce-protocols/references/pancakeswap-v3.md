# PancakeSwap V3

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Concentrated liquidity AMM on BNB Chain and multiple EVM chains. Built on Uniswap V3 architecture with custom fee tiers and farming integration via the SmartRouter.

## Category

dex | Chains and addresses: [registry/pancakeswap-v3.md](registry/pancakeswap-v3.md)

## Key Operations

- **swap**: Exact input single-hop swap with fee tier selection via SmartRouter

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { PancakeSwapV3SmartRouterABI as ISmartRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ISmartRouter.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: recipient,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0,
  });
}
```

- `routerAddress`: PancakeSwap V3 SmartRouter address for the target chain
- `tokenIn` / `tokenOut`: Input and output token addresses
- `fee`: Pool fee tier in hundredths of a bip. Common: `100` (0.01%), `500` (0.05%), `2500` (0.25%), `10000` (1%)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- `sqrtPriceLimitX96`: `0` in this template, no price limit, so `amountOutMin` is the only bound. Through the Sauce Router, set a real limit (`sauce-swaps`)
- Note: SmartRouter does NOT include a `deadline` param in the struct (unlike Uniswap V3)

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/pancakeswap-v3.md](registry/pancakeswap-v3.md).

## Notes

- Fee tiers may differ from Uniswap V3; PancakeSwap includes a 2500 (0.25%) tier
- SmartRouter struct does NOT include `deadline` (unlike Uniswap V3's router)
- Factory address is the same across all chains; SmartRouter addresses vary
- NFPM address is consistent across all chains (`0x46A15B...`)
- Swapping through the SmartRouter needs the input token approved to it; the Sauce Router needs no approval, since its callback pays the pool from the Pot (`sauce-swaps`)
- Both tokens must be ERC20-approved to the NFPM for minting positions
- Prefer V3 over V2 for major pairs on BSC for better capital efficiency
