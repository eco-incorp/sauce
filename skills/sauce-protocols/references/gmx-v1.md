# GMX V1

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Decentralized perpetual exchange with multi-asset liquidity pool (GLP). Supports leverage trading up to 50x.

## Category

perpetuals | Chains and addresses: [registry/gmx-v1.md](registry/gmx-v1.md)

## Key Operations

- **openPosition**: Open/increase leveraged position via PositionRouter
- **closePosition**: Close/decrease leveraged position
- **swap**: Swap tokens via GMX Router

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Open leveraged long position
import { PositionRouterABI as IPositionRouter } from "./abis";
function main(
  positionRouterAddress: Address,
  path: Address[],
  indexToken: Address,
  amountIn: Uint256,
  sizeDelta: Uint256,
  isLong: bool,
  acceptablePrice: Uint256,
): Uint256 {
  const positionRouter = IPositionRouter.at(positionRouterAddress);
  positionRouter.createIncreasePosition(
    path,
    indexToken,
    amountIn,
    0,
    sizeDelta,
    isLong,
    acceptablePrice,
    200000000000000,
    0x0000000000000000000000000000000000000000000000000000000000000000,
    0x0000000000000000000000000000000000000000,
  );
  return 1;
}

// Close position
import { PositionRouterABI as IPositionRouter } from "./abis";
function main(
  positionRouterAddress: Address,
  path: Address[],
  indexToken: Address,
  collateralDelta: Uint256,
  sizeDelta: Uint256,
  isLong: bool,
  receiver: Address,
  acceptablePrice: Uint256,
): Uint256 {
  const positionRouter = IPositionRouter.at(positionRouterAddress);
  positionRouter.createDecreasePosition(
    path,
    indexToken,
    collateralDelta,
    sizeDelta,
    isLong,
    receiver,
    acceptablePrice,
    0,
    200000000000000,
    false,
    0x0000000000000000000000000000000000000000,
  );
  return 1;
}

// Swap tokens
import { RouterABI as IRouter } from "./abis";
function main(
  routerAddress: Address,
  path: Address[],
  amountIn: Uint256,
  minOut: Uint256,
  receiver: Address,
): Uint256 {
  const router = IRouter.at(routerAddress);
  router.swap(path, amountIn, minOut, receiver);
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/gmx-v1.md](registry/gmx-v1.md).

## Notes

- Execution fee: each request's `msg.value` must equal its `_executionFee`, which must be at least the PositionRouter's `minExecutionFee()` (read it). The fee goes to whoever executes or cancels the request
- Must call router.approvePlugin(positionRouter) once before using position operations
- Path: for longs, path=[collateral]. For shorts, path=[stablecoin]. For swaps, path=[tokenIn, tokenOut]
- sizeDelta is position size in USD with 30 decimals
- `acceptablePrice` (USD, 30 decimals) bounds the mark price at execution, and its direction depends on the request; there is no market-price sentinel, and 0 is not one. A long increase or a short decrease executes only while the mark price is at most `acceptablePrice` (pass the highest price you accept); a short increase or a long decrease only while it is at least `acceptablePrice` (pass the lowest). When the mark price is outside the bound, the execution reverts and the keeper cancels the request, so 0 never executes a long increase or a short decrease
