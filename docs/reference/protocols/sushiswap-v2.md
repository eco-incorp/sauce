<!-- Generated from the SDK's registries. Do not edit. -->

# SushiSwap V2 (`sushiswap-v2`)

> SushiSwap V2 is an exchange: people swap one token for another in its pools. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

> **In a Sauce program**, swap with `@sauce/router`'s function for the venue (`uniswapV2`, `uniswapV3`, `uniswapV4`, `curve`, `balancerV2`, …; Slipstream, PancakeSwap V3 and Algebra pools through `uniswapV3`), with a minimum output and, where the pool takes one, a price limit ([the `@sauce/router` reference](../../api/router.md); several pools under one limit, [the distributed swap](../../guides/distributed-swap.md)). The templates below call the protocol's own contracts.

Community-driven fork of Uniswap V2 with additional yield farming features and multi-chain deployment. Identical AMM interface to Uniswap V2 (x*y=k constant product) with broader L2 and alt-chain coverage.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Sushiswap`: `sushiswap-v2` |
| Namespace | `SushiswapV2` on ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |

## When to use it

- A Uniswap V2 fork: constant-product pairs, 0.3% fee, the same Router interface. Use it where
  its pair is deeper than Uniswap V2's on the chain.

## Pitfalls for a program

- As Uniswap V2: `amountOutMin` is the only bound; through the Router, approve exactly
  `amountIn` and pass a deadline.

## In a Sauce program

Sell the Pot's USDC for WETH at the pair:

```ts
import { uniswapV2 } from "@sauce/router";

function main(amountIn: Uint256, minOut: Uint256, recipient: Address) {
  const pair = SushiswapV2.Factory.getPair(USDC, WETH);
  require(pair != 0, "no USDC/WETH pair");
  uniswapV2(pair, USDC, WETH, amountIn, 3000, minOut, recipient);
}
```

`uniswapV2` prices the output from the pair's reserves with its 0.3% fee (`3000` ppm), pushes
`amountIn` to the pair, pays `recipient` and reverts below `minOut`. The pair takes the whole input
or the program reverts, so no input is left to return.

## Key Operations

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint SLP (SushiSwap LP) tokens
- **removeLiquidity**: Burn SLP tokens to withdraw underlying tokens

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

### swap

```typescript
import { SushiSwapV2RouterABI as IRouter } from "./abis";

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

- `routerAddress`: SushiSwap Router address for the target chain
- `path`: Ordered token address array for the swap route (e.g., `[tokenIn, WETH, tokenOut]`)
- `amountIn`: Exact input token amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

### addLiquidity

```typescript
import { SushiSwapV2RouterABI as IRouter } from "./abis";

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

- `tokenA` / `tokenB`: Pair token addresses
- `amountADesired` / `amountBDesired`: Ideal deposit amounts (router adjusts to maintain ratio)
- `amountAMin` / `amountBMin`: Minimum deposits (slippage protection)
- Both tokens must be approved to the router

### removeLiquidity

```typescript
import { SushiSwapV2RouterABI as IRouter } from "./abis";

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

- `liquidity`: Amount of SLP tokens to burn
- SLP token must be approved to the router

## Notes

- Interface is identical to Uniswap V2; same 0.3% fee per hop
- Factory and Router addresses are consistent across Arbitrum, Polygon, BSC, Avalanche, and Fantom
- SLP tokens can be staked in SushiSwap's MasterChef/MiniChef contracts for SUSHI rewards (not in SDK)
- Both tokens must be ERC20-approved to the Router before swap/addLiquidity
- Use SushiSwap when Uniswap V2 is not deployed on the target chain, or when SUSHI farming incentives are active
- From a Pot program, `@sauce/router` trades a SushiSwap V2 pair directly, with no router and no approval: `uniswapV2(pair, tokenIn, tokenOut, amountIn, 3000, minOut, recipient)` reads the pair's `getReserves`, prices the output in the program with the pair's fee in parts per million, transfers the input to the pair and calls `pair.swap` with empty `data`, returning the amount out. The direction is the sort order of `tokenIn` and `tokenOut` (`token0` is the lower address), so there is no argument to get wrong. The swap consumes its whole input or reverts; there is no refund path. `tryUniswapV2` takes the same arguments and returns `0`, moving nothing, when the pair cannot fill the whole input at the floor. The `uniswapV2Swap` action is the same call

## Its names in a program

On Ethereum, `SushiswapV2` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's factory, `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac`.
  require(SushiswapV2.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | factory | `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` | `SushiswapV2.Factory` |
| [Ethereum](../chains/ethereum.md) | router | `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F` | `SushiswapV2.Router` |
| [Optimism](../chains/optimism.md) | factory | `0xFbc12984689e5f15626Bad03Ad60160Fe98B303C` | `SushiswapV2.Factory` |
| [Optimism](../chains/optimism.md) | router | `0x2ABf469074dc0b54d793850807E6eb5Faf2625b1` | `SushiswapV2.Router` |
| [BNB Chain](../chains/bsc.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [BNB Chain](../chains/bsc.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Polygon](../chains/polygon.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Polygon](../chains/polygon.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Fantom](../chains/fantom.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Fantom](../chains/fantom.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Arbitrum One](../chains/arbitrum.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Arbitrum One](../chains/arbitrum.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Avalanche C-Chain](../chains/avalanche.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Avalanche C-Chain](../chains/avalanche.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |

## ABI

### `SushiSwapV2FactoryABI`

`import SushiSwapV2FactoryABI from "./protocols/sushiswap-v2/SushiSwapV2FactoryABI.json";` Speaks for: factory.

- `getPair(address tokenA, address tokenB) view returns (address pair)`
- `createPair(address tokenA, address tokenB) returns (address pair)`

### `SushiSwapV2PairABI`

`import SushiSwapV2PairABI from "./protocols/sushiswap-v2/SushiSwapV2PairABI.json";`

- `getReserves() view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)`
- `token0() view returns (address)`
- `token1() view returns (address)`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`

### `SushiSwapV2RouterABI`

`import SushiSwapV2RouterABI from "./protocols/sushiswap-v2/SushiSwapV2RouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)`
