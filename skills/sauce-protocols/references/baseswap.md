# BaseSwap

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Base-native DEX with UniV2-style constant product pools (x*y=k). Features yield farming, launchpad, and NFT marketplace. A simple and straightforward fork of Uniswap V2 on Base.

## Category

dex | Chains: Base

## Key Operations

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint LP tokens
- **removeLiquidity**: Burn LP tokens to withdraw underlying tokens

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  swap,
  addLiquidity,
  removeLiquidity,
} from "@eco-incorp/sauce/protocols/baseswap";
```

## SauceScript Examples

### swap

```typescript
import { BaseSwapRouterABI as IRouter } from "./abis";

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

- `routerAddress`: BaseSwap V2 Router on Base (`0x327Df1E6de05895d2ab08513aaDD9313Fe505d86`)
- `path`: Ordered token address array for the swap route
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

### addLiquidity

```typescript
import { BaseSwapRouterABI as IRouter } from "./abis";

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

- Both tokens must be approved to the router

### removeLiquidity

```typescript
import { BaseSwapRouterABI as IRouter } from "./abis";

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

- LP token must be approved to the router

## Key Addresses

| Chain | Contract  | Address                                      |
| ----- | --------- | -------------------------------------------- |
| Base  | V2 Router | `0x327Df1E6de05895d2ab08513aaDD9313Fe505d86` |

## ABI Methods

### BaseSwapRouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) -> uint256[] amounts` - Swap exact input along path
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity and mint LP tokens
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB)` - Burn LP tokens for underlying

## Notes

- Standard Uniswap V2 fork interface; 0.3% fee per swap
- Base-only deployment
- For most Base swaps, Aerodrome has higher liquidity; use BaseSwap for pairs where Aerodrome has less depth or when BSWAP farming rewards are active
- Both tokens must be ERC20-approved to the Router before swap/addLiquidity
