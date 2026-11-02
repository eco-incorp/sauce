<!-- Generated from the SDK's registries. Do not edit. -->

# EigenLayer (`eigenlayer`)

Restaking protocol that enables staked ETH to secure additional protocols. Deposit LSTs into strategies to earn restaking rewards.

| Fact | Value |
| --- | --- |
| Category | Restaking |
| Family | none |
| Namespace | `Eigenlayer` on ethereum |
| Chains | ethereum |
| Document | [eigenlayer.md](../eigenlayer.md): what it is for, how to choose it, its pitfalls |

## In a program

On Ethereum, `Eigenlayer` is a namespace: its contracts need no import.

```sauce chain=ethereum
function main() {
  // Ethereum's cbETHStrategy, `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc`.
  require(Eigenlayer.CbETHStrategy != 0);
}
```

## Deployments

| Chain | Contract | Address | In a program |
| --- | --- | --- | --- |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | cbETHStrategy | `0x54945180dB7943c0ed0FEE7EdaB2Bd24620256bc` | `Eigenlayer.CbETHStrategy` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | delegationManager | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` | `Eigenlayer.DelegationManager` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | rETHStrategy | `0x1BeE69b7dFFfA4E2d53C2a2Df135C388AD25dCD2` | `Eigenlayer.RETHStrategy` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | stETHStrategy | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` | `Eigenlayer.StETHStrategy` |
| [Ethereum](../../../sauce-chains/references/ethereum.md) | strategyManager | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` | `Eigenlayer.StrategyManager` |

## ABI

### `DelegationManagerABI`

`import DelegationManagerABI from "./protocols/eigenlayer/DelegationManagerABI.json";` Speaks for: delegationManager. The import is the contract's full ABI across every deployment; call it through the `Eigenlayer` namespace to have a function a chain's deployment does not run refused.

- `allocationManager() view returns (address)`
- `beaconChainETHStrategy() view returns (address)`
- `calculateDelegationApprovalDigestHash(address staker, address operator, address approver, bytes32 approverSalt, uint256 expiry) view returns (bytes32)`
- `calculateWithdrawalRoot((address staker, address delegatedTo, address withdrawer, uint256 nonce, uint32 startBlock, address[] strategies, uint256[] scaledShares) withdrawal) pure returns (bytes32)`
- `completeQueuedWithdrawal((address staker, address delegatedTo, address withdrawer, uint256 nonce, uint32 startBlock, address[] strategies, uint256[] scaledShares) withdrawal, address[] tokens, bool receiveAsTokens)`
- `completeQueuedWithdrawals((address staker, address delegatedTo, address withdrawer, uint256 nonce, uint32 startBlock, address[] strategies, uint256[] scaledShares)[] withdrawals, address[][] tokens, bool[] receiveAsTokens)`
- `convertToDepositShares(address staker, address[] strategies, uint256[] withdrawableShares) view returns (uint256[])`
- `cumulativeWithdrawalsQueued(address staker) view returns (uint256 totalQueued)`
- `decreaseDelegatedShares(address staker, uint256 curDepositShares, uint64 beaconChainSlashingFactorDecrease)`
- `delegatedTo(address staker) view returns (address operator)`
- `delegateTo(address operator, (bytes signature, uint256 expiry) approverSignatureAndExpiry, bytes32 approverSalt)`
- `DELEGATION_APPROVAL_TYPEHASH() view returns (bytes32)`
- `delegationApprover(address operator) view returns (address)`
- `delegationApproverSaltIsSpent(address delegationApprover, bytes32 salt) view returns (bool spent)`
- `depositScalingFactor(address staker, address strategy) view returns (uint256)`
- `domainSeparator() view returns (bytes32)`
- `eigenPodManager() view returns (address)`
- `getDepositedShares(address staker) view returns (address[], uint256[])`
- `getOperatorShares(address operator, address[] strategies) view returns (uint256[])`
- `getOperatorsShares(address[] operators, address[] strategies) view returns (uint256[][])`
- `getQueuedWithdrawal(bytes32 withdrawalRoot) view returns ((address staker, address delegatedTo, address withdrawer, uint256 nonce, uint32 startBlock, address[] strategies, uint256[] scaledShares) withdrawal, uint256[] shares)`
- `getQueuedWithdrawalRoots(address staker) view returns (bytes32[])`
- `getQueuedWithdrawals(address staker) view returns ((address staker, address delegatedTo, address withdrawer, uint256 nonce, uint32 startBlock, address[] strategies, uint256[] scaledShares)[] withdrawals, uint256[][] shares)`
- `getSlashableSharesInQueue(address operator, address strategy) view returns (uint256)`
- `getWithdrawableShares(address staker, address[] strategies) view returns (uint256[] withdrawableShares, uint256[] depositShares)`
- `increaseDelegatedShares(address staker, address strategy, uint256 prevDepositShares, uint256 addedShares)`
- `initialize(uint256 initialPausedStatus)`
- `isDelegated(address staker) view returns (bool)`
- `isOperator(address operator) view returns (bool)`
- `minWithdrawalDelayBlocks() view returns (uint32)`
- `modifyOperatorDetails(address operator, address newDelegationApprover)`
- `operatorShares(address operator, address strategy) view returns (uint256 shares)`
- `pause(uint256 newPausedStatus)`
- `pauseAll()`
- `paused() view returns (uint256)`
- `paused(uint8 index) view returns (bool)`
- `pauserRegistry() view returns (address)`
- `pendingWithdrawals(bytes32 withdrawalRoot) view returns (bool pending)`
- `permissionController() view returns (address)`
- `queuedWithdrawals(bytes32 withdrawalRoot) view returns ((address staker, address delegatedTo, address withdrawer, uint256 nonce, uint32 startBlock, address[] strategies, uint256[] scaledShares) withdrawal)`
- `queueWithdrawals((address[] strategies, uint256[] depositShares, address __deprecated_withdrawer)[] params) returns (bytes32[])`
- `redelegate(address newOperator, (bytes signature, uint256 expiry) newOperatorApproverSig, bytes32 approverSalt) returns (bytes32[] withdrawalRoots)`
- `registerAsOperator(address initDelegationApprover, uint32 allocationDelay, string metadataURI)`
- `slashOperatorShares(address operator, (address avs, uint32 id) operatorSet, uint256 slashId, address strategy, uint64 prevMaxMagnitude, uint64 newMaxMagnitude) returns (uint256 totalDepositSharesToSlash)`
- `strategyManager() view returns (address)`
- `undelegate(address staker) returns (bytes32[] withdrawalRoots)`
- `unpause(uint256 newPausedStatus)`
- `updateOperatorMetadataURI(address operator, string metadataURI)`
- `version() view returns (string)`

Left out of this ABI, though its deployments declare them:

- `error ActivelyDelegated` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error CallerCannotUndelegate` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error FullySlashed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InputAddressZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidDepositScalingFactor` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidShortString` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidSnapshotOrdering` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyEigenPodManager` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyPauser` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyStrategyManagerOrEigenPodManager` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OperatorsCannotUndelegate` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SaltSpent` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StringTooLong` taking `(string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WithdrawalDelayNotElapsed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WithdrawerNotCaller` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `StrategyABI`

`import StrategyABI from "./protocols/eigenlayer/StrategyABI.json";` Speaks for: stETHStrategy, rETHStrategy, cbETHStrategy. The import is the contract's full ABI across every deployment; call it through the `Eigenlayer` namespace to have a function a chain's deployment does not run refused.

- `beforeAddShares(address, uint256)`
- `beforeRemoveShares(address, uint256)`
- `deposit(address token, uint256 amount) returns (uint256 newShares)`
- `explanation() pure returns (string)`
- `getTVLLimits() view returns (uint256, uint256)`
- `initialize(address _underlyingToken)`
- `initialize(uint256 _maxPerDeposit, uint256 _maxTotalDeposits, address _underlyingToken)`
- `maxPerDeposit() view returns (uint256)`
- `maxTotalDeposits() view returns (uint256)`
- `pause(uint256 newPausedStatus)`
- `pauseAll()`
- `paused() view returns (uint256)`
- `paused(uint8 index) view returns (bool)`
- `pauserRegistry() view returns (address)`
- `setTVLLimits(uint256 newMaxPerDeposit, uint256 newMaxTotalDeposits)`
- `shares(address user) view returns (uint256)`
- `sharesToUnderlying(uint256 amountShares) view returns (uint256)`
- `sharesToUnderlyingView(uint256 amountShares) view returns (uint256)`
- `strategyManager() view returns (address)`
- `totalShares() view returns (uint256)`
- `underlyingToken() view returns (address)`
- `underlyingToShares(uint256 amountUnderlying) view returns (uint256)`
- `underlyingToSharesView(uint256 amountUnderlying) view returns (uint256)`
- `unpause(uint256 newPausedStatus)`
- `userUnderlying(address user) returns (uint256)`
- `userUnderlyingView(address user) view returns (uint256)`
- `withdraw(address recipient, address token, uint256 amountShares) returns (uint256 amountOut)`

Left out of this ABI, though its deployments declare them:

- `error InputAddressZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaxPerDepositExceedsMax` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error NewSharesZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyPauser` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyUnderlyingToken` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error TotalSharesExceedsMax` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error WithdrawalAmountExceedsTotalDeposits` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.

### `StrategyManagerABI`

`import StrategyManagerABI from "./protocols/eigenlayer/StrategyManagerABI.json";` Speaks for: strategyManager. The import is the contract's full ABI across every deployment; call it through the `Eigenlayer` namespace to have a function a chain's deployment does not run refused.

- `addShares(address staker, address strategy, uint256 shares) returns (uint256, uint256)`
- `addStrategiesToDepositWhitelist(address[] strategiesToWhitelist)`
- `allocationManager() view returns (address)`
- `burnShares(address strategy)`
- `calculateStrategyDepositDigestHash(address staker, address strategy, address token, uint256 amount, uint256 nonce, uint256 expiry) view returns (bytes32)`
- `clearBurnOrRedistributableShares((address avs, uint32 id) operatorSet, uint256 slashId) returns (uint256[])`
- `clearBurnOrRedistributableSharesByStrategy((address avs, uint32 id) operatorSet, uint256 slashId, address strategy) returns (uint256)`
- `DEFAULT_BURN_ADDRESS() view returns (address)`
- `delegation() view returns (address)`
- `DEPOSIT_TYPEHASH() view returns (bytes32)`
- `depositIntoStrategy(address strategy, address token, uint256 amount) returns (uint256 shares)`
- `depositIntoStrategyWithSignature(address strategy, address token, uint256 amount, address staker, uint256 expiry, bytes signature) returns (uint256 depositShares)`
- `domainSeparator() view returns (bytes32)`
- `getBurnableShares(address strategy) view returns (uint256)`
- `getBurnOrRedistributableCount((address avs, uint32 id) operatorSet, uint256 slashId) view returns (uint256)`
- `getBurnOrRedistributableShares((address avs, uint32 id) operatorSet, uint256 slashId) view returns (address[], uint256[])`
- `getBurnOrRedistributableShares((address avs, uint32 id) operatorSet, uint256 slashId, address strategy) view returns (uint256)`
- `getDeposits(address staker) view returns (address[], uint256[])`
- `getPendingOperatorSets() view returns ((address avs, uint32 id)[])`
- `getPendingSlashIds((address avs, uint32 id) operatorSet) view returns (uint256[])`
- `getSlashResolutionBlock((address avs, uint32 id) operatorSet, uint256 slashId) view returns (uint32)`
- `getStakerStrategyList(address staker) view returns (address[])`
- `getStrategiesWithBurnableShares() view returns (address[], uint256[])`
- `increaseBurnOrRedistributableShares((address avs, uint32 id) operatorSet, uint256 slashId, address strategy, uint256 sharesToBurn)`
- `initialize(address initialOwner, address initialStrategyWhitelister, uint256 initialPausedStatus)`
- `nonces(address signer) view returns (uint256 nonce)`
- `owner() view returns (address)`
- `pause(uint256 newPausedStatus)`
- `pauseAll()`
- `paused() view returns (uint256)`
- `paused(uint8 index) view returns (bool)`
- `pauserRegistry() view returns (address)`
- `removeDepositShares(address staker, address strategy, uint256 depositSharesToRemove) returns (uint256)`
- `removeStrategiesFromDepositWhitelist(address[] strategiesToRemoveFromWhitelist)`
- `renounceOwnership()`
- `setStrategyWhitelister(address newStrategyWhitelister)`
- `SLASH_RESOLUTION_DELAY_BLOCKS() view returns (uint32)`
- `stakerDepositShares(address staker, address strategy) view returns (uint256 shares)`
- `stakerStrategyList(address staker, uint256) view returns (address strategies)`
- `stakerStrategyListLength(address staker) view returns (uint256)`
- `strategyIsWhitelistedForDeposit(address strategy) view returns (bool whitelisted)`
- `strategyWhitelister() view returns (address)`
- `transferOwnership(address newOwner)`
- `unpause(uint256 newPausedStatus)`
- `version() view returns (string)`
- `withdrawSharesAsTokens(address staker, address strategy, address token, uint256 shares)`

Left out of this ABI, though its deployments declare them:

- `error InputAddressZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error InvalidShortString` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error MaxStrategiesExceeded` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyPauser` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error OnlyStrategyWhitelister` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SharesAmountZero` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error SlashResolutionDelayNotElapsed` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StrategyNotFound` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StrategyNotWhitelisted` taking `()`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
- `error StringTooLong` taking `(string)`: no deployment carries it: its topic or selector is in the code of no captured layer, facet or linked library.
