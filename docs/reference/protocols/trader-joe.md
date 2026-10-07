<!-- Generated from the SDK's registries. Do not edit. -->

# Trader Joe (`trader-joe`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Liquidity Book DEX with variable-width bins for concentrated liquidity. Uses discrete price bins instead of continuous curves, allowing LPs to concentrate liquidity at specific price points. Native to Avalanche with expansion to Arbitrum and BSC.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | `TraderJoe` on bsc, arbitrum, avalanche |
| Chains | bsc, arbitrum, avalanche |

## Key Operations

- **swap**: Swap exact input tokens via Liquidity Book path routing

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- Path is a **structured tuple** `{pairBinSteps, versions, tokenPath}`, NOT a simple address array like Uniswap V2
- Bin steps define price granularity: smaller bin steps = finer price precision but more gas, larger = coarser but cheaper
- Common bin steps: 1, 2, 5, 10, 15, 20, 25 basis points
- `addLiquidity` is complex: specify distribution across bins using `deltaIds` (relative bin offsets from active bin), `distributionX` and `distributionY` (percentage allocations per bin)
- `activeIdDesired`: The bin ID you expect to be active; `idSlippage`: max deviation from desired active ID
- Each LB pair is uniquely identified by (tokenX, tokenY, binStep)
- Trader Joe is the dominant DEX on Avalanche; use it for AVAX pairs and Avalanche ecosystem tokens
- Input token must be ERC20-approved to the LB Router
- From a Pot program, `@sauce/router` swaps at an LB pair directly, with no router and no approval: `traderJoeLB(pair, tokenIn, tokenOut, amountIn, tokenX, tokenY, minOut, recipient)` reverts unless `tokenIn` and `tokenOut` are the pair's X and Y, transfers the input to the pair and calls `swap(swapForY, to)` with `swapForY = tokenIn == tokenX`, returning the received lane of the packed `amountsOut` (X low, Y high). The pair spends the whole input or reverts `LBPair__OutOfLiquidity`, and a wrong `swapForY` reverts `LBPair__InsufficientAmountIn`. `tryTraderJoeLB` asks `getSwapOut` first and pushes only when nothing would be left over, returning `0` otherwise. The `traderJoeLBSwap` action is the same call

## Its names in a program

On BNB Chain, `TraderJoe` is a namespace: its contracts need no import.

```ts
function main() {
  // BNB Chain's lbFactory, `0x8e42f2F4101563bF679975178e880FD87d3eFd4e`.
  require(TraderJoe.LBFactory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../chains/bsc.md) | lbFactory | `0x8e42f2F4101563bF679975178e880FD87d3eFd4e` | `TraderJoe.LBFactory` |
| [BNB Chain](../chains/bsc.md) | lbRouter | `0xb4315e873dBcf96Ffd0acd8EA43f689D8c20fB30` | `TraderJoe.LBRouter` |
| [Arbitrum One](../chains/arbitrum.md) | lbFactory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | `TraderJoe.LBFactory` |
| [Arbitrum One](../chains/arbitrum.md) | lbRouter | `0x18556da13313f3532c54711497a8fedac273220e` | `TraderJoe.LBRouter` |
| [Avalanche C-Chain](../chains/avalanche.md) | lbFactory | `0xb43120c4745967fa9b93E79C149E66B0f2D6Fe0c` | `TraderJoe.LBFactory` |
| [Avalanche C-Chain](../chains/avalanche.md) | lbRouter | `0x18556DA13313f3532c54711497A8FedAC273220E` | `TraderJoe.LBRouter` |

## ABI

### `LBFactoryABI`

`import LBFactoryABI from "./protocols/trader-joe/LBFactoryABI.json";` Speaks for: lbFactory.

- `getLBPairInformation(address tokenA, address tokenB, uint256 binStep) view returns ((uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting) lbPairInformation)`

### `LBPairABI`

`import LBPairABI from "./protocols/trader-joe/LBPairABI.json";`

- `getTokenX() pure returns (address tokenX)`
- `getTokenY() pure returns (address tokenY)`
- `getBinStep() pure returns (uint16)`
- `getActiveId() view returns (uint24 activeId)`
- `getReserves() view returns (uint128 reserveX, uint128 reserveY)`
- `getBin(uint24 id) view returns (uint128 binReserveX, uint128 binReserveY)`
- `getPriceFromId(uint24 id) pure returns (uint256 price)`
- `getSwapIn(uint128 amountOut, bool swapForY) view returns (uint128 amountIn, uint128 amountOutLeft, uint128 fee)`
- `getSwapOut(uint128 amountIn, bool swapForY) view returns (uint128 amountInLeft, uint128 amountOut, uint128 fee)`
- `swap(bool swapForY, address to) returns (bytes32 amountsOut)`

### `LBRouterABI`

`import LBRouterABI from "./protocols/trader-joe/LBRouterABI.json";` Speaks for: lbRouter.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256 amountOut)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, (uint256[] pairBinSteps, uint8[] versions, address[] tokenPath) path, address to, uint256 deadline) returns (uint256[] amountsIn)`
- `addLiquidity((address tokenX, address tokenY, uint256 binStep, uint256 amountX, uint256 amountY, uint256 amountXMin, uint256 amountYMin, uint256 activeIdDesired, uint256 idSlippage, int256[] deltaIds, uint256[] distributionX, uint256[] distributionY, address to, address refundTo, uint256 deadline) liquidityParameters) returns (uint256 amountXAdded, uint256 amountYAdded, uint256 amountXLeft, uint256 amountYLeft, uint256[] depositIds, uint256[] liquidityMinted)`
