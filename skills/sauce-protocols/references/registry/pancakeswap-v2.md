<!-- Generated from the SDK's registries. Do not edit. -->

# PancakeSwap V2 (`pancakeswap-v2`)

The most popular DEX on BNB Chain using the constant product AMM model. Forked from Uniswap V2 with additional features like yield farming and lottery.

| Fact | Value |
| --- | --- |
| Category | DEX |
| Family | `Pancakeswap`: `pancakeswap-v2`, `pancakeswap-v3` |
| Namespace | `PancakeswapV2` on ethereum, bsc, monad, opbnb, base, arbitrum, linea |
| Chains | ethereum, bsc, monad, opbnb, base, arbitrum, linea |
| Document | [pancakeswap-v2.md](../pancakeswap-v2.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `PancakeswapV2` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's factory, `0x1097053Fd2ea711dad45caCcc45EfF7548fCB362`.
  require(PancakeswapV2.Factory != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | factory | `0x1097053Fd2ea711dad45caCcc45EfF7548fCB362` | `PancakeswapV2.Factory` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | router | `0xEfF92A263d31888d860bD50809A8D171709b7b1c` | `PancakeswapV2.Router` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` | `PancakeswapV2.Factory` |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` | `PancakeswapV2.Router` |
| [Monad](../../../sauce-chains/references/monad.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [Monad](../../../sauce-chains/references/monad.md) | router | `0xB1Bc24c34e88f7D43D5923034E3a14B24DaACfF9` | `PancakeswapV2.Router` |
| [opBNB](../../../sauce-chains/references/opbnb.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [opBNB](../../../sauce-chains/references/opbnb.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |
| [Base](../../../sauce-chains/references/base.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [Base](../../../sauce-chains/references/base.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |
| [Linea](../../../sauce-chains/references/linea.md) | factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `PancakeswapV2.Factory` |
| [Linea](../../../sauce-chains/references/linea.md) | router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | `PancakeswapV2.Router` |

## ABI

### `PancakeSwapV2FactoryABI`

`import PancakeSwapV2FactoryABI from "./protocols/pancakeswap-v2/PancakeSwapV2FactoryABI.json";` Speaks for: factory.

- `getPair(address tokenA, address tokenB) view returns (address pair)`
- `createPair(address tokenA, address tokenB) returns (address pair)`

### `PancakeSwapV2RouterABI`

`import PancakeSwapV2RouterABI from "./protocols/pancakeswap-v2/PancakeSwapV2RouterABI.json";` Speaks for: router.

- `swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)`
- `addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity)`
- `removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256 amountA, uint256 amountB)`
- `getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)`
