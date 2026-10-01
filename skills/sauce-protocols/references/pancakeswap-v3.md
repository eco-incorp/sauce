# PancakeSwap V3

> **In a Sauce program**, swap through the Sauce Router wherever it services the pool, with a price limit, a minimum output and the unspent input returned (`sauce-swaps`; several pools under one limit, `sauce-distributed-swap`). The templates below call the protocol's own contracts.

Concentrated liquidity AMM on BNB Chain and multiple EVM chains. Built on Uniswap V3 architecture with custom fee tiers and farming integration via the SmartRouter.

## Category

dex | Chains: BSC, Ethereum, Arbitrum, Base, Linea

## Key Operations

- **swap**: Exact input single-hop swap with fee tier selection via SmartRouter

## SDK Usage

```typescript
import { protocolInfo, deployments, swap } from "@eco-incorp/sauce/protocols/pancakeswap-v3";
```

## SauceScript Examples

### swap

```typescript
import { PancakeSwapV3SmartRouterABI as ISmartRouter } from "./abis";

function main(
  routerAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: Uint256,
  amountIn: Uint256,
  amountOutMin: Uint256,
  recipient: Address,
): Uint256 {
  const router = ISmartRouter.at(routerAddress);
  return router.exactInputSingle({
    tokenIn: tokenIn,
    tokenOut: tokenOut,
    fee: fee,
    recipient: recipient,
    amountIn: amountIn,
    amountOutMinimum: amountOutMin,
    sqrtPriceLimitX96: 0,
  });
}
```

- `routerAddress`: PancakeSwap V3 SmartRouter address for the target chain
- `tokenIn` / `tokenOut`: Input and output token addresses
- `fee`: Pool fee tier in hundredths of a bip. Common: `100` (0.01%), `500` (0.05%), `2500` (0.25%), `10000` (1%)
- `amountIn`: Exact input amount (in wei)
- `amountOutMin`: Minimum output for slippage protection
- `recipient`: Address to receive output tokens
- `sqrtPriceLimitX96`: `0` in this template, no price limit, so `amountOutMin` is the only bound. Through the Sauce Router, set a real limit (`sauce-swaps`)
- Note: SmartRouter does NOT include a `deadline` param in the struct (unlike Uniswap V3)

## Key Addresses

| Chain    | Contract    | Address                                      |
| -------- | ----------- | -------------------------------------------- |
| BSC      | Factory     | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |
| BSC      | SmartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` |
| BSC      | NFPM        | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` |
| Ethereum | Factory     | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |
| Ethereum | SmartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` |
| Ethereum | NFPM        | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` |
| Arbitrum | Factory     | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |
| Arbitrum | SmartRouter | `0x32226588378236Fd0c7c4053999F88aC0e5cAc77` |
| Arbitrum | NFPM        | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` |
| Base     | Factory     | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |
| Base     | SmartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` |
| Base     | NFPM        | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` |
| Linea    | Factory     | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` |
| Linea    | SmartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` |
| Linea    | NFPM        | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` |

## ABI Methods

### PancakeSwapV3SmartRouterABI

- `exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) -> uint256 amountOut` - Single-hop swap with exact input amount
- `exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) -> uint256 amountIn` - Single-hop swap specifying exact output desired

### PancakeSwapV3FactoryABI

- `getPool(address tokenA, address tokenB, uint24 fee) -> address pool` - Look up pool address for token pair and fee tier (view)

### PancakeSwapV3NFPMABI

- `mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) -> (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)` - Create new concentrated liquidity position NFT

## Notes

- Fee tiers may differ from Uniswap V3; PancakeSwap includes a 2500 (0.25%) tier
- SmartRouter struct does NOT include `deadline` (unlike Uniswap V3's router)
- Factory address is the same across all chains; SmartRouter addresses vary
- NFPM address is consistent across all chains (`0x46A15B...`)
- Swapping through the SmartRouter needs the input token approved to it; the Sauce Router needs no approval, since its callback pays the pool from the Pot (`sauce-swaps`)
- Both tokens must be ERC20-approved to the NFPM for minting positions
- Prefer V3 over V2 for major pairs on BSC for better capital efficiency
