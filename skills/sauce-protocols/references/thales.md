# Thales

Positional markets protocol built on Synthetix offering binary options, speed markets, and sports markets on Optimism.

## Category

options | Chains: Optimism

## Key Operations

- **exerciseMarket**: Exercise a matured market position to claim payout
- **buyFromAMM**: Buy positional tokens (UP/DOWN) from the Thales AMM
- **createSpeedMarket**: Create a speed market position

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  exerciseMarket,
  buyFromAMM,
} from "@eco-incorp/sauce/protocols/thales";
```

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

## Key Addresses

| Chain    | Contract        | Address                                      |
| -------- | --------------- | -------------------------------------------- |
| Optimism | thalesAMM       | `0x278B5A44397c9D8E52743fEdec263c4760dc1A1A` |
| Optimism | speedMarketsAMM | `0xE16B8a01490835EC1e76bAbbB3Cadd8921b32001` |

## ABI Methods

### ThalesAMMABI

- `buyFromAMM(address,uint8,uint256,uint256,uint256) returns (uint256)` - Buy positional tokens. Params: market (market address), position (0=UP, 1=DOWN), amount (tokens to buy), expectedPayout (expected return), additionalSlippage (slippage tolerance). Returns the amount paid

### PositionalMarketABI

- `exerciseOptions() returns (uint256)` - Exercise the caller's positions in a matured market (called on the market, not the AMM)

### SpeedMarketsAMMABI

- `createNewMarket(CreateMarketParams) returns (address)` - Create a speed market. One struct: `(address user, bytes32 asset, uint64 strikeTime, uint64 delta, int64 strikePrice, uint64 strikePricePublishTime, uint8 oracleSource, uint8 direction, address collateral, uint256 collateralAmount, address referrer, uint256 skewImpact)`. Returns the market address

## Notes

- Position 0 = UP (price goes up), Position 1 = DOWN (price goes down)
- Markets expire at set times - exercise only after maturation
- Speed markets have short durations (minutes to hours)
- Binary outcome: winning position gets payout, losing gets nothing
- Approve sUSD/USDC to thalesAMM before buying
