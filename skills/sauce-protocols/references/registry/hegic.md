<!-- Generated from the SDK's registries. Do not edit. -->

# Hegic (`hegic`)

On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Hegic` on arbitrum |
| Chains | arbitrum |
| Document | [hegic.md](../hegic.md): what it is for, how to choose it, its pitfalls |

## In a program

On Arbitrum One, `Hegic` is a namespace: its contracts need no import.

```sauce chain=arbitrum
function main() {
  // Arbitrum One's hegic, `0x431402e8b9dE9aa016C743880e04E517074D8cEC`.
  require(Hegic.Hegic != 0n);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | hegic | `0x431402e8b9dE9aa016C743880e04E517074D8cEC` | `Hegic.Hegic` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | operationalTreasury | `0xec096ea6eB9aa5ea689b0CF00882366E92377371` | `Hegic.OperationalTreasury` |

## ABI

### `HegicABI`

`import HegicABI from "./protocols/hegic/HegicABI.json";` Speaks for: operationalTreasury.

- `payOff(uint256 positionID, address account)`
