<!-- Generated from the SDK's registries. Do not edit. -->

# PancakeSwap V3 (`pancakeswap-v3`)

Concentrated liquidity AMM on BNB Chain and multiple EVM chains. Built on Uniswap V3 architecture with custom fee tiers and farming integration.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, bsc, base, arbitrum, linea |
| Document | [pancakeswap-v3.md](../pancakeswap-v3.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's factory):

```sauce chain=ethereum
import PancakeSwapV3FactoryABI from "./protocols/pancakeswap-v3/PancakeSwapV3FactoryABI.json";

const FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865n;

function main() {
  const bound = PancakeSwapV3FactoryABI.at(FACTORY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeSwapV3FactoryABI.at(0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeSwapV3NFPMABI.at(0x46A15B0b27311cedF172AB29E4f4766fbE7F4364n)` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeSwapV3SmartRouterABI.at(0x13f4EA83D0bd40E75C8222255bc855a974568Dd4n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeSwapV3FactoryABI.at(0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeSwapV3NFPMABI.at(0x46A15B0b27311cedF172AB29E4f4766fbE7F4364n)` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | smartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `PancakeSwapV3SmartRouterABI.at(0x13f4EA83D0bd40E75C8222255bc855a974568Dd4n)` |
| [Base](../../../sauce-chains/references/base.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeSwapV3FactoryABI.at(0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865n)` |
| [Base](../../../sauce-chains/references/base.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeSwapV3NFPMABI.at(0x46A15B0b27311cedF172AB29E4f4766fbE7F4364n)` |
| [Base](../../../sauce-chains/references/base.md) | smartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` | `PancakeSwapV3SmartRouterABI.at(0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeSwapV3FactoryABI.at(0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeSwapV3NFPMABI.at(0x46A15B0b27311cedF172AB29E4f4766fbE7F4364n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | smartRouter | `0x32226588378236Fd0c7c4053999F88aC0e5cAc77` | `PancakeSwapV3SmartRouterABI.at(0x32226588378236Fd0c7c4053999F88aC0e5cAc77n)` |
| [Linea](../../../sauce-chains/references/linea.md) | factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `PancakeSwapV3FactoryABI.at(0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865n)` |
| [Linea](../../../sauce-chains/references/linea.md) | nonfungiblePositionManager | `0x46A15B0b27311cedF172AB29E4f4766fbE7F4364` | `PancakeSwapV3NFPMABI.at(0x46A15B0b27311cedF172AB29E4f4766fbE7F4364n)` |
| [Linea](../../../sauce-chains/references/linea.md) | smartRouter | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` | `PancakeSwapV3SmartRouterABI.at(0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86n)` |

## ABI

### `PancakeSwapV3FactoryABI`

`import PancakeSwapV3FactoryABI from "./protocols/pancakeswap-v3/PancakeSwapV3FactoryABI.json";` Speaks for: factory.

- `getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)`

### `PancakeSwapV3NFPMABI`

`import PancakeSwapV3NFPMABI from "./protocols/pancakeswap-v3/PancakeSwapV3NFPMABI.json";` Speaks for: nonfungiblePositionManager.

- `mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)`

### `PancakeSwapV3SmartRouterABI`

`import PancakeSwapV3SmartRouterABI from "./protocols/pancakeswap-v3/PancakeSwapV3SmartRouterABI.json";` Speaks for: smartRouter.

- `exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)`
- `exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)`
