# Hegic

On-chain options trading protocol allowing users to buy call and put options on ETH and BTC with simplified UX.

## Category

options | Chains: Arbitrum

## Key Operations

- **exerciseOption**: Exercise an options position to claim profit

## SDK Usage

```typescript
import { protocolInfo, deployments, sauceFunctions } from "@eco-incorp/sauce-sdk/protocols/hegic";
```

## SauceScript Examples

```typescript
// Exercise option
import { HegicABI as IHegic } from "./abis";
function main(hegicAddress: Address, optionId: Uint256): Uint256 {
  const hegic = IHegic.at(hegicAddress);
  hegic.exercise(optionId);
  return 1;
}
```

## Key Addresses

| Chain    | Contract | Address                                      |
| -------- | -------- | -------------------------------------------- |
| Arbitrum | hegic    | `0x431402e8b9dE9aa016C743880e04E517074D8cEC` |

## ABI Methods

### HegicABI

- `exercise(uint256)` - Exercise option by ID. Params: optionId (NFT token ID of the option)

## Notes

- Simplified options UX - no order books, instant settlement
- Supports ETH and BTC options on Arbitrum
- Options are represented as NFTs with unique IDs
- Exercise is only profitable if option is in-the-money at time of exercise
