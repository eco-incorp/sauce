# Uniswap V2

Constant product AMM (x*y=k) with permissionless pair creation. The most forked DEX protocol in DeFi, deployed across 9 chains with identical interfaces.

## Category
dex | Chains: Ethereum, Arbitrum, Optimism, Polygon, Base, BSC, Avalanche, Blast, Zora

## Key Operations
- **swap**: Swap an exact amount of input tokens for as many output tokens as possible, routed through a path of pairs
- **addLiquidity**: Deposit two tokens into a pair to mint LP tokens proportional to pool share
- **removeLiquidity**: Burn LP tokens to withdraw both underlying tokens from a pair

## SDK Usage
```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/uniswap-v2";
```

## SauceScript Examples

### swap
```typescript
import { UniswapV2RouterABI as IRouter } from "./abis";

function main(routerAddress: Address, path: Address[], amountIn: Uint256, amountOutMin: Uint256, recipient: Address): Uint256[] {
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

function main(routerAddress: Address, tokenA: Address, tokenB: Address, amountADesired: Uint256, amountBDesired: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256, liquidity: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, recipient, 99999999999);
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

function main(routerAddress: Address, tokenA: Address, tokenB: Address, liquidity: Uint256, amountAMin: Uint256, amountBMin: Uint256, recipient: Address): { amountA: Uint256, amountB: Uint256 } {
  const router = IRouter.at(routerAddress);
  return router.removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, recipient, 99999999999);
}
```
- `liquidity`: Amount of LP tokens to burn
- `amountAMin` / `amountBMin`: Minimum amounts of each token to receive (slippage protection)
- LP token must be approved to the router before calling

## Key Addresses
| Chain | Contract | Address |
|-------|----------|---------|
| Ethereum | Factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` |
| Ethereum | Router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` |
| Arbitrum | Factory | `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9` |
| Arbitrum | Router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` |
| Optimism | Factory | `0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf` |
| Optimism | Router | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` |
| Polygon | Factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` |
| Polygon | Router | `0xedf6066a2b290C185783862C7F4776A2C8077AD1` |
| Base | Factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` |
| Base | Router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` |
| BSC | Factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` |
| BSC | Router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` |
| Avalanche | Factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` |
| Avalanche | Router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` |
| Blast | Factory | `0x5C346464d33F90bABaf70dB6388507CC889C1070` |
| Blast | Router | `0xBB66Eb1c5e875933D44DAe661dbD80e5D9B03035` |
| Zora | Factory | `0x0F797dC7efaEA995bB916f268D919d0a1950eE3C` |
| Zora | Router | `0xa00F34A632630EFd15223B1968358bA4845bEEC7` |

## ABI Methods

### UniswapV2RouterABI
- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) -> uint256[] amounts` - Swap exact input tokens along path, returns amounts at each hop
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) -> uint256[] amounts` - Swap tokens to get exact output amount, returns amounts at each hop
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity to a pair, returns actual amounts deposited and LP tokens minted
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB)` - Burn LP tokens and withdraw underlying tokens
- `getAmountsOut(uint256 amountIn, address[] path) -> uint256[] amounts` - Quote: calculate output amounts for given input along path (view)

### UniswapV2FactoryABI
- `getPair(address tokenA, address tokenB) -> address pair` - Look up the pair contract address for two tokens (view)
- `createPair(address tokenA, address tokenB) -> address pair` - Create a new pair (if it doesn't exist)

## Notes
- Path array defines the swap route: `[tokenIn, tokenOut]` for direct swaps, `[tokenIn, WETH, tokenOut]` for multi-hop through WETH
- 0.3% fee per hop, taken from input amount before swap
- Both tokens must be ERC20-approved to the Router before addLiquidity/swap
- LP tokens must be ERC20-approved to the Router before removeLiquidity
- For tokens with transfer taxes (fee-on-transfer), use `swapExactTokensForTokensSupportingFeeOnTransferTokens` instead (not in SDK but available on-chain)
- Uniswap V2 is the simplest and most battle-tested DEX model; prefer V3 for better capital efficiency, but V2 for maximum compatibility and simplicity
