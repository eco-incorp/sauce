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
function main(diamondAddress: Address, pairIndex: Uint256, index: Uint256): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.closeTradeMarket(pairIndex, index);
  return 1;
}

// Update stop loss
import { DiamondABI as IDiamond } from "./abis";
function main(
  diamondAddress: Address,
  pairIndex: Uint256,
  index: Uint256,
  newSl: Uint256,
): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateSl(pairIndex, index, newSl);
  return 1;
}

// Update take profit
import { DiamondABI as IDiamond } from "./abis";
function main(
  diamondAddress: Address,
  pairIndex: Uint256,
  index: Uint256,
  newTp: Uint256,
): Uint256 {
  const diamond = IDiamond.at(diamondAddress);
  diamond.updateTp(pairIndex, index, newTp);
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

- `openTrade(tuple,uint8,uint256)` - Open trade. Tuple: { trader, pairIndex, index, initialPosToken, positionSizeDai, openPrice, buy, leverage, tp, sl }. orderType: 0=market, 1=limit. slippageP: max slippage %
- `closeTradeMarket(uint256,uint256)` - Close at market. Params: pairIndex, index
- `updateSl(uint256,uint256,uint256)` - Update stop loss. Params: pairIndex, index, newSl
- `updateTp(uint256,uint256,uint256)` - Update take profit. Params: pairIndex, index, newTp

## Notes

- TVL: $50M+. Up to 1000x leverage on forex, 250x on crypto
- Diamond proxy pattern - single contract for all operations
- pairIndex identifies the trading pair (0=BTC/USD, 1=ETH/USD, etc.)
- index identifies which trade for a given pair (user can have multiple)
- openTrade uses complex tuple param for trade parameters
