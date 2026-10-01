# The eco-routes Portal

One Portal contract per chain is both sides of an intent: the source side escrows rewards, the
destination side fills routes. Its address on each chain is in that chain's file in `sauce-chains`.
`Reward` is `(uint64 deadline, address creator, address prover, uint256 nativeAmount, (address token, uint256 amount)[] tokens)`
and `Route` is
`(bytes32 salt, uint64 deadline, address portal, uint256 nativeAmount, (address token, uint256 amount)[] tokens, (address target, bytes data, uint256 value)[] calls)`;
`route` as `bytes` is `abi.encode(Route)`.

## Source side: escrow, publication, claim and refund

- `publish(uint64 destination, bytes route, Reward reward)`, `0x645c890c`: records the intent and
  emits `IntentPublished`. Needs no funding, anyone may send it, and sending it again re-emits the
  event. Returns `(bytes32 intentHash, address vault)`.
- `publishAndFund(uint64 destination, bytes route, Reward reward, bool allowPartial)`,
  `0xdf00f8fa`, payable: `publish`, then pulls the reward from the sender into the vault, through
  an allowance to the **Portal**, and the native reward from the value. With `allowPartial` false it
  reverts `InsufficientFunds` unless the whole reward is covered. Emits `IntentPublished` and
  `IntentFunded`, and sets the status to Funded.
- `fund(uint64 destination, bytes32 routeHash, Reward reward, bool allowPartial)`, `0x9f24b4dd`,
  payable: the funding half alone. Emits `IntentFunded`, never `IntentPublished`.
- `intentVaultAddress(uint64 destination, bytes route, Reward reward)`, `0x0742ebe4`, view: the
  intent's vault, an address derived from the intent hash (CREATE2 by the Portal). It holds what is
  sent to it before any contract is deployed there.
- `isIntentFunded(uint64 destination, bytes route, Reward reward)`, `0x0fa76b79`, view: true when
  the status is Funded or the vault holds the whole reward, native and every token.
- `getIntentHash(uint64 destination, bytes route, Reward reward)`, `0x6063cd5b`, pure:
  `(intentHash, routeHash, rewardHash)`.
- `getRewardStatus(bytes32 intentHash)`, `0x1299d617`, view: 0 Initial, 1 Funded, 2 Withdrawn,
  3 Refunded. A vault funded by a transfer stays Initial.
- `withdraw(uint64 destination, bytes32 routeHash, Reward reward)`, `0xf987b9bc`: once the reward's
  prover has recorded the fill, pays the reward to the claimant the fill named. Anyone may send it.
- `refund(uint64 destination, bytes32 routeHash, Reward reward)`, `0x308adade`: after the reward's
  deadline, with no fill proven, returns the vault's reward tokens and native balance to the
  creator. Anyone may send it; before the deadline it reverts `InvalidStatusForRefund`. A proven
  but unclaimed intent cannot be refunded.
- `refundTo(uint64 destination, bytes32 routeHash, Reward reward, address refundee)`, `0x572ac041`:
  the same, sent by the creator, to a recipient the creator names.

## Destination side: the fill

- `fulfill(bytes32 intentHash, Route route, bytes32 rewardHash, bytes32 claimant)`, `0x52a8339e`,
  payable: checks the route's deadline (`IntentExpired`), that `route.portal` is this Portal
  (`InvalidPortal`), that the hash matches (`InvalidHash`), that it was not filled
  (`IntentAlreadyFulfilled`) and that the value covers `route.nativeAmount`
  (`InsufficientNativeAmount(sent, required)`); pulls each of the route's tokens from the sender,
  through an allowance to this Portal, into its Executor; and has the Executor run the calls,
  forwarding `route.nativeAmount`.
- `executor()`, `0xc34c08e5`, view: the Executor, which owns the chain's shared intent Pot. It
  reverts `CallToEOA(target)` (`0x2db59289`) for a call with data to an address with no code, and
  `CallFailed(call, result)` (`0x12988136`) when a call reverts, with the call's own revert data in
  `result`. It checks nothing else: a token transfer that returns `false` passes.

## Events

| Event                                                                                                                                                                                                                | Topic                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `IntentPublished(bytes32 indexed intentHash, uint64 destination, bytes route, address indexed creator, address indexed prover, uint64 rewardDeadline, uint256 rewardNativeAmount, (address,uint256)[] rewardTokens)` | `0x43974895be1bcec7344337863fa7de24a0d1c315c0a994f663fe0ee220ddc8e4` |
| `IntentFunded(bytes32 intentHash, address funder, bool complete)`                                                                                                                                                    | `0xc1ed05721d27ad6b2555d61388ac393b120f5cc0e6009e53230e02c68e60064a` |
| `IntentFulfilled(bytes32 indexed intentHash, bytes32 indexed claimant)`, on the destination                                                                                                                          | `0xc471de166a60c0b81727dfa2f57d4fc3ad1b45b057c1f034b7058365613bde8d` |
| `IntentProven(bytes32 indexed intentHash, bytes32 indexed claimant)`                                                                                                                                                 | `0xe6d8040a8a6bc519f4e5a42fb2677067c929ddbf2cca9287a44b23fb617a6f00` |
| `IntentWithdrawn(bytes32 intentHash, address indexed claimant)`                                                                                                                                                      | `0xbb062c23e818de8ea9c157514eb098052cf36904bbe431cd50d4ec92264ca3ac` |
| `IntentRefunded(bytes32 intentHash, address indexed refundee)`                                                                                                                                                       | `0x8d53c2b04800cf061b987a07179bb6c9730c05536b2f6a3a091fe62303682eb6` |

## Errors

| Error                                                                         | Selector     | When                                                     |
| ----------------------------------------------------------------------------- | ------------ | -------------------------------------------------------- |
| `InsufficientNativeAmount(uint256 sent, uint256 required)`                    | `0x172f1184` | `fulfill` with less value than `route.nativeAmount`      |
| `InvalidStatusForRefund(uint8 status, uint256 currentTime, uint256 deadline)` | `0xc6a2514b` | `refund` before the reward's deadline                    |
| `InsufficientFunds(bytes32 intentHash)`                                       | `0x07b90620` | `publishAndFund`/`fund` that cannot cover the reward     |
| `IntentExpired()`                                                             | `0x408b2234` | `fulfill` after the route's deadline                     |
| `InvalidHash(bytes32 expectedHash)`                                           | `0x44d659bf` | `fulfill` whose route and reward hash differently        |
| `InvalidPortal(address portal)`                                               | `0xd16be752` | `fulfill` on a Portal the route does not name            |
| `IntentAlreadyFulfilled(bytes32 intentHash)`                                  | `0x373d2079` | a second `fulfill`                                       |
| `CallToEOA(address target)` (the Executor)                                    | `0x2db59289` | a route call with data to an address with no code        |
| `CallFailed((address,bytes,uint256) call, bytes result)` (the Executor)       | `0x12988136` | a route call that reverted (`result` is its revert data) |
