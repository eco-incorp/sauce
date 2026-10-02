<!-- Generated from the SDK's registries. Do not edit. -->

# SushiSwap V2 (`sushiswap-v2`)

Community-driven fork of Uniswap V2 with additional yield farming features and multi-chain deployment.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Sushiswap`: `sushiswap-v2` |
| Namespace | `SushiswapV2` on ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Chains | ethereum, optimism, bsc, polygon, fantom, arbitrum, avalanche |
| Document | [sushiswap-v2.md](../sushiswap-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `SushiswapV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's factory, `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac`.
  require(SushiswapV2.Factory != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac` | `SushiswapV2.Factory` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F` | `SushiswapV2.Router` |
| [Optimism](../../../sauce-chains/references/optimism.md) | factory | `0xFbc12984689e5f15626Bad03Ad60160Fe98B303C` | `SushiswapV2.Factory` |
| [Optimism](../../../sauce-chains/references/optimism.md) | router | `0x2ABf469074dc0b54d793850807E6eb5Faf2625b1` | `SushiswapV2.Router` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Polygon](../../../sauce-chains/references/polygon.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Polygon](../../../sauce-chains/references/polygon.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Fantom](../../../sauce-chains/references/fantom.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Fantom](../../../sauce-chains/references/fantom.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | factory | `0xc35DADB65012eC5796536bD9864eD8773aBc74C4` | `SushiswapV2.Factory` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | router | `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506` | `SushiswapV2.Router` |

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
