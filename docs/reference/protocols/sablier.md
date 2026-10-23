<!-- Generated from the SDK's registries. Do not edit. -->

# Sablier (`sablier`)

**Reference** · [Documentation](../../README.md) · [Protocols](../protocols.md)

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

## What it offers

- **withdrawFromStream**: Withdraw accrued tokens from an active stream
- **cancelStream**: Cancel a stream and return remaining tokens to sender
- **createWithDurations**: Create a new linear stream with cliff and total duration

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

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
