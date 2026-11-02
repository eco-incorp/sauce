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

`import LockupLinearABI from "./protocols/sablier/LockupLinearABI.json";` Speaks for: lockupLinear. The import is the contract's full ABI across every deployment; call it through the `Sablier` namespace to have a function a chain's deployment does not run refused.

- `admin() view returns (address)`
- `approve(address to, uint256 tokenId)`
- `balanceOf(address owner) view returns (uint256)`
- `burn(uint256 streamId)`
- `cancel(uint256 streamId)`
- `cancelMultiple(uint256[] streamIds)`
- `claimProtocolRevenues(address asset)`
- `comptroller() view returns (address)`
- `createWithDurations((address sender, address recipient, uint128 totalAmount, address asset, bool cancelable, bool transferable, (uint40 cliff, uint40 total) durations, (address account, uint256 fee) broker) params) returns (uint256 streamId)`
- `createWithRange((address sender, address recipient, uint128 totalAmount, address asset, bool cancelable, bool transferable, (uint40 start, uint40 cliff, uint40 end) range, (address account, uint256 fee) broker) params) returns (uint256 streamId)`
- `getApproved(uint256 tokenId) view returns (address)`
- `getAsset(uint256 streamId) view returns (address asset)`
- `getCliffTime(uint256 streamId) view returns (uint40 cliffTime)`
- `getDepositedAmount(uint256 streamId) view returns (uint128 depositedAmount)`
- `getEndTime(uint256 streamId) view returns (uint40 endTime)`
- `getRange(uint256 streamId) view returns ((uint40 start, uint40 cliff, uint40 end) range)`
- `getRecipient(uint256 streamId) view returns (address recipient)`
- `getRefundedAmount(uint256 streamId) view returns (uint128 refundedAmount)`
- `getSender(uint256 streamId) view returns (address sender)`
- `getStartTime(uint256 streamId) view returns (uint40 startTime)`
- `getStream(uint256 streamId) view returns ((address sender, uint40 startTime, uint40 cliffTime, bool isCancelable, bool wasCanceled, address asset, uint40 endTime, bool isDepleted, bool isStream, bool isTransferable, (uint128 deposited, uint128 withdrawn, uint128 refunded) amounts) stream)`
- `getWithdrawnAmount(uint256 streamId) view returns (uint128 withdrawnAmount)`
- `isApprovedForAll(address owner, address operator) view returns (bool)`
- `isCancelable(uint256 streamId) view returns (bool result)`
- `isCold(uint256 streamId) view returns (bool result)`
- `isDepleted(uint256 streamId) view returns (bool result)`
- `isStream(uint256 streamId) view returns (bool result)`
- `isTransferable(uint256 streamId) view returns (bool result)`
- `isWarm(uint256 streamId) view returns (bool result)`
- `MAX_FEE() view returns (uint256)`
- `name() view returns (string)`
- `nextStreamId() view returns (uint256)`
- `ownerOf(uint256 tokenId) view returns (address)`
- `protocolRevenues(address asset) view returns (uint128 revenues)`
- `refundableAmountOf(uint256 streamId) view returns (uint128 refundableAmount)`
- `renounce(uint256 streamId)`
- `safeTransferFrom(address from, address to, uint256 tokenId)`
- `safeTransferFrom(address from, address to, uint256 tokenId, bytes data)`
- `setApprovalForAll(address operator, bool approved)`
- `setComptroller(address newComptroller)`
- `setNFTDescriptor(address newNFTDescriptor)`
- `statusOf(uint256 streamId) view returns (uint8 status)`
- `streamedAmountOf(uint256 streamId) view returns (uint128 streamedAmount)`
- `supportsInterface(bytes4 interfaceId) view returns (bool)`
- `symbol() view returns (string)`
- `tokenURI(uint256 streamId) view returns (string uri)`
- `transferAdmin(address newAdmin)`
- `transferFrom(address from, address to, uint256 tokenId)`
- `wasCanceled(uint256 streamId) view returns (bool result)`
- `withdraw(uint256 streamId, address to, uint128 amount)`
- `withdrawableAmountOf(uint256 streamId) view returns (uint128 withdrawableAmount)`
- `withdrawMax(uint256 streamId, address to)`
- `withdrawMaxAndTransfer(uint256 streamId, address newRecipient)`
- `withdrawMultiple(uint256[] streamIds, address to, uint128[] amounts)`

## Next

- [Protocols](../protocols.md): the other protocols, by what they do.
- [Protocols and tokens](../../guides/protocols-and-tokens.md): calling a contract by its namespace, or through its ABI.
- [Glossary](../../concepts/glossary.md): the words these pages use, in plain terms.
