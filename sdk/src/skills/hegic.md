# Hegic

On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.

## Category

options | Chains: Arbitrum

## Key Operations

- **exerciseOption**: Exercise an options position to claim profit

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce/protocols/hegic";
```

## SauceScript Examples

```typescript
// Exercise option: the OperationalTreasury pays off the position to `account`
import { HegicABI as IHegic } from "./abis";
function main(treasuryAddress: Address, optionId: Uint256, account: Address): Uint256 {
  const treasury = IHegic.at(treasuryAddress);
  treasury.payOff(optionId, account);
  return 1;
}
```

## Key Addresses

| Chain    | Contract            | Address                                                    |
| -------- | ------------------- | ---------------------------------------------------------- |
| Arbitrum | hegic               | `0x431402e8b9dE9aa016C743880e04E517074D8cEC` (HEGIC token) |
| Arbitrum | operationalTreasury | `0xec096ea6eB9aa5ea689b0CF00882366E92377371`               |

## ABI Methods

### HegicABI

- `payOff(uint256 positionID, address account)` - Exercise an option by ID on the OperationalTreasury; the payout goes to `account`

## Notes

- Simplified options UX - no order books, instant settlement
- Supports ETH and BTC options on Arbitrum
- Options are represented as NFTs with unique IDs
- Exercise is only profitable if option is in-the-money at time of exercise
