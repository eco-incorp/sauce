<!-- Generated from the SDK's registries. Do not edit. -->

# Hop Protocol (`hop`)

Token bridge for rollups using bonders for fast withdrawals. Supports ETH, USDC, USDT, DAI, and MATIC bridging across L2s.

| Fact | Value |
| --- | --- |
| Category | Bridges |
| Family | none |
| Namespace | `Hop` on ethereum, optimism, polygon, base, arbitrum |
| Chains | ethereum, optimism, polygon, base, arbitrum |
| Document | [hop.md](../hop.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Hop` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's l1EthBridge, `0xb8901acB165ed027E32754E0FFe830802919727f`.
  require(Hop.L1EthBridge != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1EthBridge | `0xb8901acB165ed027E32754E0FFe830802919727f` | `Hop.L1EthBridge`; not on this deployment: `challengeTransferBond`, `l1CanonicalToken`, `resolveChallenge`, `transferRootCommittedAt` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | l1UsdcBridge | `0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a` | `Hop.L1UsdcBridge`; not on this deployment: `challengeTransferBond`, `resolveChallenge`, `transferRootCommittedAt` |
| [Optimism](../../../sauce-chains/references/optimism.md) | l2AmmWrapper | `0x86cA30bEF97fB651b8d866D45503684b90cb3312` | `Hop.L2AmmWrapper` |
| [Polygon](../../../sauce-chains/references/polygon.md) | l2AmmWrapper | `0x76b22b8C1079A44F1211D867D68b1eda76a635A7` | `Hop.L2AmmWrapper` |
| [Base](../../../sauce-chains/references/base.md) | l2AmmWrapper | `0x10541b07d8Ad2647Dc6cD67abd4c03575dade261` | `Hop.L2AmmWrapper` |
| [Arbitrum One](../../../sauce-chains/references/arbitrum.md) | l2AmmWrapper | `0x33ceb27b39d2Bb7D2e61F7564d3Df29344020417` | `Hop.L2AmmWrapper` |

## ABI

### `HopL1BridgeABI`

`import HopL1BridgeABI from "./protocols/hop/HopL1BridgeABI.json";` Speaks for: l1EthBridge, l1UsdcBridge.

- `addBonder(address bonder)`
- `bondTransferRoot(bytes32 rootHash, uint256 destinationChainId, uint256 totalAmount)`
- `bondWithdrawal(address recipient, uint256 amount, bytes32 transferNonce, uint256 bonderFee)`
- `chainBalance(uint256) view returns (uint256)`
- `CHALLENGE_AMOUNT_DIVISOR() view returns (uint256)`
- `challengePeriod() view returns (uint256)`
- `challengeResolutionPeriod() view returns (uint256)`
- `challengeTransferBond(bytes32 rootHash, uint256 originalAmount) payable`
- `challengeTransferBond(bytes32 rootHash, uint256 originalAmount, uint256 destinationChainId) payable`
- `confirmTransferRoot(uint256 originChainId, bytes32 rootHash, uint256 destinationChainId, uint256 totalAmount, uint256 rootCommittedAt)`
- `crossDomainMessengerWrappers(uint256) view returns (address)`
- `getBondedWithdrawalAmount(address bonder, bytes32 transferId) view returns (uint256)`
- `getBondForTransferAmount(uint256 amount) pure returns (uint256)`
- `getChainId() view returns (uint256 chainId)`
- `getChallengeAmountForTransferAmount(uint256 amount) pure returns (uint256)`
- `getCredit(address bonder) view returns (uint256)`
- `getDebitAndAdditionalDebit(address bonder) view returns (uint256)`
- `getIsBonder(address maybeBonder) view returns (bool)`
- `getRawDebit(address bonder) view returns (uint256)`
- `getTimeSlot(uint256 time) pure returns (uint256)`
- `getTransferId(uint256 chainId, address recipient, uint256 amount, bytes32 transferNonce, uint256 bonderFee, uint256 amountOutMin, uint256 deadline) pure returns (bytes32)`
- `getTransferRoot(bytes32 rootHash, uint256 totalAmount) view returns ((uint256 total, uint256 amountWithdrawn, uint256 createdAt))`
- `getTransferRootId(bytes32 rootHash, uint256 totalAmount) pure returns (bytes32)`
- `governance() view returns (address)`
- `isChainIdPaused(uint256) view returns (bool)`
- `isTransferIdSpent(bytes32 transferId) view returns (bool)`
- `l1CanonicalToken() view returns (address)`
- `minTransferRootBondDelay() view returns (uint256)`
- `removeBonder(address bonder)`
- `rescueTransferRoot(bytes32 rootHash, uint256 originalAmount, address recipient)`
- `resolveChallenge(bytes32 rootHash, uint256 originalAmount)`
- `resolveChallenge(bytes32 rootHash, uint256 originalAmount, uint256 destinationChainId)`
- `sendToL2(uint256 chainId, address recipient, uint256 amount, uint256 amountOutMin, uint256 deadline, address relayer, uint256 relayerFee) payable`
- `setChainIdDepositsPaused(uint256 chainId, bool isPaused)`
- `setChallengePeriod(uint256 _challengePeriod)`
- `setChallengeResolutionPeriod(uint256 _challengeResolutionPeriod)`
- `setCrossDomainMessengerWrapper(uint256 chainId, address _crossDomainMessengerWrapper)`
- `setGovernance(address _newGovernance)`
- `setMinTransferRootBondDelay(uint256 _minTransferRootBondDelay)`
- `settleBondedWithdrawal(address bonder, bytes32 transferId, bytes32 rootHash, uint256 transferRootTotalAmount, uint256 transferIdTreeIndex, bytes32[] siblings, uint256 totalLeaves)`
- `settleBondedWithdrawals(address bonder, bytes32[] transferIds, uint256 totalAmount)`
- `stake(address bonder, uint256 amount) payable`
- `TIME_SLOT_SIZE() view returns (uint256)`
- `timeSlotToAmountBonded(uint256, address) view returns (uint256)`
- `transferBonds(bytes32) view returns (address bonder, uint256 createdAt, uint256 totalAmount, uint256 challengeStartTime, address challenger, bool challengeResolved)`
- `transferRootCommittedAt(bytes32) view returns (uint256)`
- `transferRootCommittedAt(uint256, bytes32) view returns (uint256)`
- `unstake(uint256 amount)`
- `withdraw(address recipient, uint256 amount, bytes32 transferNonce, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, bytes32 rootHash, uint256 transferRootTotalAmount, uint256 transferIdTreeIndex, bytes32[] siblings, uint256 totalLeaves)`

Not on Ethereum's l1EthBridge (`0xb8901acB165ed027E32754E0FFe830802919727f`), whose code does not dispatch them or declares them otherwise: `challengeTransferBond`, `l1CanonicalToken`, `resolveChallenge`, `transferRootCommittedAt`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

Not on Ethereum's l1UsdcBridge (`0x3666f603Cc164936C1b87e207F36BEBa4AC5f18a`), whose code does not dispatch them or declares them otherwise: `challengeTransferBond`, `resolveChallenge`, `transferRootCommittedAt`. Do not call them there: a program compiled for Ethereum is refused them, and a call made another way does not run the function, and whether it reverts is up to that code.

### `HopL2AmmWrapperABI`

`import HopL2AmmWrapperABI from "./protocols/hop/HopL2AmmWrapperABI.json";` Speaks for: l2AmmWrapper.

- `attemptSwap(address recipient, uint256 amount, uint256 amountOutMin, uint256 deadline)`
- `bridge() view returns (address)`
- `exchangeAddress() view returns (address)`
- `hToken() view returns (address)`
- `l2CanonicalToken() view returns (address)`
- `l2CanonicalTokenIsEth() view returns (bool)`
- `swapAndSend(uint256 chainId, address recipient, uint256 amount, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 destinationAmountOutMin, uint256 destinationDeadline) payable`
