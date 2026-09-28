# Gains Network

Decentralized leveraged trading platform (gTrade) supporting crypto, forex, and stocks with synthetic leverage up to 1000x on forex pairs. Diamond proxy architecture.

## Category

perpetuals | Chains: Arbitrum, Polygon

## Key Operations

- **closeTradeMarket**: Close an open trade at market price
- **updateStopLoss**: Update stop loss on an open trade
- **updateTakeProfit**: Update take profit on an open trade

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce/protocols/gains-network";
```

## SauceScript Examples

```typescript
// Close trade at market price
import { DiamondABI as IDiamond } from "./abis";
function main(diamondAddress: Address, index: Uint256, expectedPrice: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.closeTradeMarket(index, expectedPrice);
  return 1;
}

// Update stop loss
import { DiamondABI as IDiamond } from "./abis";
function main(diamondAddress: Address, index: Uint256, newSl: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateSl(index, newSl);
  return 1;
}

// Update take profit
import { DiamondABI as IDiamond } from "./abis";
function main(diamondAddress: Address, index: Uint256, newTp: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateTp(index, newTp);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Arbitrum | diamond  | `0xFF162c694eAA571f685030649814282eA457f169` |
| Arbitrum | gns      | `0x18c11FD286C5EC11c3b683Caa813B77f5163A122` |
| Polygon  | diamond  | `0x209A9A01980377916851af2cA075C2b170452018` |

## ABI Methods

### DiamondABI

These are the multi-collateral Diamond's (v8+) signatures. A trade is addressed by the trader's own `index` (their Nth trade), not by `(pairIndex, index)`.

- `openTrade(Trade trade, uint16 maxSlippageP, address referrer)` - Open a trade. Trade: `(address user, uint32 index, uint16 pairIndex, uint24 leverage, bool long, bool isOpen, uint8 collateralIndex, uint8 tradeType, uint120 collateralAmount, uint64 openPrice, uint64 tp, uint64 sl, bool isCounterTrade, uint160 positionSizeToken, uint24 __placeholder)`
- `closeTradeMarket(uint32 index, uint64 expectedPrice)` - Close at market
- `updateSl(uint32 index, uint64 newSl)` - Update stop loss
- `updateTp(uint32 index, uint64 newTp)` - Update take profit

## Notes

- TVL: $50M+. Up to 1000x leverage on forex, 250x on crypto
- Diamond proxy pattern - single contract for all operations
- pairIndex identifies the trading pair (0=BTC/USD, 1=ETH/USD, etc.)
- index identifies one of the trader's trades (a trader can have several)
- openTrade uses complex tuple param for trade parameters
