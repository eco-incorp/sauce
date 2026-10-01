<!-- Generated from the SDK's registries. Do not edit. -->

# Hegic (`hegic`)

On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | none: import its ABI |
| Chains | arbitrum |
| Document | [hegic.md](../hegic.md): what it is for, how to choose it, its pitfalls |

## In a program

Where it is not a namespace, a program imports the ABI and binds it to the recorded address,
as a module constant a define can replace (here Arbitrum One's operationalTreasury):

```sauce chain=arbitrum
import HegicABI from "./protocols/hegic/HegicABI.json";

const OPERATIONAL_TREASURY = 0xec096ea6eB9aa5ea689b0CF00882366E92377371n;

function main() {
  const bound = HegicABI.at(OPERATIONAL_TREASURY);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | hegic | `0x431402e8b9dE9aa016C743880e04E517074D8cEC` | no registry ABI |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | operationalTreasury | `0xec096ea6eB9aa5ea689b0CF00882366E92377371` | `HegicABI.at(0xec096ea6eB9aa5ea689b0CF00882366E92377371n)` |

## ABI

### `HegicABI`

`import HegicABI from "./protocols/hegic/HegicABI.json";` Speaks for: operationalTreasury.

- `payOff(uint256 positionID, address account)`
