<!-- Generated from the SDK's registries. Do not edit. -->

# Synthra V3 (`synthra-v3`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Synthra V3 is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Concentrated-liquidity spot DEX on Arc: a Uniswap V3 fork with renamed pool callbacks.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Synthra`: `synthra-v3` |
| Namespace | `SynthraV3` on arc |
| Chains | arc |

## Notes

- The external ABIs are Uniswap V3's (`getPool`, `exactInputSingle`, `quoteExactInputSingle`, `mint`, …), and the Arc bytecode dispatches every one of them
- Pools call back `synthraV3SwapCallback` (`0x13abb0ca`) and `synthraV3MintCallback`, not the `uniswapV3*` callbacks, so a contract that swaps or mints against a Synthra pool directly must implement the renamed callbacks
- On Arc there is no wrapped native token; pools pair against USDC's ERC-20 interface `0x3600…0000`
- Addresses come from docs.synthra.org's contract-addresses page
- From a Pot program, `@sauce/router`'s `uniswapV3` uses the paired execution Router's `swapV3` and `synthraV3SwapCallback`. `potRouterUpdate(client, pot)` returns an owner-signed update when the Pot differs from its Kitchen's current Router. Compare addresses with `v12RouterAddress()`; Router releases are content-addressed, not generation-numbered.
- `uniswapV3` is exact input: the Router caps what the callback may take at `amountIn`

## Its names in a program

On Arc, `SynthraV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Arc's factory, `0x6307fc239C7964942c1BfFE51930E55606619c74`.
  require(SynthraV3.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arc](../chains/arc.md) | factory | `0x6307fc239C7964942c1BfFE51930E55606619c74` | `SynthraV3.Factory` |
| [Arc](../chains/arc.md) | nonfungiblePositionManager | `0x2743b771659fD9CE13970d7367e7e84AF6a31049` | `SynthraV3.NonfungiblePositionManager` |
| [Arc](../chains/arc.md) | quoterV2 | `0x9c179A7335B3fc841F59Aa6a62daf6d5c61b65D7` | `SynthraV3.QuoterV2` |
| [Arc](../chains/arc.md) | swapRouter02 | `0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828` | `SynthraV3.SwapRouter02` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `SynthraV3FactoryABI`

`import SynthraV3FactoryABI from "./protocols/synthra-v3/SynthraV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`: the address is a `SynthraV3.Pool`
- `createPool(address tokenA, address tokenB, uint24 fee) returns (address pool)`

### `SynthraV3NonfungiblePositionManagerABI`

`import SynthraV3NonfungiblePositionManagerABI from "./protocols/synthra-v3/SynthraV3NonfungiblePositionManagerABI.json";` Speaks for: nonfungiblePositionManager.

- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`
- `increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)`
- `decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)`
- `collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)`

### `SynthraV3PoolABI`

`import SynthraV3PoolABI from "./protocols/synthra-v3/SynthraV3PoolABI.json";`

- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)`
- `liquidity() view returns (uint128)`
- `fee() view returns (uint24)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`: the address is a token
- `token1() view returns (address)`: the address is a token

### `SynthraV3QuoterV2ABI`

`import SynthraV3QuoterV2ABI from "./protocols/synthra-v3/SynthraV3QuoterV2ABI.json";` Speaks for: quoterV2.

- `quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)`

### `SynthraV3SwapRouter02ABI`

`import SynthraV3SwapRouter02ABI from "./protocols/synthra-v3/SynthraV3SwapRouter02ABI.json";` Speaks for: swapRouter02.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
- `exactOutput((bytes path, address recipient, uint256 amountOut, uint256 amountInMaximum) params) payable returns (uint256 amountIn)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
