# Sablier

Token streaming protocol for continuous payments. Supports linear, cliff, and dynamic vesting schedules with NFT-based stream ownership.

## Category

payments | Chains and addresses: [registry/sablier.md](registry/sablier.md)

## Key Operations

- **withdrawFromStream**: Withdraw accrued tokens from an active stream
- **cancelStream**: Cancel a stream and return remaining tokens to sender
- **createWithDurations**: Create a new linear stream with cliff and total duration

## Typed templates for the raw compiler (not for `sauce compile`)

These import the protocol's ABI from `./abis`, the way the registry compiles them with the raw
compiler; `sauce compile` has no such module. In a program for a chain, name the contract by its
namespace, or import its ABI from `./protocols/<slug>/<Export>.json` as the registry file at the
top of this document shows, and write SauceScript's values (`~0n`, not `type(uint256).max`).

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

## Deployments and ABI

The registry's addresses per chain, how a program names each contract there (a namespace, or
an ABI import bound to the address), and the ABI functions are generated in
[registry/sablier.md](registry/sablier.md).

## Notes

- Streams are ERC-721 NFTs - the stream recipient is the NFT owner
- cliff: no tokens vest until cliff duration passes, then cliff amount vests immediately
- Tokens accrue linearly between cliff and total duration
- Only cancelable streams can be cancelled; non-cancelable streams run to completion
- Approve the streaming asset to lockupLinear before createWithDurations
- amount in withdraw is uint128, not uint256
