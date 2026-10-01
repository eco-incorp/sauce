<!-- Generated from the SDK's registries. Do not edit. -->

# Level Finance (`level-finance`)

Decentralized perpetual exchange with risk-tranched liquidity pools and leveraged trading on BSC and Arbitrum.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `LevelFinance` on bsc, arbitrum |
| Chains | bsc, arbitrum |
| Document | [level-finance.md](../level-finance.md): what it is for, how to choose it, its pitfalls |

## In a program

On BNB Chain, `LevelFinance` is a namespace: its contracts need no import.

```sauce chain=bsc
function main() {
  // BNB Chain's liquidityPool, `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874`.
  require(LevelFinance.LiquidityPool != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../../../sauce-chains/references/bsc.md) | liquidityPool | `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874` | `LevelFinance.LiquidityPool` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | liquidityPool | `0x32B7bF19cb8b95C27E644183837813d4b595dcc6` | `LevelFinance.LiquidityPool` |

## ABI

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/level-finance/LiquidityPoolABI.json";` Speaks for: liquidityPool.

- `addLiquidity(address tranche, address token, uint256 amountIn, uint256 minLpAmount, address to)`
- `removeLiquidity(address tranche, address tokenOut, uint256 lpAmount, uint256 minOut, address to)`
- `swap(address tokenIn, address tokenOut, uint256 minOut, address to, bytes extradata)`
