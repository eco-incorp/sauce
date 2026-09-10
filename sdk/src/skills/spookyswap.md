# SpookySwap

The largest DEX on Fantom with UniV2-style constant product pools (x*y=k). Features yield farming, cross-chain bridges, and limit orders. The default trading venue on the Fantom network.

## Category

dex | Chains: Fantom

## Key Operations

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint LP tokens
- **removeLiquidity**: Burn LP tokens to withdraw underlying tokens

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/spookyswap";
```

## SauceScript Examples

### swap

```typescript
import { SpookySwapRouterABI as IRouter } from "./abis";

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

- `routerAddress`: SpookySwap Router on Fantom (`0xa6AD18C2aC47803E193F75c3677b14BF19B94883`)
- `path`: Ordered token address array for the swap route
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens

### addLiquidity

```typescript
import { SpookySwapRouterABI as IRouter } from "./abis";

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
import { SpookySwapRouterABI as IRouter } from "./abis";

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

| Chain  | Contract  | Address                                      |
| ------ | --------- | -------------------------------------------- |
| Fantom | V2 Router | `0xa6AD18C2aC47803E193F75c3677b14BF19B94883` |

## ABI Methods

### SpookySwapRouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) -> uint256[] amounts` - Swap exact input along path
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity and mint LP tokens
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB)` - Burn LP tokens for underlying

## Notes

- Standard Uniswap V2 fork interface; 0.2% fee per swap (lower than standard 0.3%)
- Fantom-only deployment; the dominant DEX on Fantom
- BOO token is the governance/staking token (stake for xBOO to earn fees)
- SushiSwap is also deployed on Fantom as an alternative
- Both tokens must be ERC20-approved to the Router before swap/addLiquidity
