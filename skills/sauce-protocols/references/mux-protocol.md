# MUX Protocol

Leveraged trading aggregator on Arbitrum. Routes trades across multiple perpetual DEXs with shared liquidity pool.

## Category

perpetuals | Chains and addresses: [registry/mux-protocol.md](registry/mux-protocol.md)

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/mux-protocol.md](registry/mux-protocol.md).

## Notes

- Aggregates perpetual DEXs (GMX, Gains, etc.)
- subAccountId (bytes32) encodes: account address + collateral token ID + asset ID + isLong flag
- tokenId is a uint8 index identifying the collateral asset (0=ETH, 1=BTC, etc.)
- MLP is the liquidity provider token
- Position orders require ETH execution fee sent as msg.value
