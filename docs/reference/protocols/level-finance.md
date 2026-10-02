<!-- Generated from the SDK's registries. Do not edit. -->

# Level Finance (`level-finance`)

Decentralized perpetual exchange with risk-tranched liquidity pools. Senior (low risk), Mezzanine (medium), and Junior (high risk/reward) tranches.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `LevelFinance` on bsc, arbitrum |
| Chains | bsc, arbitrum |

## Key Operations

- **addLiquidity**: Add liquidity to a specific risk tranche
- **removeLiquidity**: Remove liquidity from a tranche

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Add liquidity to tranche
import { LiquidityPoolABI as ILiquidityPool } from "./abis";
function main(
  poolAddress: Address,
  tranche: Address,
  token: Address,
  amountIn: Uint256,
  minLpAmount: Uint256,
  to: Address,
): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.addLiquidity(tranche, token, amountIn, minLpAmount, to);
  return 1;
}

// Remove liquidity from tranche
import { LiquidityPoolABI as ILiquidityPool } from "./abis";
function main(
  poolAddress: Address,
  tranche: Address,
  tokenOut: Address,
  lpAmount: Uint256,
  minOut: Uint256,
  to: Address,
): Uint256 {
  const pool = ILiquidityPool.at(poolAddress);
  pool.removeLiquidity(tranche, tokenOut, lpAmount, minOut, to);
  return 1;
}
```

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
