# Trader Joe

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Liquidity Book DEX with variable-width bins for concentrated liquidity. Uses discrete price bins instead of continuous curves, allowing LPs to concentrate liquidity at specific price points. Native to Avalanche with expansion to Arbitrum and BSC.

## Category

dex | Chains and addresses: [registry/trader-joe.md](registry/trader-joe.md)

## Key Operations

- **swap**: Swap exact input tokens via Liquidity Book path routing

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

### swap

```typescript
import { LBRouterABI as ILBRouter } from "./abis";

function main(
  routerAddress: Address,
  path: { pairBinSteps: Uint256[]; versions: Uint256[]; tokenPath: Address[] },
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ILBRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, 99999999999);
}
```

- `routerAddress`: Liquidity Book Router address for the target chain
- `path`: A **tuple** (NOT a simple address array) containing `{pairBinSteps: uint256[], versions: uint8[], tokenPath: address[]}`
  - `pairBinSteps`: Array of bin step sizes for each hop (determines price granularity per pair)
  - `versions`: Array of pool versions per hop (1=V1, 2=V2, 2.1=V2.1)
  - `tokenPath`: Ordered array of token addresses
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/trader-joe.md](registry/trader-joe.md).

## Notes

- Path is a **structured tuple** `{pairBinSteps, versions, tokenPath}`, NOT a simple address array like Uniswap V2
- Bin steps define price granularity: smaller bin steps = finer price precision but more gas, larger = coarser but cheaper
- Common bin steps: 1, 2, 5, 10, 15, 20, 25 basis points
- `addLiquidity` is complex: specify distribution across bins using `deltaIds` (relative bin offsets from active bin), `distributionX` and `distributionY` (percentage allocations per bin)
- `activeIdDesired`: The bin ID you expect to be active; `idSlippage`: max deviation from desired active ID
- Each LB pair is uniquely identified by (tokenX, tokenY, binStep)
- Trader Joe is the dominant DEX on Avalanche; use it for AVAX pairs and Avalanche ecosystem tokens
- Input token must be ERC20-approved to the LB Router
- From a Pot program, `@sauce/router` swaps at an LB pair directly, with no router and no approval: `traderJoeLB(pair, tokenIn, tokenOut, amountIn, tokenX, tokenY, minOut, recipient)` reverts unless `tokenIn` and `tokenOut` are the pair's X and Y, transfers the input to the pair and calls `swap(swapForY, to)` with `swapForY = tokenIn == tokenX`, returning the received lane of the packed `amountsOut` (X low, Y high). The pair spends the whole input or reverts `LBPair__OutOfLiquidity`, and a wrong `swapForY` reverts `LBPair__InsufficientAmountIn`. `tryTraderJoeLB` asks `getSwapOut` first and pushes only when nothing would be left over, returning `0n` otherwise. The `traderJoeLBSwap` action is the same call
