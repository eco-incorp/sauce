<!-- Generated from the SDK's registries. Do not edit. -->

# Gains Network (`gains-network`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Gains Network is a perpetuals exchange: bet on a price, with leverage and no expiry date. This
> page lists the chains it is deployed on, the name a program writes for each of its contracts, and
> the functions a program can call.

Decentralized leveraged trading platform (gTrade) supporting crypto, forex, and stocks with synthetic leverage up to 1000x on forex pairs. Diamond proxy architecture.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | `GainsNetwork` on polygon, arbitrum |
| Chains | polygon, arbitrum |

## What it offers

- **closeTradeMarket**: Close an open trade at market price
- **updateStopLoss**: Update stop loss on an open trade
- **updateTakeProfit**: Update take profit on an open trade

## Notes

- TVL: $50M+. Up to 1000x leverage on forex, 250x on crypto
- Diamond proxy pattern - single contract for all operations
- pairIndex identifies the trading pair (0=BTC/USD, 1=ETH/USD, etc.)
- index identifies one of the trader's trades (a trader can have several)
- openTrade uses complex tuple param for trade parameters
- These are the multi-collateral Diamond's (v8+) signatures. A trade is addressed by the trader's own `index` (their Nth trade), not by `(pairIndex, index)`.

## Its names in a program

On Polygon, `GainsNetwork` is a namespace: its contracts need no import.

```ts
function main() {
  // Polygon's diamond, `0x209A9A01980377916851af2cA075C2b170452018`.
  require(GainsNetwork.Diamond != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Polygon](../chains/polygon.md) | diamond | `0x209A9A01980377916851af2cA075C2b170452018` | `GainsNetwork.Diamond` |
| [Arbitrum One](../chains/arbitrum.md) | diamond | `0xFF162c694eAA571f685030649814282eA457f169` | `GainsNetwork.Diamond` |
| [Arbitrum One](../chains/arbitrum.md) | gns | `0x18c11FD286C5EC11c3b683Caa813B77f5163A122` | `GainsNetwork.Gns` |

## ABI

### `DiamondABI`

`import DiamondABI from "./protocols/gains-network/DiamondABI.json";` Speaks for: diamond.

- `openTrade((address user, uint32 index, uint16 pairIndex, uint24 leverage, bool long, bool isOpen, uint8 collateralIndex, uint8 tradeType, uint120 collateralAmount, uint64 openPrice, uint64 tp, uint64 sl, bool isCounterTrade, uint160 positionSizeToken, uint24 __placeholder) trade, uint16 maxSlippageP, address referrer)`
- `closeTradeMarket(uint32 index, uint64 expectedPrice)`
- `updateSl(uint32 index, uint64 newSl)`
- `updateTp(uint32 index, uint64 newTp)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
