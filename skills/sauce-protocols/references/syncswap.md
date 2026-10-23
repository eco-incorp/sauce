# SyncSwap

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

The leading DEX on zkSync Era with optimized gas efficiency for the ZK rollup environment. Supports classic constant product pools and stable pools with native account abstraction support.

## Category

dex | Chains and addresses: [registry/syncswap.md](registry/syncswap.md)

## Key Operations

- **swap**: Swap tokens via path-based routing with encoded swap data and step-based execution

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swap

```typescript
import { SyncSwapRouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  pool: Address,
  tokenIn: Address,
  amountIn: Uint256,
  amountOutMin: Uint256,
  swapData: bytes,
): { token: Address; amount: Uint256 } {
  const router = IRouter.at(routerAddress);
  const zeroAddr = 0x0000000000000000000000000000000000000000;
  return router.swap(
    [
      {
        steps: [{ pool: pool, data: swapData, callback: zeroAddr, callbackData: hex`` }],
        tokenIn: tokenIn,
        amountIn: amountIn,
      },
    ],
    amountOutMin,
    99999999999,
  );
}
```

- `routerAddress`: SyncSwap Router on zkSync (`0x2da10A1e27bF85cEdD8FFb1AbBe97e53391C0295`)
- `pool`: The specific pool contract address to swap through
- `tokenIn`: Input token address
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `swapData`: ABI-encoded bytes containing `(address tokenIn, address recipient, uint8 withdrawMode)`. Withdraw modes: `0` = vault deposit, `1` = withdraw to wallet, `2` = unwrap WETH
- `callback`: Set to zero address for standard swaps (no callback)
- `callbackData`: Set to ` hex`` ` for standard swaps
- Supports multi-step paths: add more entries to the `steps` array for multi-hop

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/syncswap.md](registry/syncswap.md).

## Notes

- Swap data (`data` field in steps) must be ABI-encoded off-chain: `abi.encode(tokenIn, recipient, withdrawMode)`
- `withdrawMode`: `0` = keep in vault (for chaining), `1` = withdraw to user wallet, `2` = unwrap WETH to native ETH
- Each path can have multiple steps (multi-hop), and you can include multiple paths in one transaction
- Steps support callbacks for flash-swap-like patterns (set to zero address for standard swaps)
- Pool addresses must be discovered off-chain (via SyncSwap's factory or API)
- zkSync-only deployment; optimized for zkSync Era's unique execution environment
- Input token must be ERC20-approved to the Router
