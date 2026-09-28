# MUX Protocol

Leveraged trading aggregator on Arbitrum. Routes trades across multiple perpetual DEXs for best execution with shared liquidity pool.

## Category

perpetuals | Chains: Arbitrum

## Key Operations

- **addLiquidity**: Place an order adding liquidity to the MUX pool (receive MLP tokens)
- **removeLiquidity**: Place an order removing liquidity (burn MLP tokens)
- **placePositionOrder3**: Place a leveraged position order
- **cancelOrder**: Cancel a pending order

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce/protocols/mux-protocol";
```

## SauceScript Examples

Liquidity moves through OrderBook orders that MUX brokers fill; the LiquidityPool's own add/remove functions are callable only by the OrderBook.

```typescript
// Add liquidity: a liquidity order that deposits `rawAmount` of asset `assetId`
import { OrderBookABI as IOrderBook } from "./abis";
function main(orderBookAddress: Address, assetId: Uint256, rawAmount: Uint256): Uint256 {
  const orderBook = IOrderBook.at(orderBookAddress);
  orderBook.placeLiquidityOrder(assetId, rawAmount, true);
  return 1;
}

// Remove liquidity: a liquidity order that burns `mlpAmount` MLP for asset `assetId`
import { OrderBookABI as IOrderBook } from "./abis";
function main(orderBookAddress: Address, assetId: Uint256, mlpAmount: Uint256): Uint256 {
  const orderBook = IOrderBook.at(orderBookAddress);
  orderBook.placeLiquidityOrder(assetId, mlpAmount, false);
  return 1;
}
```

## Key Addresses

| Chain    | Contract      | Address                                      |
| -------- | ------------- | -------------------------------------------- |
| Arbitrum | orderBook     | `0xa19fD5aB6C8DCffa2A295F78a5Bb4aC543AAF5e3` |
| Arbitrum | liquidityPool | `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633` |

## ABI Methods

### OrderBookABI

- `placeLiquidityOrder(uint8 assetId, uint96 rawAmount, bool isAdding)` [payable] - Order to add (`isAdding`) or remove liquidity. Adding: approve the asset to the OrderBook first; removing: `rawAmount` is MLP
- `placePositionOrder3(bytes32 subAccountId, uint96 collateralAmount, uint96 size, uint96 price, uint8 profitTokenId, uint8 flags, uint32 deadline, bytes32 referralCode, (uint96 tpPrice, uint96 slPrice, uint8 tpslProfitTokenId, uint32 tpslDeadline) extra)` [payable] - Place a leveraged position order (with optional TP/SL)
- `cancelOrder(uint64 orderId)` - Cancel pending order

### LiquidityPoolABI

- `depositCollateral(bytes32 subAccountId, uint256 rawAmount)` - Deposit collateral into a sub-account
- `getAssetAddress(uint8 assetId) returns (address)` - Token address of an asset id
- `getSubAccount(bytes32 subAccountId) returns (uint96 collateral, uint96 size, uint32 lastIncreasedTime, uint96 entryPrice, uint128 entryFunding)` - A sub-account's position

## Notes

- Aggregates perpetual DEXs (GMX, Gains, etc.) for optimal trade execution
- subAccountId (bytes32) encodes: account address + collateral token ID + asset ID + isLong flag
- tokenId is a uint8 index identifying the collateral asset (0=ETH, 1=BTC, etc.)
- MLP is the liquidity provider token
- Position orders require ETH execution fee sent as msg.value
