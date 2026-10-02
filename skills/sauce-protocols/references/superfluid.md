# Superfluid

Protocol for real-time finance enabling continuous token streams (per-second payments), distributions, and composable Super Tokens.

## Category

payments | Chains and addresses: [registry/superfluid.md](registry/superfluid.md)

## Key Operations

- **createFlow**: Create a continuous payment stream
- **updateFlow**: Update the flow rate of an existing stream
- **deleteFlow**: Stop/delete a payment stream

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/superfluid.md](registry/superfluid.md).

## Notes

- Flowrate is in tokens per second (int96) - e.g. 1e18 / (30 * 86400) for ~1 token/month
- Uses Super Tokens - wrapped ERC-20s with streaming capability (wrap before streaming)
- Same host and cfaForwarder addresses on all 5 chains
- CFAForwarder is the simplified interface; host is the core protocol contract
- Streams are continuous - balance updates every second without transactions
- Sender must maintain sufficient Super Token balance; otherwise stream gets liquidated
- userData allows passing arbitrary data for composability with other contracts
