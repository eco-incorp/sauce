<!-- Generated from the SDK's registries. Do not edit. -->

# UnitFlow V3 (`unitflow-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> UnitFlow V3 is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Concentrated-liquidity AMM on Arc, forked from Uniswap V3 with native USDC in place of WETH9.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Unitflow`: `unitflow-v3` |
| Namespace | `UnitflowV3` on arc |
| Chains | arc |

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

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `UnitFlowV3FactoryABI`

`import UnitFlowV3FactoryABI from "./protocols/unitflow-v3/UnitFlowV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`: the address is a `UnitflowV3.Pool`
- `feeAmountTickSpacing(uint24 fee) view returns (int24)`

### `UnitFlowV3PoolABI`

`import UnitFlowV3PoolABI from "./protocols/unitflow-v3/UnitFlowV3PoolABI.json";`

- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)`
- `liquidity() view returns (uint128)`
- `fee() view returns (uint24)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `UnitFlowV3QuoterABI`

`import UnitFlowV3QuoterABI from "./protocols/unitflow-v3/UnitFlowV3QuoterABI.json";` Speaks for: quoter.

- `quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)`

### `UnitFlowV3RouterABI`

`import UnitFlowV3RouterABI from "./protocols/unitflow-v3/UnitFlowV3RouterABI.json";` Speaks for: router.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `factory() view returns (address)`: the address is a `UnitflowV3.Factory`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
