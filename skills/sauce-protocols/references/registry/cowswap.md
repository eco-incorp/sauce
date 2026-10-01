<!-- Generated from the SDK's registries. Do not edit. -->

# CoW Swap (`cowswap`)

MEV-protected DEX aggregator using batch auctions and Coincidence of Wants (CoW) to find optimal prices while protecting users from frontrunning.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | none: import its ABI |
| Chains | ethereum, arbitrum |
| Document | [cowswap.md](../cowswap.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Ethereum's gpv2Settlement):

```sauce chain=ethereum
import GPv2SettlementABI from "./protocols/cowswap/GPv2SettlementABI.json";

const GPV2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41n;

function main() {
  const bound = GPv2SettlementABI.at(GPV2_SETTLEMENT);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `GPv2SettlementABI.at(0x9008D19f58AAbD9eD0D60971565AA8510560ab41n)` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `GPv2SettlementABI.at(0x9008D19f58AAbD9eD0D60971565AA8510560ab41n)` |

## ABI

### `GPv2SettlementABI`

`import GPv2SettlementABI from "./protocols/cowswap/GPv2SettlementABI.json";` Speaks for: gpv2Settlement.

- `setPreSignature(bytes orderUid, bool signed)`
- `invalidateOrder(bytes orderUid)`
