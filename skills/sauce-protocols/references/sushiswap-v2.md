# SushiSwap V2

Community-driven fork of Uniswap V2 with additional yield farming features and multi-chain deployment. Identical AMM interface to Uniswap V2 (x*y=k constant product) with broader L2 and alt-chain coverage.

## Category

dex | Chains: Ethereum, Arbitrum, Polygon, BSC, Avalanche, Fantom, Optimism

## Key Operations

- **swap**: Swap exact input tokens through a routing path
- **addLiquidity**: Deposit two tokens to mint SLP (SushiSwap LP) tokens
- **removeLiquidity**: Burn SLP tokens to withdraw underlying tokens

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  swap,
  addLiquidity,
  removeLiquidity,
} from "@eco-incorp/sauce/protocols/sushiswap-v2";
```

## SauceScript Examples

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

## Key Addresses

| Chain     | Contract | Address                                      |
| --------- | -------- | -------------------------------------------- |
| Ethereum  | Factory  | `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` |
| Ethereum  | Router   | `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F` |
| Arbitrum  | Factory  | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` |
| Arbitrum  | Router   | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` |
| Polygon   | Factory  | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` |
| Polygon   | Router   | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` |
| BSC       | Factory  | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` |
| BSC       | Router   | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` |
| Avalanche | Factory  | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` |
| Avalanche | Router   | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` |
| Fantom    | Factory  | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` |
| Fantom    | Router   | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` |
| Optimism  | Factory  | `0xFbc12984689e5f15626Bad03Ad60160Fe98B303C` |
| Optimism  | Router   | `0x2ABf469074dc0b54d793850807E6eb5Faf2625b1` |

## ABI Methods

### SushiSwapV2RouterABI

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) -> uint256[] amounts` - Swap exact input along path, returns amounts at each hop
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) -> uint256[] amounts` - Swap to get exact output amount
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB, uint256 liquidity)` - Add liquidity and mint SLP tokens
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) -> (uint256 amountA, uint256 amountB)` - Burn SLP tokens for underlying tokens
- `getAmountsOut(uint256 amountIn, address[] path) -> uint256[] amounts` - Quote output amounts along path (view)

### SushiSwapV2FactoryABI

- `getPair(address tokenA, address tokenB) -> address pair` - Look up pair address (view)
- `createPair(address tokenA, address tokenB) -> address pair` - Create a new pair

## Notes

- Interface is identical to Uniswap V2; same 0.3% fee per hop
- Factory and Router addresses are consistent across Arbitrum, Polygon, BSC, Avalanche, and Fantom
- SLP tokens can be staked in SushiSwap's MasterChef/MiniChef contracts for SUSHI rewards (not in SDK)
- Both tokens must be ERC20-approved to the Router before swap/addLiquidity
- Use SushiSwap when Uniswap V2 is not deployed on the target chain, or when SUSHI farming incentives are active
- From a Pot program, `@sauce/router` trades a SushiSwap V2 pair directly, with no router and no approval: `uniswapV2(pair, tokenIn, tokenOut, amountIn, 3000n, minOut, recipient)` reads the pair's `getReserves`, prices the output in the program with the pair's fee in parts per million, transfers the input to the pair and calls `pair.swap` with empty `data`, returning the amount out. The direction is the sort order of `tokenIn` and `tokenOut` (`token0` is the lower address), so there is no argument to get wrong. The swap consumes its whole input or reverts; there is no refund path. `tryUniswapV2` takes the same arguments and returns `0n`, moving nothing, when the pair cannot fill the whole input at the floor. The `uniswapV2Swap` action is the same call
