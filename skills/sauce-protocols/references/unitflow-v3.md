# UnitFlow V3

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Concentrated-liquidity AMM on Arc, forked from Uniswap V3 with native USDC in place of WETH9.

## Category

dex | Chains and addresses: [registry/unitflow-v3.md](registry/unitflow-v3.md)

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

Exact-input single-hop swap through UnitFlowV3Router.

```typescript
import { UnitFlowV3RouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
  deadline: Uint256,
): Uint256 {
  const router = IRouter.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: recipient,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0,
  });
}
```

- The router has Uniswap V3 SwapRouter's shape: its params include `deadline`
- `tokenIn` must be `approve`d to the router

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/unitflow-v3.md](registry/unitflow-v3.md).

## Notes

- Pools call back `unitFlowV3SwapCallback`, not `uniswapV3SwapCallback`, so a contract that swaps against a pool directly must implement the renamed callback
- The GitHub README lists testnet addresses; these mainnet addresses are the defaults in UnitFlow's own app build
- From a Pot program, instead of the protocol's own router: `@sauce/router`'s `uniswapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient)` calls the Router's `swapV3`, and only a generation-3 Router answers `unitFlowV3SwapCallback`; on an older one the swap reverts. A Pot for which `potRouterUpdate(client, pot)` returns nothing runs the Kitchen's Router, generation `v12RouterGeneration()`; otherwise its owner signs the update it returns
- `uniswapV3` is exact input: the Router caps what the callback may take at `amountIn`
