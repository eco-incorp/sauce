# Sablier

Token streaming protocol for continuous payments. Supports linear, cliff, and dynamic vesting schedules with NFT-based stream ownership.

## Category

payments | Chains: Ethereum

## Key Operations

- **withdrawFromStream**: Withdraw accrued tokens from an active stream
- **cancelStream**: Cancel a stream and return remaining tokens to sender
- **createWithDurations**: Create a new linear stream with cliff and total duration

## SDK Usage

```typescript
import {
  protocolInfo,
  deployments,
  withdrawFromStream,
  cancelStream,
} from "@eco-incorp/sauce/protocols/sablier";
```

## SauceScript Examples

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

## Key Addresses

| Chain    | Contract     | Address                                      |
| -------- | ------------ | -------------------------------------------- |
| Ethereum | lockupLinear | `0xAFb979d9afAd1aD27C5eFf4E27226E3AB9e5dCC9` |

## ABI Methods

### LockupLinearABI

- `createWithDurations(tuple)` - Create linear stream. Returns streamId. Params tuple:
  - `sender` (address) - Who funds the stream
  - `recipient` (address) - Who receives tokens
  - `totalAmount` (uint128) - Total tokens to stream
  - `asset` (address) - ERC-20 token to stream
  - `cancelable` (bool) - Whether sender can cancel
  - `transferable` (bool) - Whether stream NFT is transferable
  - `durations` (tuple) - `{ cliff (uint40), total (uint40) }` in seconds
  - `broker` (tuple) - `{ account (address), fee (uint256) }` - referral fee
- `withdraw(uint256,address,uint128)` - Withdraw accrued tokens. Params: streamId, to (recipient), amount (tokens to withdraw, uint128)
- `cancel(uint256)` - Cancel stream. Params: streamId. Returns unstreamed tokens to sender, accrued to recipient

## Notes

- Streams are ERC-721 NFTs - the stream recipient is the NFT owner
- cliff: no tokens vest until cliff duration passes, then cliff amount vests immediately
- Tokens accrue linearly between cliff and total duration
- Only cancelable streams can be cancelled; non-cancelable streams run to completion
- Approve the streaming asset to lockupLinear before createWithDurations
- amount in withdraw is uint128, not uint256
