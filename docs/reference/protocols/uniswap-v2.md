<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V2 (`uniswap-v2`)

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Constant product AMM (x*y=k) with permissionless pair creation. The most forked DEX protocol in DeFi, deployed across 9 chains with identical interfaces.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV2` on ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |

## When to use it

- Constant-product pairs, one per token pair, with a 0.3% fee. Simple and everywhere, but with
  more price impact than a V3 pool for the same trade.
- The pair fills in full or reverts, so its Router, with an exact approval and `amountOutMin`,
  strands nothing. A Sauce program trades the pair itself with `@sauce/router`'s `uniswapV2`, with
  no Router and no approval.

## Pitfalls for a program

- `amountOutMin` is the only bound: there is no price limit.
- Through the Router, approve it for exactly `amountIn`, and give a `deadline`
  (`ctx.timestamp()` is this block). `uniswapV2` needs neither: it pushes the input to the pair.
- A fee-on-transfer token needs the `...SupportingFeeOnTransferTokens` variants, which the
  registry ABI does not declare.
- The pair must exist: `Factory.getPair` returns `0` where it does not.

## In a Sauce program

Sell the Pot's USDC for WETH at the pair:

```ts
import { uniswapV2 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256, recipient: Address) {
  const pair = UniswapV2.Factory.getPair(USDC, WETH);
  require(pair != 0, "no USDC/WETH pair");
  uniswapV2(pair, USDC, WETH, amountIn, 3000, minOut, recipient);
}
```

`uniswapV2` prices the output from the pair's reserves with its 0.3% fee (`3000` ppm), pushes
`amountIn` to the pair, pays `recipient` and reverts below `minOut`. The pair takes the whole input
or the program reverts, so no input is left to return.

## Key Operations

- **swap**: Swap an exact amount of input tokens for as many output tokens as possible, routed through a path of pairs
- **addLiquidity**: Deposit two tokens into a pair to mint LP tokens proportional to pool share
- **removeLiquidity**: Burn LP tokens to withdraw both underlying tokens from a pair

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swap

```typescript
import { UniswapV2RouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  path: Address[],
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256[] {
  const router = IRouter.at(routerAddress);
  return router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, 99999999999);
}
```

- `routerAddress`: The Uniswap V2 Router contract address for the target chain
- `path`: Ordered array of token addresses defining the swap route (e.g., `[tokenIn, WETH, tokenOut]` for multi-hop)
- `amountIn`: Exact amount of input token to swap (in wei)
- `amountOutMin`: Minimum acceptable output amount, used for slippage protection
- `recipient`: Address to receive the output tokens
- Deadline is hardcoded to `99999999999` (far future) since Sauce executes atomically

### addLiquidity

```typescript
import { UniswapV2RouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
  amountADesired: Uint256,
  amountBDesired: Uint256,
  amountAMin: Uint256,
  amountBMin: Uint256,
  recipient: Address,
): { amountA: Uint256; amountB: Uint256; liquidity: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.addLiquidity(
    tokenA,
    tokenB,
    amountADesired,
    amountBDesired,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- `tokenA` / `tokenB`: The two token addresses forming the pair
- `amountADesired` / `amountBDesired`: Ideal amounts to deposit (router adjusts to maintain ratio)
- `amountAMin` / `amountBMin`: Minimum amounts to deposit (slippage protection)
- `recipient`: Address to receive the LP tokens
- Both tokens must be approved to the router before calling

### removeLiquidity

```typescript
import { UniswapV2RouterABI as IRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenA: Address,
  tokenB: Address,
  liquidity: Uint256,
  amountAMin: Uint256,
  amountBMin: Uint256,
  recipient: Address,
): { amountA: Uint256; amountB: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.removeLiquidity(
    tokenA,
    tokenB,
    liquidity,
    amountAMin,
    amountBMin,
    recipient,
    99999999999,
  );
}
```

- `liquidity`: Amount of LP tokens to burn
- `amountAMin` / `amountBMin`: Minimum amounts of each token to receive (slippage protection)
- LP token must be approved to the router before calling

## Notes

- Path array defines the swap route: `[tokenIn, tokenOut]` for direct swaps, `[tokenIn, WETH, tokenOut]` for multi-hop through WETH
- 0.3% fee per hop, taken from input amount before swap
- Both tokens must be ERC20-approved to the Router before addLiquidity/swap
- LP tokens must be ERC20-approved to the Router before removeLiquidity
- For tokens with transfer taxes (fee-on-transfer), use `swapExactTokensForTokensSupportingFeeOnTransferTokens` instead (not in SDK but available on-chain)
- Uniswap V2 is the simplest and most battle-tested DEX model; prefer V3 for better capital efficiency, but V2 for maximum compatibility and simplicity
- On Arc (5042) the router's `WETH()` is a stub that always reverts with `UnsupportedProtocolError()`, so the ETH paths (`swapExactETHForTokens`, `addLiquidityETH`, …) revert. Trade USDC's ERC-20 `0x3600000000000000000000000000000000000000`; Arc's native coin is USDC and it has no canonical wrapped native
- From a Pot program, `@sauce/router` trades a Uniswap V2 pair directly, with no router and no approval: `uniswapV2(pair, tokenIn, tokenOut, amountIn, 3000, minOut, recipient)` reads the pair's `getReserves`, prices the output in the program with the pair's fee in parts per million, transfers the input to the pair and calls `pair.swap` with empty `data`, returning the amount out. The direction is the sort order of `tokenIn` and `tokenOut` (`token0` is the lower address), so there is no argument to get wrong. The swap consumes its whole input or reverts; there is no refund path. `tryUniswapV2` takes the same arguments and returns `0`, moving nothing, when the pair cannot fill the whole input at the floor. The `uniswapV2Swap` action is the same call

## Its names in a program

On Ethereum, `UniswapV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's factory, `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`.
  require(UniswapV2.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` | `UniswapV2.Factory` |
| [Ethereum](../chains/ethereum.md) | router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | `UniswapV2.Router` |
| [Optimism](../chains/optimism.md) | factory | `0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf` | `UniswapV2.Factory` |
| [Optimism](../chains/optimism.md) | router | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` | `UniswapV2.Router` |
| [BNB Chain](../chains/bsc.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory` |
| [BNB Chain](../chains/bsc.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Polygon](../chains/polygon.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory` |
| [Polygon](../chains/polygon.md) | router | `0xedf6066a2b290C185783862C7F4776A2C8077AD1` | `UniswapV2.Router` |
| [Arc](../chains/arc.md) | factory | `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba` | `UniswapV2.Factory` |
| [Arc](../chains/arc.md) | router | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | `UniswapV2.Router` |
| [Base](../chains/base.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory` |
| [Base](../chains/base.md) | router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | `UniswapV2.Router` |
| [Arbitrum One](../chains/arbitrum.md) | factory | `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9` | `UniswapV2.Factory` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | `UniswapV2.Router` |
| [Avalanche C-Chain](../chains/avalanche.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory` |
| [Avalanche C-Chain](../chains/avalanche.md) | router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | `UniswapV2.Router` |
| [Blast](../chains/blast.md) | factory | `0x5C346464d33F90bABaf70dB6388507CC889C1070` | `UniswapV2.Factory` |
| [Blast](../chains/blast.md) | router | `0xBB66Eb1c5e875933D44DAe661dbD80e5D9B03035` | `UniswapV2.Router` |
| [Zora](../chains/zora.md) | factory | `0x0F797dC7efaEA995bB916f268D919d0a1950eE3C` | `UniswapV2.Factory` |
| [Zora](../chains/zora.md) | router | `0xa00F34A632630EFd15223B1968358bA4845bEEC7` | `UniswapV2.Router` |

## ABI

### `UniswapV2FactoryABI`

`import UniswapV2FactoryABI from "./protocols/uniswap-v2/UniswapV2FactoryABI.json";` Speaks for: factory.

- `getPair(address tokenA, address tokenB) view returns (address pair)`
- `createPair(address tokenA, address tokenB) returns (address pair)`

### `UniswapV2PairABI`

`import UniswapV2PairABI from "./protocols/uniswap-v2/UniswapV2PairABI.json";`

- `getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `UniswapV2RouterABI`

`import UniswapV2RouterABI from "./protocols/uniswap-v2/UniswapV2RouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)`
