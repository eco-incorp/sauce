<!-- Generated from the SDK's registries. Do not edit. -->

# PancakeSwap V3 (`pancakeswap-v3`)

> **In a Sauce program**, swap with `@sauce/router`, one function per venue with a minimum output, and a price limit where the pool takes one ([`@sauce/router`](../../api/router.md); several pools under one limit, the `sauce-distributed-swap` agent skill). The templates below call the protocol's own contracts.

Concentrated liquidity AMM on BNB Chain and multiple EVM chains. Built on Uniswap V3 architecture with custom fee tiers and farming integration via the SmartRouter.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Pancakeswap`: `pancakeswap-v2`, `pancakeswap-v3` |
| Namespace | `PancakeswapV3` on ethereum, bsc, base, arbitrum, linea |
| Chains | ethereum, bsc, base, arbitrum, linea |

## Key Operations

- **swap**: Exact input single-hop swap with fee tier selection via SmartRouter

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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
- `sqrtPriceLimitX96`: `0` in this template, no price limit, so `amountOutMin` is the only bound. With `@sauce/router`'s `uniswapV3`, set a real limit ([`@sauce/router`](../../api/router.md))
- Note: SmartRouter does NOT include a `deadline` param in the struct (unlike Uniswap V3)

## Notes

- Fee tiers may differ from Uniswap V3; PancakeSwap includes a 2500 (0.25%) tier
- SmartRouter struct does NOT include `deadline` (unlike Uniswap V3's router)
- Factory address is the same across all chains; SmartRouter addresses vary
- NFPM address is consistent across all chains (`0x46A15B...`)
- Swapping through the SmartRouter needs the input token approved to it. From a Pot program, `@sauce/router`'s `uniswapV3(pool, tokenIn, tokenOut, amountIn, sqrtPriceLimitX96, minOut, recipient)` swaps a PancakeSwap V3 pool (`PancakeswapV3.Factory.getPool(tokenA, tokenB, fee)`) with no approval: it calls the Pot's Router, which answers the pool's `pancakeV3SwapCallback` from the Pot ([`@sauce/router`](../../api/router.md))
- Both tokens must be ERC20-approved to the NFPM for minting positions
- Prefer V3 over V2 for major pairs on BSC for better capital efficiency

## Its names in a program

On Ethereum, `PancakeswapV3` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's factory, `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`.
  require(PancakeswapV3.Factory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [Ethereum](../chains/ethereum.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [Ethereum](../chains/ethereum.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeswapV3.SmartRouter` |
| [BNB Chain](../chains/bsc.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [BNB Chain](../chains/bsc.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [BNB Chain](../chains/bsc.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeswapV3.SmartRouter` |
| [Base](../chains/base.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [Base](../chains/base.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [Base](../chains/base.md) | smartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` | `PancakeswapV3.SmartRouter` |
| [Arbitrum One](../chains/arbitrum.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [Arbitrum One](../chains/arbitrum.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [Arbitrum One](../chains/arbitrum.md) | smartRouter | `0x32226588378236Fd0c7c4053999F88aC0e5cAc77` | `PancakeswapV3.SmartRouter` |
| [Linea](../chains/linea.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeswapV3.Factory` |
| [Linea](../chains/linea.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeswapV3.NonfungiblePositionManager` |
| [Linea](../chains/linea.md) | smartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` | `PancakeswapV3.SmartRouter` |

## ABI

### `PancakeSwapV3FactoryABI`

`import PancakeSwapV3FactoryABI from "./protocols/pancakeswap-v3/PancakeSwapV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`

### `PancakeSwapV3NFPMABI`

`import PancakeSwapV3NFPMABI from "./protocols/pancakeswap-v3/PancakeSwapV3NFPMABI.json";` Speaks for: nonfungiblePositionManager.

- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`

### `PancakeSwapV3PoolABI`

`import PancakeSwapV3PoolABI from "./protocols/pancakeswap-v3/PancakeSwapV3PoolABI.json";`

- `slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)`
- `liquidity() view returns (uint128)`
- `fee() view returns (uint24)`
- `tickSpacing() view returns (int24)`
- `token0() view returns (address)`
- `token1() view returns (address)`

### `PancakeSwapV3SmartRouterABI`

`import PancakeSwapV3SmartRouterABI from "./protocols/pancakeswap-v3/PancakeSwapV3SmartRouterABI.json";` Speaks for: smartRouter.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
