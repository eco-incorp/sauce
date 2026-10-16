<!-- Generated from the SDK's registries. Do not edit. -->

# Thales (`thales`)

> Thales is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Positional markets protocol built on Synthetix offering binary options, speed markets, and sports markets on Optimism.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Thales` on optimism |
| Chains | optimism |

## Key Operations

- **exerciseMarket**: Exercise a matured market position to claim payout
- **buyFromAMM**: Buy positional tokens (UP/DOWN) from the Thales AMM
- **createSpeedMarket**: Create a speed market position

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- Position 0 = UP (price goes up), Position 1 = DOWN (price goes down)
- Markets expire at set times - exercise only after maturation
- Speed markets have short durations (minutes to hours)
- Binary outcome: winning position gets payout, losing gets nothing
- Approve sUSD/USDC to thalesAMM before buying

## Its names in a program

On Optimism, `Thales` is a namespace: its contracts need no import.

```ts
function main() {
  // Optimism's speedMarketsAMM, `0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001`.
  require(Thales.SpeedMarketsAMM != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Optimism](../chains/optimism.md) | speedMarketsAMM | `0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001` | `Thales.SpeedMarketsAMM` |
| [Optimism](../chains/optimism.md) | thalesAMM | `0x278B5A44397c9D8E52743fEdec263c4760dc1A1A` | `Thales.ThalesAMM` |

## ABI

### `PositionalMarketABI`

`import PositionalMarketABI from "./protocols/thales/PositionalMarketABI.json";`

- `exerciseOptions() returns (uint256)`

### `SpeedMarketsAMMABI`

`import SpeedMarketsAMMABI from "./protocols/thales/SpeedMarketsAMMABI.json";` Speaks for: speedMarketsAMM.

- `createNewMarket((address user, bytes32 asset, uint64 strikeTime, uint64 delta, int64 strikePrice, uint64 strikePricePublishTime, uint8 oracleSource, uint8 direction, address collateral, uint256 collateralAmount, address referrer, uint256 skewImpact) params) returns (address marketAddress)`

### `ThalesAMMABI`

`import ThalesAMMABI from "./protocols/thales/ThalesAMMABI.json";` Speaks for: thalesAMM.

- `buyFromAMM(address market, uint8 position, uint256 amount, uint256 expectedPayout, uint256 additionalSlippage) returns (uint256)`
