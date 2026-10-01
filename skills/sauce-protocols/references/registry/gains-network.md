<!-- Generated from the SDK's registries. Do not edit. -->

# Gains Network (`gains-network`)

Decentralized leveraged trading platform (gTrade) supporting crypto, forex, and stocks with synthetic leverage up to 1000x on forex.

| Fact | Value |
| --- | --- |
| Category | Perpetuals |
| Family | none |
| Namespace | none: import its ABI |
| Chains | polygon, arbitrum |
| Document | [gains-network.md](../gains-network.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Polygon's diamond):

```sauce chain=polygon
import DiamondABI from "./protocols/gains-network/DiamondABI.json";

const DIAMOND = 0x209A9A01980377916851af2cA075C2b170452018n;

function main() {
  const bound = DiamondABI.at(DIAMOND);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Polygon](../../../sauce-chains/references/polygon.md) | diamond | `0x209A9A01980377916851af2cA075C2b170452018` | `DiamondABI.at(0x209A9A01980377916851af2cA075C2b170452018n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | diamond | `0xFF162c694eAA571f685030649814282eA457f169` | `DiamondABI.at(0xFF162c694eAA571f685030649814282eA457f169n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gns | `0x18c11FD286C5EC11c3b683Caa813B77f5163A122` | no registry ABI |

## ABI

### `DiamondABI`

`import DiamondABI from "./protocols/gains-network/DiamondABI.json";` Speaks for: diamond.

- `openTrade((address user, uint32 index, uint16 pairIndex, uint24 leverage, bool long, bool isOpen, uint8 collateralIndex, uint8 tradeType, uint120 collateralAmount, uint64 openPrice, uint64 tp, uint64 sl, bool isCounterTrade, uint160 positionSizeToken, uint24 __placeholder) trade, uint16 maxSlippageP, address referrer)`
- `closeTradeMarket(uint32 index, uint64 expectedPrice)`
- `updateSl(uint32 index, uint64 newSl)`
- `updateTp(uint32 index, uint64 newTp)`
