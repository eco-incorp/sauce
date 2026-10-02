<!-- Generated from the SDK's registries. Do not edit. -->

# MUX Protocol (`mux-protocol`)

Leveraged trading aggregator on Arbitrum. Routes trades across multiple perpetual DEXs for best execution with shared liquidity pool.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `MuxProtocol` on arbitrum |
| Chains | arbitrum |
| Document | [mux-protocol.md](../mux-protocol.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `MuxProtocol` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's liquidityPool, `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633`.
  require(MuxProtocol.LiquidityPool != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | liquidityPool | `0x3e0199792Ce69DC29A0a36146bFa68bd7C8D6633` | `MuxProtocol.LiquidityPool` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | orderBook | `0xa19fD5aB6C8DCffa2A295F78a5Bb4aC543AAF5e3` | `MuxProtocol.OrderBook` |

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
