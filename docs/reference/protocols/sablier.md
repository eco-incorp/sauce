<!-- Generated from the SDK's registries. Do not edit. -->

# Sablier (`sablier`)

> Sablier is a payments protocol: payments streamed or scheduled over time. This page lists the
> chains it is deployed on, the name a program writes for each of its contracts, and the functions a
> program can call.

Token streaming protocol for continuous payments. Supports linear, cliff, and dynamic vesting schedules with NFT-based stream ownership.

| Fact | Value |
| --- | --- |
| Category | Payments and streaming |
| Family | none |
| Namespace | `Sablier` on ethereum |
| Chains | ethereum |

## Key Operations

- **withdrawFromStream**: Withdraw accrued tokens from an active stream
- **cancelStream**: Cancel a stream and return remaining tokens to sender
- **createWithDurations**: Create a new linear stream with cliff and total duration

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0`, not `type(uint256).max`).

```typescript
// Withdraw from stream
import { LockupLinearABI as ILockupLinear } from "./abis";
function main(
  lockupLinearAddress: Address,
  streamId: Uint256,
  to: Address,
  amount: Uint256,
): Uint256 {
  const lockup = ILockupLinear.at(lockupLinearAddress);
  lockup.withdraw(streamId, to, amount);
  return 1;
}

// Cancel stream
import { LockupLinearABI as ILockupLinear } from "./abis";
function main(lockupLinearAddress: Address, streamId: Uint256): Uint256 {
  const lockup = ILockupLinear.at(lockupLinearAddress);
  lockup.cancel(streamId);
  return 1;
}
```

## Notes

- Streams are ERC-721 NFTs - the stream recipient is the NFT owner
- cliff: no tokens vest until cliff duration passes, then cliff amount vests immediately
- Tokens accrue linearly between cliff and total duration
- Only cancelable streams can be cancelled; non-cancelable streams run to completion
- Approve the streaming asset to lockupLinear before createWithDurations
- amount in withdraw is uint128, not uint256

## Its names in a program

On Ethereum, `Sablier` is a namespace: its contracts need no import.

```ts
function main() {
  // Ethereum's lockupLinear, `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9`.
  require(Sablier.LockupLinear != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../chains/ethereum.md) | lockupLinear | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` | `Sablier.LockupLinear` |

## ABI

### `LockupLinearABI`

`import LockupLinearABI from "./protocols/sablier/LockupLinearABI.json";` Speaks for: lockupLinear.

- `createWithDurations((address sender, address recipient, uint128 totalAmount, address asset, bool cancelable, bool transferable, (uint40 cliff, uint40 total) durations, (address account, uint256 fee) broker) params) returns (uint256 streamId)`
- `withdraw(uint256 streamId, address to, uint128 amount)`
- `cancel(uint256 streamId)`
