# Level Finance

Decentralized perpetual exchange with risk-tranched liquidity pools. Senior (low risk), Mezzanine (medium), and Junior (high risk/reward) tranches.

## Category

perpetuals | Chains: BSC, Arbitrum

## Key Operations

- **addLiquidity**: Add liquidity to a specific risk tranche
- **removeLiquidity**: Remove liquidity from a tranche

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  addLiquidity,
  removeLiquidity,
} from "@eco-incorp/sauce/protocols/level-finance";
```

## SauceScript Examples

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

## Key Addresses

| Chain    | Contract      | Address                                      |
| -------- | ------------- | -------------------------------------------- |
| BSC      | liquidityPool | `0xA5aBFB56a78D2BD4689b25B8A77fd49Bb0675874` |
| Arbitrum | liquidityPool | `0x32B7bF19cb8b95C27E644183837813d4b595dcc6` |

## ABI Methods

### LiquidityPoolABI

- `addLiquidity(address,address,uint256,uint256,address)` - Add liquidity. Params: tranche address, token, amountIn, minLpAmount, to (receives the LP tokens)
- `removeLiquidity(address,address,uint256,uint256,address)` - Remove liquidity. Params: tranche, tokenOut, lpAmount, minOut, to (receives tokenOut)
- `swap(address,address,uint256,address,bytes)` - Swap tokens. Params: tokenIn, tokenOut, minOut, to, extradata

## Notes

- Risk-tranched pools: Senior (low risk, lower yield), Mezzanine (medium), Junior (high risk, higher yield)
- Each tranche has its own LP token address
- Approve input token to liquidityPool before adding liquidity
- minLpAmount/minOut provide slippage protection
