# PancakeSwap V2

The most popular DEX on BNB Chain using the constant product AMM model (x*y=k). Forked from Uniswap V2 with additional features like yield farming and lottery. Expanded to 6 chains.

## Category

dex | Chains: BSC, Ethereum, Arbitrum, Base, Linea, opBNB

## Key Operations

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint CAKE-LP tokens
- **removeLiquidity**: Burn LP tokens to withdraw underlying tokens

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce/protocols/pancakeswap-v2";
```

## SauceScript Examples

### swap

```typescript
import { PancakeSwapV2RouterABI as IRouter } from "./abis";

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

- `routerAddress`: PancakeSwap V2 Router for the target chain
- `path`: Ordered token address array for the swap route
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

### addLiquidity

```typescript
import { PancakeSwapV2RouterABI as IRouter } from "./abis";

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

- `amountADesired` / `amountBDesired`: Ideal deposit amounts (router adjusts to maintain ratio)
- `amountAMin` / `amountBMin`: Minimum deposits (slippage protection)
- Both tokens must be approved to the router

### removeLiquidity

```typescript
import { PancakeSwapV2RouterABI as IRouter } from "./abis";

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
- LP token must be approved to the router

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| BSC      | Factory  | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` |
| BSC      | Router   | `0x10ED43C718714eb63d5aA57B78B54704E256024E` |
| Ethereum | Factory  | `0x1097053Fd2ea711dad45caCcc45EfF7548fCB362` |
| Ethereum | Router   | `0xEfF92A263d31888d860bD50809A8D171709b7b1c` |
| Arbitrum | Factory  | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` |
| Arbitrum | Router   | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` |
| Base     | Factory  | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` |
| Base     | Router   | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` |
| Linea    | Factory  | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` |
| Linea    | Router   | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` |
| opBNB    | Factory  | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` |
| opBNB    | Router   | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` |

## ABI Methods

### PancakeSwapV2RouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) -> uint256[] amounts` - Swap exact input along path
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) -> uint256[] amounts` - Swap to get exact output
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity and mint LP tokens
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB)` - Burn LP tokens for underlying
- `getAmountsOut(uint256 amountIn, address[] path) -> uint256[] amounts` - Quote output amounts (view)

### PancakeSwapV2FactoryABI

- `getPair(address tokenA, address tokenB) -> address pair` - Look up pair address (view)
- `createPair(address tokenA, address tokenB) -> address pair` - Create a new pair

## Notes

- Same Uniswap V2 interface; 0.25% fee per swap (0.17% to LPs, 0.03% to treasury, 0.05% to CAKE buyback)
- BSC Router address differs from other chains (BSC was the original deployment)
- Arbitrum, Base, Linea, and opBNB share the same Factory and Router addresses
- LP tokens can be staked in MasterChef for CAKE rewards
- PancakeSwap is the default choice for BSC trading; use PancakeSwap V3 for concentrated liquidity
