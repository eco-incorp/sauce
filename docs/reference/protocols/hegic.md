<!-- Generated from the SDK's registries. Do not edit. -->

# Hegic (`hegic`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Hegic is an options protocol: the right to buy or sell at a set price later. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Hegic` on arbitrum |
| Chains | arbitrum |

## What it offers

- **exerciseOption**: Exercise an options position to claim profit

## Notes

- Simplified options UX - no order books, instant settlement
- Supports ETH and BTC options on Arbitrum
- Options are represented as NFTs with unique IDs
- Exercise is only profitable if option is in-the-money at time of exercise

## Its names in a program

On Arbitrum One, `Hegic` is a namespace: its contracts need no import.

```ts
function main() {
  // Arbitrum One's hegic, `0x431402e8b9dE9aa016C743880e04E517074D8cEC`.
  require(Hegic.Hegic != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Arbitrum One](../chains/arbitrum.md) | hegic | `0x431402e8b9dE9aa016C743880e04E517074D8cEC` | `Hegic.Hegic` |
| [Arbitrum One](../chains/arbitrum.md) | operationalTreasury | `0xec096ea6eB9aa5ea689b0CF00882366E92377371` | `Hegic.OperationalTreasury` |

## ABI

### `HegicABI`

`import HegicABI from "./protocols/hegic/HegicABI.json";` Speaks for: operationalTreasury.

- `payOff(uint256 positionID, address account)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
