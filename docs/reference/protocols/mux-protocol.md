<!-- Generated from the SDK's registries. Do not edit. -->

# MUX Protocol (`mux-protocol`)

> MUX Protocol is a perpetuals exchange: bet on a price, with leverage and no expiry date. This page
> lists the chains it is deployed on, the name a program writes for each of its contracts, and the
> functions a program can call.

Leveraged trading aggregator on Arbitrum. Routes trades across multiple perpetual DEXs for best execution with shared liquidity pool.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `MuxProtocol` on arbitrum |
| Chains | arbitrum |

## Key Operations

- **addLiquidity**: Place an order adding liquidity to the MUX pool (receive MLP tokens)
- **removeLiquidity**: Place an order removing liquidity (burn MLP tokens)
- **placePositionOrder3**: Place a leveraged position order
- **cancelOrder**: Cancel a pending order

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Notes

- Aggregates perpetual DEXs (GMX, Gains, etc.) for optimal trade execution
- subAccountId (bytes32) encodes: account address + collateral token ID + asset ID + isLong flag
- tokenId is a uint8 index identifying the collateral asset (0=ETH, 1=BTC, etc.)
- MLP is the liquidity provider token
- Position orders require ETH execution fee sent as msg.value

## Its names in a program

On Arbitrum One, `MuxProtocol` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's liquidityPool, `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633`.
  require(MuxProtocol.LiquidityPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | liquidityPool | `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633` | `MuxProtocol.LiquidityPool` |
| [Arbitrum One](../chains/arbitrum.md) | orderBook | `0xa19fD5aB6C8DCffa2A295F78a5Bb4aC543AAF5e3` | `MuxProtocol.OrderBook` |

## ABI

### `LiquidityPoolABI`

`import LiquidityPoolABI from "./protocols/mux-protocol/LiquidityPoolABI.json";` Speaks for: liquidityPool.

- `depositCollateral(bytes32 subAccountId, uint256 rawAmount)`
- `getAssetAddress(uint8 assetId) view returns (address)`
- `getSubAccount(bytes32 subAccountId) view returns (uint96 collateral, uint96 size, uint32 lastIncreasedTime, uint96 entryPrice, uint128 entryFunding)`

### `OrderBookABI`

`import OrderBookABI from "./protocols/mux-protocol/OrderBookABI.json";` Speaks for: orderBook.

- `cancelOrder(uint64 orderId)`
- `placeLiquidityOrder(uint8 assetId, uint96 rawAmount, bool isAdding) payable`
- `placePositionOrder3(bytes32 subAccountId, uint96 collateralAmount, uint96 size, uint96 price, uint8 profitTokenId, uint8 flags, uint32 deadline, bytes32 referralCode, (uint96 tpPrice, uint96 slPrice, uint8 tpslProfitTokenId, uint32 tpslDeadline) extra) payable`
