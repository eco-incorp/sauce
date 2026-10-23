<!-- Generated from the SDK's registries. Do not edit. -->

# Maverick (`maverick`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Maverick is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)).

Dynamic distribution AMM with directional liquidity positioning. Allows LPs to follow price movements automatically with customizable bin strategies. Uses pool addresses directly (no path routing).

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `Maverick` on ethereum, base, arbitrum |
| Chains | ethereum, base, arbitrum |

## What it offers

- **swap**: Exact input single swap via V2 Router, specifying pool address and direction

## Notes

- Uses `tokenAIn` bool instead of separate token addresses to specify swap direction within a pool
- Pool address must be provided directly (no built-in path routing like Uniswap)
- Use `factory.lookup(tokenA, tokenB, 0, n)` to discover available pools for a pair
- Parameter order is unusual: `recipient` is the FIRST parameter, not the last
- Maverick's key innovation is directional LP strategies: bins can be configured to move with price in one direction
- LP modes: Static (like Uniswap V3), Right (follow price up), Left (follow price down), Both (follow both)
- Input token must be ERC20-approved to the V2 Router
- From a Pot program, `@sauce/router`'s `maverickV2(pool, tokenIn, tokenOut, amountIn, minOut, recipient)` swaps a Maverick V2 pool through the Pot's Sauce Router, which pays in the pool's callback exactly what the pool asks for, so a partial fill strands nothing: what the pool did not take stays in the Pot. It does not use the pool's pre-pay mode, where the unfilled part of a pushed input would stay in the pool. The `maverickV2Swap` action is the same call

## Its names in a program

On Ethereum, `Maverick` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's v2Factory, `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e`.
  require(Maverick.V2Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Ethereum](../chains/ethereum.md) | v2Router | `0x62e31802c6145A2D5E842EeD8efe01fC224422fA` | `Maverick.V2Router` |
| [Base](../chains/base.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Base](../chains/base.md) | v2Router | `0x5eDEd0d7E76C563FF081Ca01D9d12D6B404Df527` | `Maverick.V2Router` |
| [Arbitrum One](../chains/arbitrum.md) | v2Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` | `Maverick.V2Factory` |
| [Arbitrum One](../chains/arbitrum.md) | v2Router | `0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76` | `Maverick.V2Router` |

## ABI

Where a line says what an address it returns is, a program that calls the function through
its namespace calls that contract's methods on the result directly:
`<Namespace>.<Contract>.<function>(...).<method>(...)`. A token's methods are the ERC-20
functions, and its writes are SafeERC20.

### `MaverickV2FactoryABI`

`import MaverickV2FactoryABI from "./protocols/maverick/MaverickV2FactoryABI.json";` Speaks for: v2Factory.

- `lookup(address tokenA, address tokenB, uint256 startIndex, uint256 endIndex) view returns (address[] pools)`

### `MaverickV2PoolABI`

`import MaverickV2PoolABI from "./protocols/maverick/MaverickV2PoolABI.json";`

- `getState() view returns ((uint128 reserveA, uint128 reserveB, int64 lastTwaD8, int64 lastLogPriceD8, uint40 lastTimestamp, int32 activeTick, bool isLocked, uint32 binCounter, uint8 protocolFeeRatioD3))`
- `fee(bool tokenAIn) view returns (uint256)`
- `tickSpacing() view returns (uint256)`
- `tokenA() view returns (address)`: the address is a token
- `tokenB() view returns (address)`: the address is a token

### `MaverickV2RouterABI`

`import MaverickV2RouterABI from "./protocols/maverick/MaverickV2RouterABI.json";` Speaks for: v2Router.

- `exactInputSingle(address recipient, address pool, bool tokenAIn, uint256 amountIn, uint256 amountOutMinimum) payable returns (uint256 amountOut)`
- `exactOutputSingle(address recipient, address pool, bool tokenAIn, uint256 amountOut, uint256 amountInMaximum) payable returns (uint256 amountIn, uint256 amountOut)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
