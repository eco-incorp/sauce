# Superfluid

Protocol for real-time finance enabling continuous token streams (per-second payments), distributions, and composable Super Tokens.

## Category

payments | Chains: Ethereum, Polygon, Arbitrum, Optimism, Base

## Key Operations

- **createFlow**: Create a continuous payment stream
- **updateFlow**: Update the flow rate of an existing stream
- **deleteFlow**: Stop/delete a payment stream

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  sauceFunctions,
} from "@eco-incorp/sauce-sdk/protocols/superfluid";
```

## SauceScript Examples

```typescript
// Create payment stream
import { CFAForwarderABI as ICFAForwarder } from "./abis";
function main(
  forwarderAddress: Address,
  token: Address,
  sender: Address,
  receiver: Address,
  flowrate: Uint256,
): Uint256 {
  const forwarder = ICFAForwarder.at(forwarderAddress);
  forwarder.createFlow(token, sender, receiver, flowrate, 0x00);
  return 1;
}

// Update flow rate
import { CFAForwarderABI as ICFAForwarder } from "./abis";
function main(
  forwarderAddress: Address,
  token: Address,
  sender: Address,
  receiver: Address,
  flowrate: Uint256,
): Uint256 {
  const forwarder = ICFAForwarder.at(forwarderAddress);
  forwarder.updateFlow(token, sender, receiver, flowrate, 0x00);
  return 1;
}

// Delete payment stream
import { CFAForwarderABI as ICFAForwarder } from "./abis";
function main(
  forwarderAddress: Address,
  token: Address,
  sender: Address,
  receiver: Address,
): Uint256 {
  const forwarder = ICFAForwarder.at(forwarderAddress);
  forwarder.deleteFlow(token, sender, receiver, 0x00);
  return 1;
}
```

## Key Addresses

| Chain    | Contract     | Address                                      |
| -------- | ------------ | -------------------------------------------- |
| Ethereum | host         | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` |
| Ethereum | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` |
| Polygon  | host         | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` |
| Polygon  | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` |
| Arbitrum | host         | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` |
| Arbitrum | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` |
| Optimism | host         | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` |
| Optimism | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` |
| Base     | host         | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` |
| Base     | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` |

## ABI Methods

### CFAForwarderABI

- `createFlow(address,address,address,int96,bytes)` - Create stream. Params: token (Super Token), sender, receiver, flowrate (tokens per second as int96), userData (arbitrary bytes, 0x00 for none). Returns bool
- `updateFlow(address,address,address,int96,bytes)` - Update flow rate. Params: token, sender, receiver, flowrate (new rate), userData. Returns bool
- `deleteFlow(address,address,address,bytes)` - Delete stream. Params: token, sender, receiver, userData. Returns bool

## Notes

- Flowrate is in tokens per second (int96) - e.g. 1e18 / (30 * 86400) for ~1 token/month
- Uses Super Tokens - wrapped ERC-20s with streaming capability (wrap before streaming)
- Same host and cfaForwarder addresses on all 5 chains
- CFAForwarder is the simplified interface; host is the core protocol contract
- Streams are continuous - balance updates every second without transactions
- Sender must maintain sufficient Super Token balance; otherwise stream gets liquidated
- userData allows passing arbitrary data for composability with other contracts
