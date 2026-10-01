<!-- Generated from the SDK's registries. Do not edit. -->

# Uniswap V2 (`uniswap-v2`)

Constant product AMM (x*y=k) with permissionless pair creation. The most forked DEX protocol in DeFi.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Uniswap`: `uniswap-v2`, `uniswap-v3`, `uniswap-v4` |
| Namespace | `UniswapV2` on ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| Chains | ethereum, optimism, bsc, polygon, arc, base, arbitrum, avalanche, blast, zora |
| Document | [uniswap-v2.md](../uniswap-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `UniswapV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's factory, `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f`.
  require(UniswapV2.Factory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f` | `UniswapV2.Factory` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | `UniswapV2.Router` |
| [Optimism](../../../sauce-chains/references/optimism.md) | factory | `0x0c3c1c532F1e39EdF36BE9Fe0bE1410313E074Bf` | `UniswapV2.Factory` |
| [Optimism](../../../sauce-chains/references/optimism.md) | router | `0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2` | `UniswapV2.Router` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | router | `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24` | `UniswapV2.Router` |
| [Polygon](../../../sauce-chains/references/polygon.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory` |
| [Polygon](../../../sauce-chains/references/polygon.md) | router | `0xedf6066a2b290C185783862C7F4776A2C8077AD1` | `UniswapV2.Router` |
| [Arc](../../../sauce-chains/references/arc.md) | factory | `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba` | `UniswapV2.Factory` |
| [Arc](../../../sauce-chains/references/arc.md) | router | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | `UniswapV2.Router` |
| [Base](../../../sauce-chains/references/base.md) | factory | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `UniswapV2.Factory` |
| [Base](../../../sauce-chains/references/base.md) | router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | `UniswapV2.Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | factory | `0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9` | `UniswapV2.Factory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | `UniswapV2.Router` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | factory | `0x9e5A52f57b3038F1B8EeE45F28b3C1967e22799C` | `UniswapV2.Factory` |
| [Avalanche C-Chain](../../../sauce-chains/references/avalanche.md) | router | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` | `UniswapV2.Router` |
| [Blast](../../../sauce-chains/references/blast.md) | factory | `0x5C346464d33F90bABaf70dB6388507CC889C1070` | `UniswapV2.Factory` |
| [Blast](../../../sauce-chains/references/blast.md) | router | `0xBB66Eb1c5e875933D44DAe661dbD80e5D9B03035` | `UniswapV2.Router` |
| [Zora](../../../sauce-chains/references/zora.md) | factory | `0x0F797dC7efaEA995bB916f268D919d0a1950eE3C` | `UniswapV2.Factory` |
| [Zora](../../../sauce-chains/references/zora.md) | router | `0xa00F34A632630EFd15223B1968358bA4845bEEC7` | `UniswapV2.Router` |

## ABI

### `UniswapV2FactoryABI`

`import UniswapV2FactoryABI from "./protocols/uniswap-v2/UniswapV2FactoryABI.json";` Speaks for: factory.

- `getPair(address tokenA, address tokenB) view returns (address pair)`
- `createPair(address tokenA, address tokenB) returns (address pair)`

### `UniswapV2RouterABI`

`import UniswapV2RouterABI from "./protocols/uniswap-v2/UniswapV2RouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)`
