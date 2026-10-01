# Maverick

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Dynamic distribution AMM with directional liquidity positioning. Allows LPs to follow price movements automatically with customizable bin strategies. Uses pool addresses directly (no path routing).

## Category

dex | Chains and addresses: [registry/maverick.md](registry/maverick.md)

## Key Operations

- **swap**: Exact input single swap via V2 Router, specifying pool address and direction

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { MaverickV2RouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  pool: Address,
  tokenAIn: bool,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = IRouter.at(routerAddress);
  return router.exactInputSingle(recipient, pool, tokenAIn, amountIn, amountOutMin);
}
```

- `routerAddress`: Maverick V2 Router address for the target chain
- `pool`: The specific pool contract address (must be obtained from factory or known in advance)
- `tokenAIn`: `true` to swap tokenA for tokenB, `false` to swap tokenB for tokenA
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- Note: parameter order is `(recipient, pool, tokenAIn, amountIn, amountOutMin)` - recipient comes FIRST

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/maverick.md](registry/maverick.md).

## Notes

- Uses `tokenAIn` bool instead of separate token addresses to specify swap direction within a pool
- Pool address must be provided directly (no built-in path routing like Uniswap)
- Use `factory.lookup(tokenA, tokenB, 0, n)` to discover available pools for a pair
- Parameter order is unusual: `recipient` is the FIRST parameter, not the last
- Maverick's key innovation is directional LP strategies: bins can be configured to move with price in one direction
- LP modes: Static (like Uniswap V3), Right (follow price up), Left (follow price down), Both (follow both)
- Input token must be ERC20-approved to the V2 Router
- From a Pot program, `@sauce/router`'s `maverickV2(pool, tokenIn, tokenOut, amountIn, minOut, recipient)` swaps a Maverick V2 pool through the Pot's Sauce Router, which pays in the pool's callback exactly what the pool asks for, so a partial fill strands nothing: what the pool did not take stays in the Pot. It does not use the pool's pre-pay mode, where the unfilled part of a pushed input would stay in the pool. The `maverickV2Swap` action is the same call
