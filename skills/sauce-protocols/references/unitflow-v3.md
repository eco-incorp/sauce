# UnitFlow V3

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Concentrated-liquidity AMM on Arc, forked from Uniswap V3 with native USDC in place of WETH9.

## Category

dex | Chains and addresses: [registry/unitflow-v3.md](registry/unitflow-v3.md)

## SauceScript Functions

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
