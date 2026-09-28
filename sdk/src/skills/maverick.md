# Maverick

Dynamic distribution AMM with directional liquidity positioning. Allows LPs to follow price movements automatically with customizable bin strategies. Uses pool addresses directly (no path routing).

## Category

dex | Chains: Ethereum, Arbitrum, Base

## Key Operations

- **swap**: Exact input single swap via V2 Router, specifying pool address and direction

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/maverick";
```

## SauceScript Examples

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

## Key Addresses

| Chain    | Contract   | Address                                      |
| -------- | ---------- | -------------------------------------------- |
| Ethereum | V2 Router  | `0x62e31802c6145A2D5E842EeD8efe01fC224422fA` |
| Ethereum | V2 Factory | `0x0A7e848Aca42d879EF06507Fca0E7b33A0a63c1e` |
| Arbitrum | V2 Router  | `0x5c3b380e5Aeec389d1014Da3Eb372FA2C9e0fc76` |
| Base     | V2 Router  | `0x5eDEd0d7E76C563FF081Ca01D9d12D6B404Df527` |

## ABI Methods

### MaverickV2RouterABI

- `exactInputSingle(address recipient, address pool, bool tokenAIn, uint256 amountIn, uint256 amountOutMinimum) -> uint256 amountOut` - Swap exact input in a specific pool
- `exactOutputSingle(address recipient, address pool, bool tokenAIn, uint256 amountOut, uint256 amountInMaximum) -> (uint256 amountIn, uint256 amountOut)` - Swap to get exact output from a specific pool

### MaverickV2FactoryABI

- `lookup(address tokenA, address tokenB, uint256 startIndex, uint256 endIndex) -> address[] pools` - Look up a page of the pools for a token pair (view)

## Notes

- Uses `tokenAIn` bool instead of separate token addresses to specify swap direction within a pool
- Pool address must be provided directly (no built-in path routing like Uniswap)
- Use `factory.lookup(tokenA, tokenB, 0, n)` to discover available pools for a pair
- Parameter order is unusual: `recipient` is the FIRST parameter, not the last
- Maverick's key innovation is directional LP strategies: bins can be configured to move with price in one direction
- LP modes: Static (like Uniswap V3), Right (follow price up), Left (follow price down), Both (follow both)
- Input token must be ERC20-approved to the V2 Router
