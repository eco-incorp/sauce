# Pyth Network

High-fidelity oracle network providing low-latency price feeds from institutional sources. Uses pull-based model for efficient on-chain price updates.

## Category
oracle | Chains: Ethereum

## Key Operations
- **getPrice**: Read price from Pyth oracle by price feed ID

## SDK Usage
```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/pyth";
```

## SauceScript Examples
```typescript
// Get price by feed ID
import { PythOracleABI as IPythOracle } from "./abis";
function main(oracleAddress: Address, priceId: Uint256): { price: Uint256, conf: Uint256, expo: Uint256, publishTime: Uint256 } {
  const oracle = IPythOracle.at(oracleAddress);
  return oracle.getPrice(priceId);
}
```

## Key Addresses
| Chain | Contract | Address |
|-------|----------|---------|
| Ethereum | oracle | `0x4305FB66699C3B2702D4d05CF36551390A4c69C6` |

## ABI Methods
### PythOracleABI
- `getPrice(bytes32)` - Get price for a feed ID. Params: id (bytes32 price feed identifier). Returns Price tuple: (price int64, conf uint64, expo int32, publishTime uint256)
  - `price` - Latest price value
  - `conf` - Confidence interval (uncertainty)
  - `expo` - Price exponent (e.g. -8 means divide by 10^8)
  - `publishTime` - When price was published
- `updatePriceFeeds(bytes[])` - Submit price updates on-chain. Payable (requires update fee). Params: updateData (Pyth price update VAAs from Hermes API)
- `getUpdateFee(bytes[])` - Get fee required for price update. Params: updateData. Returns feeAmount in wei

## Notes
- Pull-based oracle: users must call updatePriceFeeds before reading prices
- Sub-second latency from institutional market data providers
- Actual price = price * 10^expo (e.g. price=12345, expo=-2 means $123.45)
- Price feed IDs are bytes32 - see Pyth docs for specific feed IDs per asset
- updatePriceFeeds requires sending ETH to pay the update fee (use getUpdateFee to check)
- Get price update data from Pyth Hermes API off-chain, then submit on-chain
