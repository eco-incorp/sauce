<!-- Generated from the SDK's registries. Do not edit. -->

# UnitFlow V3 (`unitflow-v3`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Concentrated-liquidity AMM on Arc, forked from Uniswap V3 with native USDC in place of WETH9.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Unitflow`: `unitflow-v3` |
| Namespace | `UnitflowV3` on arc |
| Chains | arc |

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- Pools call back `unitFlowV3SwapCallback`, not `uniswapV3SwapCallback`, so a contract that swaps against a pool directly must implement the renamed callback
- The GitHub README lists testnet addresses; these mainnet addresses are the defaults in UnitFlow's own app build
- From a Pot program, instead of the protocol's own router: `@sauce/router`'s `uniswapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient)` calls the Router's `swapV3`, requiring generation 4 and its `unitFlowV3SwapCallback` callback. A Pot for which `potRouterUpdate(client, pot)` returns nothing runs the Kitchen's Router, generation `v12RouterGeneration()`; otherwise its owner signs the update it returns
- `uniswapV3` is exact input: the Router caps what the callback may take at `amountIn`

## Its names in a program

On Arc, `UnitflowV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Arc's factory, `0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d`.
  require(UnitflowV3.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../chains/arc.md) | factory | `0x5bfBCeb73d39F722B1cB83fD2F11736b28c1Be6d` | `UnitflowV3.Factory` |
| [Arc](../chains/arc.md) | quoter | `0x5AF6E89F0960Ff375AF84d9911D8153ef6240E34` | `UnitflowV3.Quoter` |
| [Arc](../chains/arc.md) | router | `0x6fD8351b9596C1F0b2f2479BfA6A171cb3d0f410` | `UnitflowV3.Router` |

## ABI

### `UnitFlowV3FactoryABI`

`import UnitFlowV3FactoryABI from "./protocols/unitflow-v3/UnitFlowV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`
- `feeAmountTickSpacing(uint24 fee) view returns (int24)`

### `UnitFlowV3PoolABI`

`import UnitFlowV3PoolABI from "./protocols/unitflow-v3/UnitFlowV3PoolABI.json";`

- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)`
- `liquidity() view returns (uint128)`
- `fee() view returns (uint24)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`
- `token1() view returns (address)`

### `UnitFlowV3QuoterABI`

`import UnitFlowV3QuoterABI from "./protocols/unitflow-v3/UnitFlowV3QuoterABI.json";` Speaks for: quoter.

- `quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)`

### `UnitFlowV3RouterABI`

`import UnitFlowV3RouterABI from "./protocols/unitflow-v3/UnitFlowV3RouterABI.json";` Speaks for: router.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `factory() view returns (address)`
