# UnitFlow V3

Concentrated-liquidity AMM on Arc, forked from Uniswap V3 with native USDC in place of WETH9.

## Category

dex | Chains: Arc (5042)

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

## Deployed Addresses

| Chain | Contract          | Address                                      |
| ----- | ----------------- | -------------------------------------------- |
| Arc   | UnitFlowV3Factory | `0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d` |
| Arc   | UnitFlowV3Router  | `0x6fD8351b9596C1F0b2f2479BfA6A171cb3d0f410` |
| Arc   | Quoter            | `0x5AF6E89F0960Ff375AF84d9911D8153ef6240E34` |

## ABI Reference

- `UnitFlowV3FactoryABI`: `getPool(address tokenA, address tokenB, uint24 fee) returns (address)`, `feeAmountTickSpacing(uint24 fee) returns (int24)`
- `UnitFlowV3RouterABI`: `exactInputSingle(ExactInputSingleParams) returns (uint256 amountOut)`, `factory() returns (address)`
- `UnitFlowV3QuoterABI`: `quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)`; call it with `eth_call`

## Notes

- Pools call back `unitFlowV3SwapCallback`, not `uniswapV3SwapCallback`, so a contract that swaps against a pool directly must implement the renamed callback
- The GitHub README lists testnet addresses; these mainnet addresses are the defaults in UnitFlow's own app build
- Through a Pot's Sauce Router instead of the protocol's own router: `@sauce/router`'s `uniswapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient)` calls the Router's `swapV3`, and only a generation-3 Router answers `unitFlowV3SwapCallback`; on an older one the swap reverts. A Pot for which `potRouterUpdate(client, pot)` returns nothing runs the Kitchen's Router, generation `v12RouterGeneration()`; otherwise its owner signs the update it returns
- Every Sauce Router swap is exact input: the Router caps what the callback may take at the exact input
