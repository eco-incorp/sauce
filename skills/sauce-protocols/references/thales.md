# Thales

Positional markets protocol built on Synthetix offering binary options, speed markets, and sports markets on Optimism.

## Category

options | Chains and addresses: [registry/thales.md](registry/thales.md)

## Key Operations

- **exerciseMarket**: Exercise a matured market position to claim payout
- **buyFromAMM**: Buy positional tokens (UP/DOWN) from the Thales AMM
- **createSpeedMarket**: Create a speed market position

## SauceScript Examples

```typescript
// Buy from AMM
import { ThalesAMMABI as IThalesAMM } from "./abis";
function main(
  thalesAMMAddress: Address,
  market: Address,
  position: Uint256,
  amount: Uint256,
  expectedPayout: Uint256,
  slippage: Uint256,
): Uint256 {
  const amm = IThalesAMM.at(thalesAMMAddress);
  return amm.buyFromAMM(market, position, amount, expectedPayout, slippage);
}

// Exercise a matured market: on the market itself
import { PositionalMarketABI as IPositionalMarket } from "./abis";
function main(market: Address): Uint256 {
  const positionalMarket = IPositionalMarket.at(market);
  positionalMarket.exerciseOptions();
  return 1;
}
```

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/thales.md](registry/thales.md).

## Notes

- Position 0 = UP (price goes up), Position 1 = DOWN (price goes down)
- Markets expire at set times - exercise only after maturation
- Speed markets have short durations (minutes to hours)
- Binary outcome: winning position gets payout, losing gets nothing
- Approve sUSD/USDC to thalesAMM before buying
