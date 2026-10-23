<!-- Generated from the SDK's registries. Do not edit. -->

# Level Finance (`level-finance`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Level Finance is a perpetuals exchange: bet on a price, with leverage and no expiry date. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Decentralized perpetual exchange with risk-tranched liquidity pools. Senior (low risk), Mezzanine (medium), and Junior (high risk/reward) tranches.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `LevelFinance` on bsc, arbitrum |
| Chains | bsc, arbitrum |

## What it offers

- **addLiquidity**: Add liquidity to a specific risk tranche
- **removeLiquidity**: Remove liquidity from a tranche

## Notes

- Risk-tranched pools: Senior (low risk, lower yield), Mezzanine (medium), Junior (high risk, higher yield)
- Each tranche has its own LP token address
- Approve input token to liquidityPool before adding liquidity
- minLpAmount/minOut provide slippage protection

## Its names in a program

On BNB Chain, `LevelFinance` is a namespace: its contracts need no import.

```ts
function main() {
  // BNB Chain's liquidityPool, `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874`.
  require(LevelFinance.LiquidityPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [BNB Chain](../chains/bsc.md) | liquidityPool | `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874` | `LevelFinance.LiquidityPool` |
| [Arbitrum One](../chains/arbitrum.md) | liquidityPool | `0x32B7bF19cb8b95C27E644183837813d4b595dcc6` | `LevelFinance.LiquidityPool` |

## ABI

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/level-finance/LiquidityPoolABI.json";` Speaks for: liquidityPool.

- `addLiquidity(address tranche, address token, uint256 amountIn, uint256 minLpAmount, address to)`
- `removeLiquidity(address tranche, address tokenOut, uint256 lpAmount, uint256 minOut, address to)`
- `swap(address tokenIn, address tokenOut, uint256 minOut, address to, bytes extradata)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
