<!-- Generated from the SDK's registries. Do not edit. -->

# Superfluid (`superfluid`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

> Superfluid is a payments protocol: payments streamed or scheduled over time. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Protocol for real-time finance enabling continuous token streams (per-second payments), distributions, and composable Super Tokens.

| Fact | Value |
| --- | --- |
| Category | Payments and streaming |
| Family | none |
| Namespace | `Superfluid` on ethereum, optimism, polygon, base, arbitrum |
| Chains | ethereum, optimism, polygon, base, arbitrum |

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

## Notes

- Flowrate is in tokens per second (int96) - e.g. 1e18 / (30 * 86400) for ~1 token/month
- Uses Super Tokens - wrapped ERC-20s with streaming capability (wrap before streaming)
- Same host and cfaForwarder addresses on all 5 chains
- CFAForwarder is the simplified interface; host is the core protocol contract
- Streams are continuous - balance updates every second without transactions
- Sender must maintain sufficient Super Token balance; otherwise stream gets liquidated
- userData allows passing arbitrary data for composability with other contracts

## Its names in a program

On Ethereum, `Superfluid` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's cfaForwarder, `0xcfA132E353cB4E398080B9700609bb008eceB125`.
  require(Superfluid.CFAForwarder != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Ethereum](../chains/ethereum.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |
| [Optimism](../chains/optimism.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Optimism](../chains/optimism.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |
| [Polygon](../chains/polygon.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Polygon](../chains/polygon.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |
| [Base](../chains/base.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Base](../chains/base.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |
| [Arbitrum One](../chains/arbitrum.md) | cfaForwarder | `0xcfA132E353cB4E398080B9700609bb008eceB125` | `Superfluid.CFAForwarder` |
| [Arbitrum One](../chains/arbitrum.md) | host | `0x3E14dC1b13c488a8d5D310918780c983bD5982E7` | `Superfluid.Host` |

## ABI

### `CFAForwarderABI`

`import CFAForwarderABI from "./protocols/superfluid/CFAForwarderABI.json";` Speaks for: cfaForwarder.

- `createFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)`
- `updateFlow(address token, address sender, address receiver, int96 flowrate, bytes userData) returns (bool)`
- `deleteFlow(address token, address sender, address receiver, bytes userData) returns (bool)`
