<!-- Generated from the SDK's registries. Do not edit. -->

# Hegic (`hegic`)

On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.

| Fact | Value |
| --- | --- |
| Category | Options |
| Family | none |
| Namespace | `Hegic` on arbitrum |
| Chains | arbitrum |

## Key Operations

- **exerciseOption**: Exercise an options position to claim profit

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Exercise option: the OperationalTreasury pays off the position to `account`
import { HegicABI as IHegic } from "./abis";
function main(treasuryAddress: Address, optionId: Uint256, account: Address): Uint256 {
  const treasury = IHegic.at(treasuryAddress);
  treasury.payOff(optionId, account);
  return 1;
}
```

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
