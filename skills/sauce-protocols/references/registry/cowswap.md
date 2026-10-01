<!-- Generated from the SDK's registries. Do not edit. -->

# CoW Swap (`cowswap`)

MEV-protected DEX aggregator using batch auctions and Coincidence of Wants (CoW) to find optimal prices while protecting users from frontrunning.

| Fact | Value |
| --- | --- |
| Category | Aggregators |
| Family | none |
| Namespace | `Cowswap` on ethereum, arbitrum |
| Chains | ethereum, arbitrum |
| Document | [cowswap.md](../cowswap.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Cowswap` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's gpv2Settlement, `0x9008D19f58AAbD9eD0D60971565AA8510560ab41`.
  require(Cowswap.GPv2Settlement != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | gpv2Settlement | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | `Cowswap.GPv2Settlement` |

## ABI

### `GPv2SettlementABI`

`import GPv2SettlementABI from "./protocols/cowswap/GPv2SettlementABI.json";` Speaks for: gpv2Settlement.

- `setPreSignature(bytes orderUid, bool signed)`
- `invalidateOrder(bytes orderUid)`
